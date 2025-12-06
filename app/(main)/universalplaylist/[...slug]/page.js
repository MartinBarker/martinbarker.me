'use client'
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import styles from '../universalplaylist.module.css';
import { ColorContext } from '../../ColorContext';

// Helper functions to detect and normalize media URLs
function normalizeMediaUrl(url) {
  // Remove http:// and https:// if present
  let normalized = url.replace(/^https?:\/\//, '');
  
  // Handle YouTube IDs (just the ID)
  if (/^[a-zA-Z0-9_-]{11}$/.test(normalized)) {
    return {
      type: 'youtube',
      id: normalized,
      url: `https://www.youtube.com/watch?v=${normalized}`,
      embedUrl: `https://www.youtube.com/embed/${normalized}`
    };
  }
  
  // Handle YouTube URLs (watch, youtu.be, embed, etc.)
  // Try multiple patterns to extract video ID
  let videoId = null;
  
  // Pattern 1: watch?v=VIDEO_ID
  const watchMatch = normalized.match(/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) {
    videoId = watchMatch[1];
  }
  
  // Pattern 2: youtu.be/VIDEO_ID
  if (!videoId) {
    const shortMatch = normalized.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) {
      videoId = shortMatch[1];
    }
  }
  
  // Pattern 3: youtube.com/embed/VIDEO_ID
  if (!videoId) {
    const embedMatch = normalized.match(/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) {
      videoId = embedMatch[1];
    }
  }
  
  // Pattern 4: youtube.com/v/VIDEO_ID
  if (!videoId) {
    const vMatch = normalized.match(/(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/);
    if (vMatch) {
      videoId = vMatch[1];
    }
  }
  
  // Pattern 5: youtube.com/shorts/VIDEO_ID
  if (!videoId) {
    const shortsMatch = normalized.match(/(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) {
      videoId = shortsMatch[1];
    }
  }
  
  // Pattern 6: Generic fallback - extract any 11-character alphanumeric string after youtube.com/
  if (!videoId) {
    const genericMatch = normalized.match(/(?:www\.)?youtube\.com\/[^\/\?&]*([a-zA-Z0-9_-]{11})/);
    if (genericMatch) {
      videoId = genericMatch[1];
    }
  }
  
  if (videoId) {
    console.log(`[normalizeMediaUrl] Extracted YouTube video ID "${videoId}" from URL: ${url}`);
    return {
      type: 'youtube',
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube.com/embed/${videoId}`
    };
  }
  
  // Log if we couldn't extract a video ID from what looks like a YouTube URL
  if (normalized.includes('youtube.com') || normalized.includes('youtu.be')) {
    console.warn(`[normalizeMediaUrl] Could not extract video ID from YouTube URL: ${url}`);
  }
  
  // Handle Spotify URLs (open.spotify.com or spotify:track:)
  const spotifyMatch = normalized.match(/(?:open\.)?spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/) || 
                       normalized.match(/spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)/);
  if (spotifyMatch) {
    const type = spotifyMatch[1];
    const id = spotifyMatch[2];
    return {
      type: 'spotify',
      id: `${type}_${id}`,
      url: `https://open.spotify.com/${type}/${id}`,
      embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`
    };
  }
  
  // Handle SoundCloud URLs
  const soundcloudMatch = normalized.match(/soundcloud\.com\/([^\/\s]+)\/([^\/\s\?]+)/);
  if (soundcloudMatch) {
    return {
      type: 'soundcloud',
      id: `${soundcloudMatch[1]}_${soundcloudMatch[2]}`,
      url: `https://soundcloud.com/${soundcloudMatch[1]}/${soundcloudMatch[2]}`,
      embedUrl: `https://w.soundcloud.com/player/?url=https://soundcloud.com/${soundcloudMatch[1]}/${soundcloudMatch[2]}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true`
    };
  }
  
  // Handle Bandcamp URLs
  const bandcampMatch = normalized.match(/([^\.]+)\.bandcamp\.com\/(track|album)\/([^\/\s\?]+)/);
  if (bandcampMatch) {
    const domain = bandcampMatch[1];
    const type = bandcampMatch[2];
    const path = bandcampMatch[3];
    const fullUrl = `https://${domain}.bandcamp.com/${type}/${path}`;
    const encodedUrl = encodeURIComponent(fullUrl);
    const isAlbum = type === 'album';
    return {
      type: 'bandcamp',
      id: `${domain}_${path}`,
      url: fullUrl,
      embedUrl: `https://bandcamp.com/EmbeddedPlayer/url=${encodedUrl}/size=large/bgcol=ffffff/linkcol=0687f5/tracklist=${isAlbum ? 'true' : 'false'}/artwork=small/transparent=true/`
    };
  }
  
  // Unknown type - return as-is
  return {
    type: 'unknown',
    id: normalized,
    url: normalized.startsWith('http') ? normalized : `https://${normalized}`,
    embedUrl: null
  };
}

export default function UniversalPlaylist() {
  const params = useParams();
  const { colors } = React.useContext(ColorContext);
  const [mediaItems, setMediaItems] = useState([]);
  const [error, setError] = useState(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1.0); // Volume from 0 to 1
  const [currentTime, setCurrentTime] = useState(0); // Current playback time in seconds
  const [duration, setDuration] = useState(0); // Total duration in seconds
  const [isDragging, setIsDragging] = useState(false); // Whether user is dragging progress bar
  const playerRefs = React.useRef({});
  const youtubePlayers = React.useRef({});
  const bandcampIframes = React.useRef({});
  const bandcampAudioElements = React.useRef({});
  const bandcampStreamUrls = React.useRef({});
  const bandcampMetadata = React.useRef({}); // Store artwork, title, artist, album for each track
  const [youtubeApiReady, setYoutubeApiReady] = useState(false);
  const [bandcampStreamsReady, setBandcampStreamsReady] = useState({});
  const currentTrackIndexRef = React.useRef(0);
  const isPlayingRef = React.useRef(false);
  const mediaItemsRef = React.useRef([]);

  useEffect(() => {
    try {
      const slugArray = params?.slug || [];
      
      if (slugArray.length === 0) {
        setMediaItems([]);
        return;
      }

      // Debug: log what we receive
      console.log('Slug array received:', slugArray);
      console.log('Slug array length:', slugArray.length);

      // Next.js splits paths on '/', so we need to reconstruct the full path
      // The issue is that URLs like "www.youtube.com/watch?v=..." contain '/' which Next.js splits on
      // Strategy: Join all segments, then try to decode and parse as JSON
      
      // First, decode each segment individually (in case some are URL-encoded)
      const decodedSegments = slugArray.map(segment => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
      
      // Join all segments back together with '/' to reconstruct the original path
      const joinedPath = decodedSegments.join('/');
      console.log('Joined path:', joinedPath);
      
      // Try to parse as JSON
      let mediaArray;
      try {
        // First, try to parse directly
        mediaArray = JSON.parse(joinedPath);
        console.log('Successfully parsed as JSON:', mediaArray);
      } catch (e) {
        // If that fails, try removing curly braces if present (handles {[...]} format)
        try {
          const cleanedPath = joinedPath.trim().replace(/^\{+|\}+$/g, '');
          mediaArray = JSON.parse(cleanedPath);
          console.log('Successfully parsed after removing curly braces:', mediaArray);
        } catch (e2) {
          console.log('Failed to parse as JSON, trying alternative methods:', e2.message);
          
          // If JSON parsing fails, the path might be broken because Next.js split on '/'
          // Try to reconstruct by finding JSON array boundaries and fixing broken URLs
          
          // Strategy 1: Look for JSON array pattern and extract quoted strings
          // This handles cases where URLs were split: "www.youtube.com" + "/watch?v=..." 
          // should become "www.youtube.com/watch?v=..."
          // Also handle curly braces: {[...]} or just [...]
          let pathToSearch = joinedPath.trim().replace(/^\{+|\}+$/g, '');
          const jsonArrayMatch = pathToSearch.match(/\[(.*)\]/s);
        if (jsonArrayMatch) {
          const arrayContent = jsonArrayMatch[1];
          console.log('Found array content:', arrayContent);
          
          // Extract all quoted strings, handling cases where they might be split
          const items = [];
          let currentItem = '';
          let inQuotes = false;
          let quoteChar = null;
          
          for (let i = 0; i < arrayContent.length; i++) {
            const char = arrayContent[i];
            
            if ((char === '"' || char === "'") && (i === 0 || arrayContent[i - 1] !== '\\')) {
              if (!inQuotes) {
                inQuotes = true;
                quoteChar = char;
                currentItem = '';
              } else if (char === quoteChar) {
                // End of quoted string
                if (currentItem.trim()) {
                  items.push(currentItem.trim());
                }
                currentItem = '';
                inQuotes = false;
                quoteChar = null;
              } else {
                currentItem += char;
              }
            } else if (inQuotes) {
              currentItem += char;
            } else if (char === ',' && !inQuotes) {
              // Skip commas outside quotes
            }
          }
          
          // Handle any remaining item
          if (currentItem.trim() && inQuotes) {
            items.push(currentItem.trim());
          }
          
          // Now try to merge items that look like they were split (e.g., "www.youtube.com" followed by "watch?v=...")
          const mergedItems = [];
          for (let i = 0; i < items.length; i++) {
            const current = items[i];
            const next = items[i + 1];
            
            // Check if current item ends with a domain and next starts with a path
            if (next && 
                (current.match(/\.(com|net|org|io|co|be|me)(\?|$)/i) || current.match(/^[a-z0-9-]+\.(com|net|org|io|co|be|me)$/i)) &&
                (next.startsWith('/') || next.startsWith('watch') || next.startsWith('track') || next.startsWith('album'))) {
              // Merge them
              mergedItems.push(current + '/' + next);
              i++; // Skip next item
            } else {
              mergedItems.push(current);
            }
          }
          
          if (mergedItems.length > 0) {
            mediaArray = mergedItems;
            console.log('Extracted and merged items:', mediaArray);
          }
        }
        
        // Strategy 2: If still no array, try regex extraction
        if (!mediaArray) {
          const urlPattern = /"([^"]*(?:\.(?:com|net|org|io|co|be|me|bandcamp\.com|spotify\.com|soundcloud\.com|youtube\.com|youtu\.be)[^"]*))"/g;
          const items = [];
          let match;
          while ((match = urlPattern.exec(joinedPath)) !== null) {
            items.push(match[1]);
          }
          if (items.length > 0) {
            mediaArray = items;
            console.log('Extracted items via regex:', mediaArray);
          }
        }
        
        // Strategy 3: Last resort - split by comma
        if (!mediaArray) {
          const splitItems = joinedPath
            .split(',')
            .map(item => item.trim().replace(/^["'\[\]]+|["'\[\]]+$/g, ''))
            .filter(item => item.length > 0);
          
          if (splitItems.length > 0) {
            mediaArray = splitItems;
            console.log('Split by comma:', mediaArray);
          } else {
            mediaArray = [];
            console.log('No items found');
          }
        }
        }
      }
      
      // Ensure it's an array
      if (!Array.isArray(mediaArray)) {
        mediaArray = [mediaArray];
      }
      
      console.log('Final media array:', mediaArray, 'Length:', mediaArray.length);
      
      // Normalize each media URL with error handling
      const normalizedItems = [];
      mediaArray.forEach((item, index) => {
        try {
          const normalized = normalizeMediaUrl(String(item));
          console.log(`[normalizeMediaUrl] Item ${index}: "${item}" -> type: ${normalized?.type}, id: ${normalized?.id}`);
          if (normalized && normalized.type !== 'unknown') {
            normalizedItems.push({
              ...normalized,
              original: item,
              index: normalizedItems.length
            });
            console.log(`[normalizeMediaUrl] ✅ Added item ${normalizedItems.length - 1}: ${normalized.type} - ${normalized.id || normalized.url}`);
          } else {
            console.warn(`[normalizeMediaUrl] ⚠️ Skipping invalid media item at index ${index}:`, item, 'normalized:', normalized);
          }
        } catch (error) {
          console.error(`[normalizeMediaUrl] ❌ Error normalizing media item at index ${index}:`, error);
          console.error(`  Item:`, item);
          // Skip this item and continue
        }
      });
      
      console.log(`[normalizeMediaUrl] Final normalized items count: ${normalizedItems.length}`);
      
      setMediaItems(normalizedItems);
      setError(null);
    } catch (err) {
      console.error('Error parsing media URLs:', err);
      setError(err.message);
      setMediaItems([]);
    }
  }, [params]);

  const darkenColor = (color, amount = 0.3) => {
    const hex = color.replace('#', '');
    const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - Math.floor(255 * amount));
    const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - Math.floor(255 * amount));
    const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - Math.floor(255 * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  const getReadableTextColor = (backgroundColor) => {
    const color = backgroundColor.replace('#', '');
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 125 ? '#000' : '#fff';
  };

  // Get thumbnail URL for a media item
  const getThumbnailUrl = (item) => {
    switch (item.type) {
      case 'youtube':
        return `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`;
      case 'spotify':
        // Spotify doesn't provide easy thumbnail access, use a placeholder or try oEmbed
        return null;
      case 'soundcloud':
        // SoundCloud requires oEmbed API call, use placeholder for now
        return null;
      case 'bandcamp':
        // Bandcamp embeds include artwork, but we'd need to extract it
        return null;
      default:
        return null;
    }
  };

  // Scroll to a specific player
  const scrollToPlayer = (index) => {
    // Special handling for the first item (track 1) - always scroll to absolute top
    if (index === 0) {
      console.log('[scrollToPlayer] Scrolling to track 1 (index 0) - scrolling to top');
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
      return;
    }
    
    const ref = playerRefs.current[`player-${index}`];
    if (ref) {
      // Get the element's position
      const elementRect = ref.getBoundingClientRect();
      const absoluteElementTop = elementRect.top + window.pageYOffset;
      const elementHeight = elementRect.height;
      
      // Account for any fixed headers or spacing
      const offset = 20; // Small offset from top
      const scrollPosition = absoluteElementTop - offset;
      
      // Ensure we don't scroll to negative position
      const finalScrollPosition = Math.max(0, scrollPosition);
      
      // Check if element is already fully visible
      const viewportHeight = window.innerHeight;
      const elementBottom = absoluteElementTop + elementHeight;
      const currentScrollTop = window.pageYOffset;
      const viewportTop = currentScrollTop;
      const viewportBottom = currentScrollTop + viewportHeight;
      
      // Only scroll if element is not fully visible
      //if (absoluteElementTop < viewportTop + offset || elementBottom > viewportBottom) {
        console.log(`[scrollToPlayer] Scrolling to track ${index + 1} (index ${index}) - position: ${finalScrollPosition}`);
        window.scrollTo({
          top: finalScrollPosition,
          behavior: 'smooth'
        });
      //} else {
      //  console.log(`[scrollToPlayer] Track ${index + 1} (index ${index}) is already fully visible, skipping scroll`);
      //}
    } else {
      console.log(`[scrollToPlayer] No ref found for track ${index + 1} (index ${index})`);
    }
  };

  // Load YouTube IFrame API
  useEffect(() => {
    // Check if API is already loaded
    if (window.YT && window.YT.Player) {
      setYoutubeApiReady(true);
      return;
    }

    // Load the YouTube IFrame API script
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    // Set up callback for when API is ready
    window.onYouTubeIframeAPIReady = () => {
      setYoutubeApiReady(true);
    };

    return () => {
      // Cleanup
      if (window.onYouTubeIframeAPIReady) {
        delete window.onYouTubeIframeAPIReady;
      }
    };
  }, []);

  // Listen for messages from Bandcamp iframes to understand their API
  useEffect(() => {
    const handleMessage = (event) => {
      // Log messages from bandcamp.com to understand their API
      if (event.origin.includes('bandcamp.com')) {
        console.log('[Bandcamp Message] Received from Bandcamp:', event.data, 'Origin:', event.origin);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Function to extract Bandcamp stream URLs via server endpoint
  const extractBandcampStreamUrl = async (item) => {
    // If we already have a stream URL, don't fetch again
    if (bandcampStreamUrls.current[item.index]) {
      return bandcampStreamUrls.current[item.index];
    }

    try {
      const fullUrl = item.url.startsWith('http') ? item.url : `https://${item.url}`;
      console.log(`[extractBandcampStreamUrl] Attempting to extract stream URL for: ${fullUrl}`);
      
      // Determine the API base URL (dev vs prod)
      const isDev = window.location.hostname === 'localhost';
      const apiBase = isDev ? 'http://localhost:3030' : '';
      const apiPrefix = isDev ? '' : '/internal-api';
      
      // Call server endpoint to extract stream URLs
      const response = await fetch(`${apiBase}${apiPrefix}/bandcamp/extract-streams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: fullUrl })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.warn(`[extractBandcampStreamUrl] Server returned error:`, errorData);
        return null;
      }
      
      const data = await response.json();
      
      // Log the mp3_128_urls array from backend
      if (data.mp3_128_urls && Array.isArray(data.mp3_128_urls)) {
        console.log(`[extractBandcampStreamUrl] 🎵 Track streaming URLs found from backend:`, data.mp3_128_urls);
        console.log(`[extractBandcampStreamUrl] 📊 Total mp3-128 URLs: ${data.mp3_128_urls.length}`);
        data.mp3_128_urls.forEach((url, idx) => {
          console.log(`[extractBandcampStreamUrl]   ${idx + 1}. ${url}`);
        });
      }
      
      if (!data.success || !data.tracks || data.tracks.length === 0) {
        console.warn(`[extractBandcampStreamUrl] No tracks found in response`);
        return null;
      }
      
      // Log all tracks and their mp3_128 URLs
      console.log(`[extractBandcampStreamUrl] 📋 All tracks from backend:`, data.tracks);
      data.tracks.forEach((track, idx) => {
        console.log(`[extractBandcampStreamUrl]   Track ${idx + 1}: "${track.title}" - mp3_128: ${track.mp3_128 || 'N/A'}`);
      });
      
      // Check if this is an album (multiple tracks) or single track
      const isAlbum = data.tracks.length > 1;
      
      if (isAlbum) {
        // For albums, expand into multiple mediaItems
        console.log(`[extractBandcampStreamUrl] 📀 Album detected with ${data.tracks.length} tracks, expanding...`);
        
        // Store metadata and stream URLs first
        data.tracks.forEach((track, idx) => {
          const streamUrl = track.mp3_128 || 
                           track.streamUrls['mp3-128'] || 
                           track.streamUrls['mp3-v0'] || 
                           Object.values(track.streamUrls)[0] || 
                           null;
          
          const trackIndex = item.index + idx;
          if (streamUrl) {
            bandcampStreamUrls.current[trackIndex] = streamUrl;
          }
          
          bandcampMetadata.current[trackIndex] = {
            title: track.title,
            artist: track.artist || data.artist,
            album: track.album || data.albumTitle,
            artwork: track.artwork,
            duration: track.duration
          };
        });
        
        // Create new media items for each track
        const newMediaItems = data.tracks.map((track, idx) => {
          return {
            type: 'bandcamp',
            id: `${item.id}_track_${idx}`,
            url: fullUrl, // Keep original URL
            embedUrl: item.embedUrl,
            original: item.original,
            index: item.index + idx
          };
        });
        
        // Replace the single album item with all track items and re-index everything
        setMediaItems(prev => {
          // Save current refs
          const oldStreamUrls = { ...bandcampStreamUrls.current };
          const oldMetadata = { ...bandcampMetadata.current };
          const oldAudioElements = { ...bandcampAudioElements.current };
          
          // Create new items array
          const newItems = [...prev];
          newItems.splice(item.index, 1, ...newMediaItems);
          const reindexed = newItems.map((itm, idx) => ({ ...itm, index: idx }));
          
          // Rebuild refs with new indices
          const newStreamUrls = {};
          const newMetadata = {};
          const newAudioElements = {};
          
          reindexed.forEach((itm, newIdx) => {
            let oldIdx;
            if (newIdx < item.index) {
              // Items before album - index unchanged
              oldIdx = newIdx;
            } else if (newIdx >= item.index && newIdx < item.index + data.tracks.length) {
              // New track items - use stored data
              oldIdx = item.index + (newIdx - item.index);
            } else {
              // Items after album - shifted by (tracks.length - 1)
              oldIdx = newIdx - (data.tracks.length - 1);
            }
            
            if (oldStreamUrls[oldIdx]) newStreamUrls[newIdx] = oldStreamUrls[oldIdx];
            if (oldMetadata[oldIdx]) newMetadata[newIdx] = oldMetadata[oldIdx];
            if (oldAudioElements[oldIdx]) newAudioElements[newIdx] = oldAudioElements[oldIdx];
          });
          
          // Update refs
          bandcampStreamUrls.current = newStreamUrls;
          bandcampMetadata.current = newMetadata;
          bandcampAudioElements.current = newAudioElements;
          
          return reindexed;
        });
        
        console.log(`[extractBandcampStreamUrl] ✅ Album expanded into ${newMediaItems.length} tracks`);
        return bandcampStreamUrls.current[item.index] || null;
      } else {
        // Single track - just store metadata and stream URL
        const track = data.tracks[0];
        const streamUrl = track.mp3_128 || 
                         track.streamUrls['mp3-128'] || 
                         track.streamUrls['mp3-v0'] || 
                         Object.values(track.streamUrls)[0] || 
                         null;
        
        if (streamUrl) {
          bandcampStreamUrls.current[item.index] = streamUrl;
        }
        
        bandcampMetadata.current[item.index] = {
          title: track.title,
          artist: track.artist || data.artist,
          album: track.album || data.albumTitle,
          artwork: track.artwork,
          duration: track.duration
        };
        
        if (streamUrl) {
          console.log(`[extractBandcampStreamUrl] ✅ Successfully extracted stream URL: ${streamUrl}`);
          setBandcampStreamsReady(prev => ({ ...prev, [item.index]: true }));
          return streamUrl;
        } else {
          console.warn(`[extractBandcampStreamUrl] ⚠️ No stream URL found in track data`);
          return null;
        }
      }
    } catch (error) {
      console.error(`[extractBandcampStreamUrl] Error extracting stream URL:`, error);
      return null;
    }
  };

  // Try to extract Bandcamp stream URLs when media items are loaded
  useEffect(() => {
    if (mediaItems.length === 0) return;

    // Extract stream URLs for all Bandcamp items
    mediaItems.forEach((item) => {
      if (item.type === 'bandcamp' && !bandcampStreamUrls.current[item.index]) {
        // Extract stream URL via server endpoint (no need to wait for iframe)
        extractBandcampStreamUrl(item).then(streamUrl => {
          if (streamUrl) {
            console.log(`[useEffect] Successfully extracted stream URL for item ${item.index}: ${streamUrl}`);
          }
        }).catch(error => {
          console.error(`[useEffect] Error extracting stream URL for item ${item.index}:`, error);
        });
      }
      
      // YouTube playlists are now embedded directly, no expansion needed
    });
  }, [mediaItems]);

  // Update volume on all media elements when volume changes
  useEffect(() => {
    // Update Bandcamp audio elements
    Object.keys(bandcampAudioElements.current).forEach(index => {
      const audio = bandcampAudioElements.current[index];
      if (audio) {
        audio.volume = volume;
      }
    });
    
    // Update YouTube players
    Object.keys(youtubePlayers.current).forEach(index => {
      const player = youtubePlayers.current[index];
      if (player && player.setVolume) {
        try {
          player.setVolume(volume * 100); // YouTube uses 0-100
        } catch (error) {
          // Ignore errors if player not ready
        }
      }
    });
  }, [volume]);

  // Update refs when state changes
  useEffect(() => {
    currentTrackIndexRef.current = currentTrackIndex;
  }, [currentTrackIndex]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    mediaItemsRef.current = mediaItems;
  }, [mediaItems]);

  // Reset time when track changes
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
  }, [currentTrackIndex]);

  // Track playback time for current track
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    
    const currentTrack = mediaItems[currentTrackIndex];
    if (!currentTrack) return;
    
    let interval;
    
    if (currentTrack.type === 'bandcamp') {
      const audio = bandcampAudioElements.current[currentTrackIndex];
      if (audio) {
        const updateTime = () => {
          if (!isDragging && audio) {
            setCurrentTime(audio.currentTime || 0);
            if (audio.duration && !isNaN(audio.duration)) {
              setDuration(audio.duration);
            }
          }
        };
        
        audio.addEventListener('timeupdate', updateTime);
        audio.addEventListener('loadedmetadata', () => {
          if (audio.duration && !isNaN(audio.duration)) {
            setDuration(audio.duration);
          }
        });
        
        interval = setInterval(updateTime, 100);
        
        return () => {
          audio.removeEventListener('timeupdate', updateTime);
          if (interval) clearInterval(interval);
        };
      }
    } else if (currentTrack.type === 'youtube') {
      const player = youtubePlayers.current[currentTrackIndex];
      if (player) {
        interval = setInterval(() => {
          if (!isDragging && player.getCurrentTime) {
            try {
              const time = player.getCurrentTime();
              const dur = player.getDuration();
              if (time !== undefined && !isNaN(time)) setCurrentTime(time);
              if (dur !== undefined && !isNaN(dur)) setDuration(dur);
            } catch (error) {
              // Ignore errors
            }
          }
        }, 100);
        
        return () => {
          if (interval) clearInterval(interval);
        };
      }
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, currentTrackIndex, mediaItems, isDragging]);

  // Initialize YouTube players when API is ready and media items are loaded
  useEffect(() => {
    if (!youtubeApiReady || mediaItems.length === 0) return;

    // Use a small delay to ensure DOM elements are rendered
    const timer = setTimeout(() => {
      mediaItems.forEach((item, index) => {
        // Skip YouTube playlists - they use simple iframe embeds, not IFrame API
        if (item.type === 'youtube') {
          const playerId = `youtube-player-${index}`;
          const playerElement = document.getElementById(playerId);
          
          if (playerElement && !youtubePlayers.current[index]) {
            try {
              const player = new window.YT.Player(playerId, {
                videoId: item.id,
                playerVars: {
                  autoplay: 0,
                  controls: 1,
                  rel: 0,
                  modestbranding: 1
                },
                events: {
                  onStateChange: (event) => {
                    // State 0 = ENDED
                    if (event.data === window.YT.PlayerState.ENDED) {
                      // Only autoplay next if this is the current track
                      const currentIndex = currentTrackIndexRef.current;
                      const playing = isPlayingRef.current;
                      const items = mediaItemsRef.current;
                      if (currentIndex === index && playing) {
                        console.log(`[YouTube] Track ${index + 1} ended, autoplaying next track`);
                        // Check if there's a next track
                        if (currentIndex < items.length - 1) {
                          handleNext();
                        } else {
                          // Last track ended, just stop playing
                          setIsPlaying(false);
                        }
                      }
                    }
                  }
                }
              });
              youtubePlayers.current[index] = player;
            } catch (error) {
              console.error(`Error creating YouTube player for index ${index}:`, error);
              console.error(`  Item details:`, item);
              // Remove the failed item from mediaItems
              setMediaItems(prev => {
                const newItems = prev.filter((_, idx) => idx !== index);
                // Re-index items
                return newItems.map((itm, idx) => ({ ...itm, index: idx }));
              });
            }
          }
        }
      });
    }, 100);

    // Cleanup function
    return () => {
      clearTimeout(timer);
      Object.values(youtubePlayers.current).forEach(player => {
        if (player && player.destroy) {
          try {
            player.destroy();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      });
      youtubePlayers.current = {};
    };
  }, [youtubeApiReady, mediaItems]);

  // Handle play/pause
  const handlePlayPause = () => {
    const currentTrack = mediaItems[currentTrackIndex];
    
    if (currentTrack && currentTrack.type === 'youtube') {
      const player = youtubePlayers.current[currentTrackIndex];
      if (player) {
        try {
          const playerState = player.getPlayerState();
          // 1 = playing, 2 = paused, 0 = ended, -1 = unstarted
          if (playerState === window.YT.PlayerState.PLAYING) {
            player.pauseVideo();
            setIsPlaying(false);
          } else {
            // Before playing, pause all other YouTube players
            pauseAllYouTubePlayers();
            pauseAllBandcampPlayers();
            // Then play the current one
            player.playVideo();
            setIsPlaying(true);
            // Scroll to current track when playing
            scrollToPlayer(currentTrackIndex);
          }
        } catch (error) {
          console.error('Error controlling YouTube player:', error);
          // Fallback: try play/pause anyway
          if (isPlaying) {
            player.pauseVideo();
            setIsPlaying(false);
          } else {
            // Pause all others before playing
            pauseAllYouTubePlayers();
            pauseAllBandcampPlayers();
            player.playVideo();
            setIsPlaying(true);
            scrollToPlayer(currentTrackIndex);
          }
        }
      }
    } else if (currentTrack && currentTrack.type === 'bandcamp') {
      // Control Bandcamp player - manual play/pause button press
      pauseAllYouTubePlayers();
      pauseAllBandcampPlayers();
      
      if (isPlaying) {
        console.log('BANDCAMP_PAUSE');
        controlBandcampPlayer(currentTrackIndex, 'pause');
        setIsPlaying(false);
      } else {
        console.log('BANDCAMP_PLAY');
        controlBandcampPlayer(currentTrackIndex, 'play');
        setIsPlaying(true);
        scrollToPlayer(currentTrackIndex);
      }
    } else {
      // For other media types, pause all YouTube and Bandcamp players first
      pauseAllYouTubePlayers();
      pauseAllBandcampPlayers();
      // Then toggle the state
      setIsPlaying(!isPlaying);
      if (!isPlaying) {
        scrollToPlayer(currentTrackIndex);
      }
    }
  };

  // Helper function to pause all YouTube players
  const pauseAllYouTubePlayers = () => {
    Object.keys(youtubePlayers.current).forEach(index => {
      const player = youtubePlayers.current[index];
      if (player) {
        try {
          const state = player.getPlayerState();
          // Only pause if playing (state 1) or buffering (state 3)
          if (state === window.YT.PlayerState.PLAYING || state === window.YT.PlayerState.BUFFERING) {
            player.pauseVideo();
          }
        } catch (error) {
          // Ignore errors when trying to pause
          console.warn(`Error pausing YouTube player at index ${index}:`, error);
        }
      }
    });
  };

  // Helper function to pause all Bandcamp players
  const pauseAllBandcampPlayers = () => {
    // Pause all iframe players
    Object.keys(bandcampIframes.current).forEach(index => {
      const iframe = bandcampIframes.current[index];
      if (iframe && iframe.contentWindow) {
        try {
          // Try multiple postMessage formats for Bandcamp
          const origins = ['https://bandcamp.com', '*'];
          const messages = [
            {command: 'pause'},
            {method: 'pause'},
            {action: 'pause'},
            'pause'
          ];
          
          origins.forEach(origin => {
            messages.forEach(msg => {
              try {
                iframe.contentWindow.postMessage(msg, origin);
              } catch (e) {
                // Ignore errors
              }
            });
          });
        } catch (error) {
          console.warn(`Error pausing Bandcamp player at index ${index}:`, error);
        }
      }
    });
    
    // Pause all audio elements
    Object.keys(bandcampAudioElements.current).forEach(index => {
      const audio = bandcampAudioElements.current[index];
      if (audio) {
        try {
          audio.pause();
        } catch (error) {
          console.warn(`Error pausing Bandcamp audio at index ${index}:`, error);
        }
      }
    });
  };

  // Helper function to click Bandcamp play button via iframe content
  const clickBandcampPlayButton = (index) => {
    const iframe = bandcampIframes.current[index];
    if (!iframe || !iframe.contentWindow) {
      console.warn(`[clickBandcampPlayButton] No iframe found for index ${index}`);
      return false;
    }
    
    // Helper function to try clicking with retries
    const tryClick = (attempts = 0) => {
      try {
        // Try to access iframe content (may fail due to CORS)
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        
        if (!iframeDoc) {
          if (attempts < 10) {
            // Iframe not ready yet, retry after a delay
            setTimeout(() => tryClick(attempts + 1), 200);
            return false;
          }
          console.warn(`[clickBandcampPlayButton] Cannot access iframe document after ${attempts} attempts`);
          return false;
        }
        
        // Use querySelector('#big_play_icon') as the element ID
        const playButton = iframeDoc.querySelector('#big_play_icon');
        
        if (playButton) {
          playButton.click();
          console.log(`[clickBandcampPlayButton] Successfully clicked play button at index ${index}`);
          return true;
        } else {
          // Element not found yet, might still be loading
          if (attempts < 10) {
            setTimeout(() => tryClick(attempts + 1), 200);
            return false;
          }
          console.warn(`[clickBandcampPlayButton] Could not find #big_play_icon in iframe after ${attempts} attempts`);
          return false;
        }
      } catch (error) {
        // CORS error or other access issue
        if (error.name === 'SecurityError' || error.message.includes('cross-origin')) {
          console.warn(`[clickBandcampPlayButton] CORS error accessing iframe content:`, error.message);
          return false;
        }
        // Other errors - retry if we haven't exceeded attempts
        if (attempts < 10) {
          setTimeout(() => tryClick(attempts + 1), 200);
          return false;
        }
        console.error(`[clickBandcampPlayButton] Error after ${attempts} attempts:`, error);
        return false;
      }
    };
    
    // Start the retry process
    return tryClick();
  };

  // Helper function to click Bandcamp play button using XPath across all iframes
  const clickBandcampPlayButtonByXPath = (index) => {
    // First, find which Bandcamp item index this is (among all Bandcamp items)
    const currentItem = mediaItems[index];
    
    if (currentItem.type !== 'bandcamp') {
      console.warn(`[clickBandcampPlayButtonByXPath] Item at index ${index} is not a Bandcamp item`);
      return false;
    }
    
    // Find the index of this Bandcamp item among all Bandcamp items (1-based for XPath)
    let bandcampIndex = 1; // XPath uses 1-based indexing
    for (let i = 0; i < index; i++) {
      if (mediaItems[i].type === 'bandcamp') {
        bandcampIndex++;
      }
    }
    
    console.log(`[clickBandcampPlayButtonByXPath] Looking for Bandcamp play button at index ${bandcampIndex} (item ${index} is the ${bandcampIndex}th Bandcamp item)`);
    
    // Use XPath to find all play buttons across all iframes, then click the one at our index
    const allPlayButtons = [];
    
    // Iterate through all Bandcamp iframes in order
    const sortedBandcampIndices = Object.keys(bandcampIframes.current)
      .map(Number)
      .sort((a, b) => a - b);
    
    for (const iframeIndex of sortedBandcampIndices) {
      const iframe = bandcampIframes.current[iframeIndex];
      if (!iframe || !iframe.contentWindow) {
        continue;
      }
      
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        // Use XPath to find big_play_icon elements (following user's example pattern)
        const xpath = "//div[@id='big_play_icon']";
        const result = iframeDoc.evaluate(xpath, iframeDoc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        
        // Collect all play buttons from this iframe
        for (let i = 0; i < result.snapshotLength; i++) {
          const playButton = result.snapshotItem(i);
          if (playButton) {
            allPlayButtons.push(playButton);
          }
        }
      } catch (e) {
        console.warn(`[clickBandcampPlayButtonByXPath] Cannot access iframe at index ${iframeIndex} (CORS):`, e.message);
      }
    }
    
    console.log(`[clickBandcampPlayButtonByXPath] Found ${allPlayButtons.length} play buttons total, looking for index ${bandcampIndex - 1} (0-based)`);
    
    // Click the play button at the calculated index (convert to 0-based)
    const buttonIndex = bandcampIndex - 1;
    if (buttonIndex < allPlayButtons.length && buttonIndex >= 0) {
      try {
        allPlayButtons[buttonIndex].click();
        console.log(`[clickBandcampPlayButtonByXPath] Successfully clicked play button at index ${buttonIndex}`);
        return true;
      } catch (e) {
        console.error(`[clickBandcampPlayButtonByXPath] Error clicking play button:`, e);
        return false;
      }
    } else {
      console.warn(`[clickBandcampPlayButtonByXPath] Index ${buttonIndex} out of range (found ${allPlayButtons.length} buttons)`);
      return false;
    }
  };

  // Helper function to control Bandcamp player via audio element
  const controlBandcampAudio = (index, command) => {
    const audio = bandcampAudioElements.current[index];
    if (!audio) {
      console.warn(`[controlBandcampAudio] No audio element found for index ${index}`);
      return false;
    }
    
    try {
      if (command === 'play') {
        audio.play().then(() => {
          console.log(`[controlBandcampAudio] Audio playback started`);
          setIsPlaying(true);
        }).catch(error => {
          console.error(`[controlBandcampAudio] Error playing audio:`, error);
        });
        return true;
      } else if (command === 'pause') {
        audio.pause();
        console.log(`[controlBandcampAudio] Audio playback paused`);
        setIsPlaying(false);
        return true;
      }
    } catch (error) {
      console.error(`[controlBandcampAudio] Error controlling audio:`, error);
      return false;
    }
    return false;
  };

  // Helper function to control Bandcamp player via postMessage
  const controlBandcampPostMessage = (index, command) => {
    const iframe = bandcampIframes.current[index];
    if (!iframe || !iframe.contentWindow) {
      console.warn(`[controlBandcampPostMessage] No iframe found for index ${index}`);
      return false;
    }
    
    try {
      console.log(`[controlBandcampPostMessage] Attempting to send ${command} to Bandcamp player at index ${index}`);
      
      // Try multiple postMessage formats and origins
      const origins = ['https://bandcamp.com', 'https://*.bandcamp.com', '*'];
      const messages = [
        {command: command},
        {method: command},
        {action: command},
        {type: command},
        {event: command},
        command,
        JSON.stringify({command: command}),
        JSON.stringify({method: command}),
        JSON.stringify({action: command})
      ];
      
      // Send messages with all combinations
      origins.forEach(origin => {
        messages.forEach(msg => {
          try {
            iframe.contentWindow.postMessage(msg, origin);
            console.log(`[controlBandcampPostMessage] Sent:`, msg, `to origin:`, origin);
          } catch (e) {
            // Some origins might fail, that's okay
          }
        });
      });
      
      // Also try sending to the iframe's src origin
      try {
        const iframeSrc = new URL(iframe.src);
        const iframeOrigin = `${iframeSrc.protocol}//${iframeSrc.host}`;
        messages.forEach(msg => {
          try {
            iframe.contentWindow.postMessage(msg, iframeOrigin);
            console.log(`[controlBandcampPostMessage] Sent:`, msg, `to iframe origin:`, iframeOrigin);
          } catch (e) {
            // Ignore
          }
        });
      } catch (e) {
        // Ignore URL parsing errors
      }
      
      return true;
    } catch (error) {
      console.error(`[controlBandcampPostMessage] Error:`, error);
      return false;
    }
  };

  // Main function to control Bandcamp player - tries multiple methods
  const controlBandcampPlayer = (index, command) => {
    console.log(`[controlBandcampPlayer] Attempting ${command} on Bandcamp player at index ${index}`);
    
    if (command !== 'play' && command !== 'pause') {
      return false;
    }
    
    // Validate the index is valid
    if (index < 0 || index >= mediaItems.length) {
      console.warn(`[controlBandcampPlayer] Invalid index ${index} (mediaItems length: ${mediaItems.length})`);
      return false;
    }
    
    const item = mediaItems[index];
    if (!item || item.type !== 'bandcamp') {
      console.warn(`[controlBandcampPlayer] Item at index ${index} is not a Bandcamp item`);
      return false;
    }
    
    // Method 1: Try using the audio element if we have a stream URL (most reliable)
    const streamUrl = bandcampStreamUrls.current[index];
    if (streamUrl) {
      const audioResult = controlBandcampAudio(index, command);
      if (audioResult) {
        console.log(`[controlBandcampPlayer] Audio element method succeeded`);
        return true;
      }
    }
    
    // If we don't have a stream URL yet, try to extract it first
    if (!streamUrl) {
      console.log(`[controlBandcampPlayer] No stream URL found, attempting to extract...`);
      extractBandcampStreamUrl(item).then(url => {
        if (url) {
          console.log(`[controlBandcampPlayer] Stream URL extracted, retrying play...`);
          // Retry with the audio element now that we have the URL
          controlBandcampAudio(index, command);
        } else {
          console.warn(`[controlBandcampPlayer] Failed to extract stream URL`);
        }
      }).catch(error => {
        console.error(`[controlBandcampPlayer] Error extracting stream URL:`, error);
      });
    }
    
    const iframe = bandcampIframes.current[index];
    if (!iframe || !iframe.contentWindow) {
      console.warn(`[controlBandcampPlayer] No iframe found for index ${index}`);
      // Don't return false yet - we might still be able to use audio element
      // Return false only if we also don't have a stream URL
      if (!streamUrl) {
        return false;
      }
    }
    
    // Method 2: Try postMessage (works cross-origin, but Bandcamp may not listen)
    if (iframe && iframe.contentWindow) {
      const postMessageResult = controlBandcampPostMessage(index, 'play');
      if (postMessageResult) {
        console.log(`[controlBandcampPlayer] postMessage method attempted`);
        // Don't return true here since Bandcamp likely doesn't listen
      }
      
      // Method 3: Try direct DOM access (may work if same-origin or in some browsers)
      const directAccessResult = clickBandcampPlayButton(index);
      if (directAccessResult) {
        console.log(`[controlBandcampPlayer] Direct DOM access method succeeded`);
        return true;
      }
      
      // Method 4: Try clicking at the center of the iframe (where play button typically is)
      try {
        const rect = iframe.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // Create a click event at the center coordinates
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: centerX,
          clientY: centerY,
          screenX: centerX + window.screenX,
          screenY: centerY + window.screenY,
          button: 0,
          buttons: 1
        });
        
        // Try dispatching on the iframe element
        iframe.dispatchEvent(clickEvent);
        
        // Also try focusing the iframe and sending keyboard events
        iframe.focus();
        const keyEvent = new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          keyCode: 32,
          which: 32,
          bubbles: true,
          cancelable: true
        });
        iframe.dispatchEvent(keyEvent);
        
        console.log(`[controlBandcampPlayer] Tried clicking at iframe center (${centerX}, ${centerY})`);
      } catch (error) {
        console.warn(`[controlBandcampPlayer] Error with coordinate-based click:`, error);
      }
    }
    
    // If we have a stream URL, the audio element method should work
    // If not, we've tried all methods
    if (streamUrl) {
      console.log(`[controlBandcampPlayer] Stream URL available, audio element should handle playback`);
      return true;
    }
    
    console.warn(`[controlBandcampPlayer] All methods attempted for index ${index} (may require manual interaction)`);
    return false;
  };

  // Handle previous track
  const handlePrevious = () => {
    if (currentTrackIndex > 0) {
      console.log(`[handlePrevious] Rewinding from track ${currentTrackIndex + 1} to track ${currentTrackIndex}`);
      
      // Check if we're navigating away from a Bandcamp link
      const currentTrack = mediaItems[currentTrackIndex];
      if (currentTrack && currentTrack.type === 'bandcamp') {
        console.log('BANDCAMP_PAUSE');
      }
      
      // Pause ALL YouTube and Bandcamp players first
      pauseAllYouTubePlayers();
      pauseAllBandcampPlayers();
      
      const prevIndex = currentTrackIndex - 1;
      setCurrentTrackIndex(prevIndex);
      
      // Special handling for track 1 (index 0) - always scroll to absolute top
      if (prevIndex === 0) {
        console.log('[handlePrevious] Rewinding to track 1 - scrolling to top with window.scrollTo(0, 0)');
        window.scrollTo(0, 0);
      } else {
        scrollToPlayer(prevIndex);
      }
      
      // Auto-play the previous track if it's YouTube or Bandcamp
      const prevTrack = mediaItems[prevIndex];
      if (prevTrack && prevTrack.type === 'youtube') {
        // Wait a bit for the player to be ready, then play
        const tryPlay = (attempts = 0) => {
          const prevPlayer = youtubePlayers.current[prevIndex];
          if (prevPlayer) {
            try {
              // Check if player is ready (getPlayerState returns -1 if not ready)
              const state = prevPlayer.getPlayerState();
              if (state !== undefined) {
                prevPlayer.playVideo();
                setIsPlaying(true);
              } else if (attempts < 10) {
                // Player not ready yet, try again
                setTimeout(() => tryPlay(attempts + 1), 100);
              } else {
                setIsPlaying(false);
              }
            } catch (error) {
              if (attempts < 10) {
                setTimeout(() => tryPlay(attempts + 1), 100);
              } else {
                console.error('Error playing previous YouTube video:', error);
                setIsPlaying(false);
              }
            }
          } else if (attempts < 10) {
            setTimeout(() => tryPlay(attempts + 1), 100);
          } else {
            setIsPlaying(false);
          }
        };
        tryPlay();
      } else if (prevTrack && prevTrack.type === 'bandcamp') {
        // Auto-play Bandcamp track - focused on Bandcamp link
        console.log('BANDCAMP_PLAY');
        controlBandcampPlayer(prevIndex, 'play');
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
      }
    }
  };

  // Handle next track
  const handleNext = () => {
    // Use refs to get latest values (important when called from event listeners)
    const currentIndex = currentTrackIndexRef.current;
    const items = mediaItemsRef.current;
    
    if (currentIndex < items.length - 1) {
      console.log(`[handleNext] Fast forwarding from track ${currentIndex + 1} to track ${currentIndex + 2}`);
      
      // Check if we're navigating away from a Bandcamp link
      const currentTrack = items[currentIndex];
      if (currentTrack && currentTrack.type === 'bandcamp') {
        console.log('BANDCAMP_PAUSE');
      }
      
      // Pause ALL YouTube and Bandcamp players first
      pauseAllYouTubePlayers();
      pauseAllBandcampPlayers();
      
      const nextIndex = currentIndex + 1;
      setCurrentTrackIndex(nextIndex);
      scrollToPlayer(nextIndex);
      
      // Auto-play the next track if it's YouTube or Bandcamp
      const nextTrack = items[nextIndex];
      if (nextTrack && nextTrack.type === 'youtube') {
        // Wait a bit for the player to be ready, then play
        const tryPlay = (attempts = 0) => {
          const nextPlayer = youtubePlayers.current[nextIndex];
          if (nextPlayer) {
            try {
              // Check if player is ready (getPlayerState returns -1 if not ready)
              const state = nextPlayer.getPlayerState();
              if (state !== undefined) {
                nextPlayer.playVideo();
                setIsPlaying(true);
              } else if (attempts < 10) {
                // Player not ready yet, try again
                setTimeout(() => tryPlay(attempts + 1), 100);
              } else {
                setIsPlaying(false);
              }
            } catch (error) {
              if (attempts < 10) {
                setTimeout(() => tryPlay(attempts + 1), 100);
              } else {
                console.error('Error playing next YouTube video:', error);
                setIsPlaying(false);
              }
            }
          } else if (attempts < 10) {
            setTimeout(() => tryPlay(attempts + 1), 100);
          } else {
            setIsPlaying(false);
          }
        };
        tryPlay();
      } else if (nextTrack && nextTrack.type === 'bandcamp') {
        // Auto-play Bandcamp track - focused on Bandcamp link
        console.log('BANDCAMP_PLAY');
        controlBandcampPlayer(nextIndex, 'play');
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
      }
    }
  };

  const headerBg = darkenColor(colors.Vibrant || '#667eea', 0.2);
  const contentBg = darkenColor(colors.LightMuted || '#f8f9fa', 0.1);
  const textColor = getReadableTextColor(headerBg);
  const contentTextColor = getReadableTextColor(contentBg);
  
  const currentTrack = mediaItems[currentTrackIndex];
  const thumbnailUrl = currentTrack ? getThumbnailUrl(currentTrack) : null;

  const renderMediaPlayer = (item) => {
    try {
      if (!item.embedUrl && item.type !== 'youtube') {
        return (
          <div style={{ padding: '1rem', textAlign: 'center', opacity: 0.7 }}>
            <p>Unable to embed: {item.url}</p>
            <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
              Open in new tab
            </a>
          </div>
        );
      }

      switch (item.type) {
      case 'youtube':
        return (
          <div id={`youtube-player-${item.index}`} className={styles.youtubePlayer}></div>
        );
      
      case 'spotify':
        return (
          <iframe
            src={item.embedUrl}
            className={styles.spotifyPlayer}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            title={`Spotify player ${item.index + 1}`}
          />
        );
      
      case 'soundcloud':
        return (
          <iframe
            src={item.embedUrl}
            className={styles.soundcloudPlayer}
            scrolling="no"
            frameBorder="no"
            allow="autoplay"
            title={`SoundCloud player ${item.index + 1}`}
          />
        );
      
      case 'bandcamp':
        const streamUrl = bandcampStreamUrls.current[item.index];
        const metadata = bandcampMetadata.current[item.index] || {};
        const isCurrentTrack = currentTrackIndex === item.index;
        const isCurrentPlaying = isCurrentTrack && isPlaying;
        
        // Format duration to hh:mm:ss or mm:ss
        const formatDuration = (dur) => {
          if (!dur || isNaN(dur) || dur <= 0) return null;
          const hours = Math.floor(dur / 3600);
          const mins = Math.floor((dur % 3600) / 60);
          const secs = Math.floor(dur % 60);
          
          if (hours > 0) {
            return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
          } else {
            return `${mins}:${secs.toString().padStart(2, '0')}`;
          }
        };
        
        const formattedDuration = formatDuration(metadata.duration);
        
        // Build URLs for links
        const baseUrl = item.url.startsWith('http') ? item.url : `https://${item.url}`;
        const trackUrl = baseUrl;
        const artistUrl = metadata.artist ? baseUrl.split('/track/')[0].split('/album/')[0] : null;
        const albumUrl = metadata.album ? baseUrl.split('/track/')[0] : null;
        
        return (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'row', 
            alignItems: 'center', 
            gap: '0.75rem',
            padding: '0.5rem',
            background: '#ffffff',
            borderRadius: '4px',
            transition: 'all 0.2s ease',
            minHeight: '60px',
            border: isCurrentTrack ? '2px solid rgba(0, 0, 0, 0.1)' : '1px solid rgba(0, 0, 0, 0.05)'
          }}>
            {metadata.artwork && (
              <img 
                src={metadata.artwork} 
                alt={metadata.title || 'Track artwork'}
                style={{
                  width: '50px',
                  height: '50px',
                  objectFit: 'cover',
                  borderRadius: '4px',
                  flexShrink: 0
                }}
              />
            )}
            <div style={{ 
              flex: 1, 
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem'
            }}>
              {metadata.title && (
                <div style={{ 
                  fontSize: '0.9rem', 
                  fontWeight: isCurrentTrack ? '600' : '400',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  <a 
                    href={trackUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ 
                      color: 'inherit', 
                      textDecoration: 'none'
                    }}
                    onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                    onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                  >
                    {metadata.title}
                  </a>
                </div>
              )}
              <div style={{ 
                display: 'flex', 
                gap: '0.5rem', 
                fontSize: '0.75rem', 
                opacity: 0.7,
                flexWrap: 'wrap'
              }}>
                {metadata.artist && (
                  <span>
                    {artistUrl ? (
                      <a 
                        href={artistUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ 
                          color: 'inherit', 
                          textDecoration: 'none'
                        }}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                      >
                        {metadata.artist}
                      </a>
                    ) : (
                      metadata.artist
                    )}
                  </span>
                )}
                {metadata.album && metadata.album !== metadata.artist && (
                  <span>
                    • {albumUrl ? (
                      <a 
                        href={albumUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ 
                          color: 'inherit', 
                          textDecoration: 'none'
                        }}
                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                      >
                        {metadata.album}
                      </a>
                    ) : (
                      metadata.album
                    )}
                  </span>
                )}
                {formattedDuration && (
                  <span>• {formattedDuration}</span>
                )}
              </div>
              {isCurrentPlaying && (
                <div style={{ 
                  fontSize: '0.7rem',
                  color: '#22c55e',
                  fontWeight: '500',
                  marginTop: '0.25rem'
                }}>
                  ▶ Now Playing
                </div>
              )}
            </div>
            {streamUrl && (
              <audio
                ref={(el) => { 
                  if (el) {
                    bandcampAudioElements.current[item.index] = el;
                    el.volume = volume; // Set volume when element is created
                    
                    // Add time update listener
                    el.addEventListener('timeupdate', () => {
                      if (currentTrackIndex === item.index && !isDragging) {
                        setCurrentTime(el.currentTime || 0);
                      }
                    });
                    
                    el.addEventListener('loadedmetadata', () => {
                      if (currentTrackIndex === item.index && el.duration && !isNaN(el.duration)) {
                        setDuration(el.duration);
                      }
                    });
                    
                    // Add ended event listener for autoplay
                    el.addEventListener('ended', () => {
                      const currentIndex = currentTrackIndexRef.current;
                      const playing = isPlayingRef.current;
                      const items = mediaItemsRef.current;
                      // Only autoplay next if this is the current track and it's playing
                      if (currentIndex === item.index && playing) {
                        console.log(`[Bandcamp] Track ${item.index + 1} ended, autoplaying next track`);
                        // Check if there's a next track
                        if (currentIndex < items.length - 1) {
                          handleNext();
                        } else {
                          // Last track ended, just stop playing
                          setIsPlaying(false);
                        }
                      }
                    });
                  }
                }}
                src={streamUrl}
                style={{ display: 'none' }}
                preload="metadata"
                onLoadedMetadata={() => {
                  const audio = bandcampAudioElements.current[item.index];
                  if (audio) {
                    audio.volume = volume;
                    if (audio.duration && !isNaN(audio.duration)) {
                      setDuration(audio.duration);
                    }
                  }
                }}
              >
                No HTML5 support. Get with it.
              </audio>
            )}
          </div>
        );
      
      default:
        return (
          <div style={{ padding: '1rem', textAlign: 'center', opacity: 0.7 }}>
            <p>Unknown media type: {item.url}</p>
            <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
              Open in new tab
            </a>
          </div>
        );
      }
    } catch (error) {
      console.error(`Error rendering media player for item ${item.index}:`, error);
      console.error(`  Item details:`, item);
      return (
        <div style={{ padding: '1rem', textAlign: 'center', opacity: 0.7, color: '#ff4444' }}>
          <p>Error loading media: {error.message}</p>
          <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>URL: {item.url}</p>
          <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', marginTop: '0.5rem', display: 'block' }}>
            Open in new tab
          </a>
        </div>
      );
    }
  };

  return (
    <div className={styles.container}>
      {/* Sticky Footer Controls */}
      {mediaItems.length > 0 && (
        <div 
          className={styles.stickyFooter}
          style={{ 
            background: headerBg,
            color: textColor,
            borderTop: `2px solid ${textColor}20`,
            paddingBottom: duration > 0 ? '20px' : '0'
          }}
        >
          <div className={styles.footerLeft}>
            {currentTrack && currentTrack.type === 'bandcamp' && bandcampMetadata.current[currentTrackIndex]?.artwork ? (
              <img 
                src={bandcampMetadata.current[currentTrackIndex].artwork} 
                alt={bandcampMetadata.current[currentTrackIndex].title || 'Track artwork'}
                className={styles.footerThumbnail}
              />
            ) : thumbnailUrl ? (
              <img 
                src={thumbnailUrl} 
                alt="Current track thumbnail"
                className={styles.footerThumbnail}
              />
            ) : currentTrack ? (
              <div className={styles.footerThumbnailPlaceholder}>
                <span>{currentTrack.type.charAt(0).toUpperCase()}</span>
              </div>
            ) : null}
            {currentTrack && (
              <div className={styles.footerTrackInfo}>
                <div className={styles.footerTrackTitle}>
                  {currentTrack.type === 'bandcamp' && bandcampMetadata.current[currentTrackIndex]?.title
                    ? bandcampMetadata.current[currentTrackIndex].title
                    : currentTrack.url.length > 50 
                      ? `${currentTrack.url.substring(0, 50)}...` 
                      : currentTrack.url}
                </div>
                <div className={styles.footerTrackNumber}>
                  {currentTrack.type === 'bandcamp' && bandcampMetadata.current[currentTrackIndex]?.artist
                    ? `${bandcampMetadata.current[currentTrackIndex].artist} • Track ${currentTrackIndex + 1} of ${mediaItems.length}`
                    : `Track ${currentTrackIndex + 1} of ${mediaItems.length}`}
                </div>
              </div>
            )}
          </div>
          
          <div className={styles.footerControls}>
            <button
              onClick={handlePrevious}
              disabled={currentTrackIndex === 0}
              className={styles.controlButton}
              aria-label="Previous track"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
              </svg>
            </button>
            
            <button
              onClick={handlePlayPause}
              className={styles.controlButton}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 4h4v16H6zm8 0h4v16h-4z"/>
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>
            
            <button
              onClick={handleNext}
              disabled={currentTrackIndex === mediaItems.length - 1}
              className={styles.controlButton}
              aria-label="Next track"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
            
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem',
              marginLeft: '1rem',
              minWidth: '120px'
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}>
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                style={{
                  width: '100px',
                  cursor: 'pointer'
                }}
                aria-label="Volume"
              />
              <span style={{ fontSize: '0.85rem', opacity: 0.7, minWidth: '35px' }}>
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
          
          {/* Progress Bar */}
          {duration > 0 && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '4px',
              background: 'rgba(255, 255, 255, 0.2)',
              cursor: 'pointer'
            }}
            onMouseDown={(e) => {
              setIsDragging(true);
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              const newTime = Math.max(0, Math.min(duration, percent * duration));
              setCurrentTime(newTime);
              
              // Seek in the current player
              const currentTrack = mediaItems[currentTrackIndex];
              if (currentTrack) {
                if (currentTrack.type === 'bandcamp') {
                  const audio = bandcampAudioElements.current[currentTrackIndex];
                  if (audio) {
                    audio.currentTime = newTime;
                  }
                } else if (currentTrack.type === 'youtube') {
                  const player = youtubePlayers.current[currentTrackIndex];
                  if (player && player.seekTo) {
                    try {
                      player.seekTo(newTime, true);
                    } catch (error) {
                      console.error('Error seeking YouTube:', error);
                    }
                  }
                }
              }
            }}
            onMouseMove={(e) => {
              if (isDragging && e.buttons === 1) {
                const rect = e.currentTarget.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                const newTime = Math.max(0, Math.min(duration, percent * duration));
                setCurrentTime(newTime);
              }
            }}
            onMouseUp={(e) => {
              if (isDragging) {
                const rect = e.currentTarget.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                const newTime = Math.max(0, Math.min(duration, percent * duration));
                setCurrentTime(newTime);
                
                // Seek in the current player
                const currentTrack = mediaItems[currentTrackIndex];
                if (currentTrack) {
                  if (currentTrack.type === 'bandcamp') {
                    const audio = bandcampAudioElements.current[currentTrackIndex];
                    if (audio) {
                      audio.currentTime = newTime;
                    }
                  } else if (currentTrack.type === 'youtube') {
                    const player = youtubePlayers.current[currentTrackIndex];
                    if (player && player.seekTo) {
                      try {
                        player.seekTo(newTime, true);
                      } catch (error) {
                        console.error('Error seeking YouTube:', error);
                      }
                    }
                  }
                }
              }
              setIsDragging(false);
            }}
            onMouseLeave={() => {
              if (isDragging) {
                setIsDragging(false);
              }
            }}
            >
              <div style={{
                height: '100%',
                width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                background: textColor,
                transition: isDragging ? 'none' : 'width 0.1s linear',
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute',
                  right: '-6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: textColor,
                  cursor: 'grab',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }} />
              </div>
            </div>
          )}
          
          {/* Time Display */}
          {duration > 0 && (
            <div style={{
              position: 'absolute',
              bottom: '8px',
              right: '1rem',
              fontSize: '0.75rem',
              opacity: 0.7,
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center'
            }}>
              <span>
                {(() => {
                  const formatTime = (time) => {
                    if (!time || isNaN(time)) return '0:00';
                    const hours = Math.floor(time / 3600);
                    const mins = Math.floor((time % 3600) / 60);
                    const secs = Math.floor(time % 60);
                    if (hours > 0) {
                      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                    }
                    return `${mins}:${secs.toString().padStart(2, '0')}`;
                  };
                  return formatTime(currentTime);
                })()}
              </span>
              <span>/</span>
              <span>
                {(() => {
                  const formatTime = (time) => {
                    if (!time || isNaN(time)) return '0:00';
                    const hours = Math.floor(time / 3600);
                    const mins = Math.floor((time % 3600) / 60);
                    const secs = Math.floor(time % 60);
                    if (hours > 0) {
                      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                    }
                    return `${mins}:${secs.toString().padStart(2, '0')}`;
                  };
                  return formatTime(duration);
                })()}
              </span>
            </div>
          )}
        </div>
      )}

      <div 
        className={styles.header}
        style={{ 
          background: headerBg,
          color: textColor
        }}
      >
        <h1>Universal Playlist</h1>
        <p className={styles.subtitle}>Multi-platform media playlist</p>
      </div>
      
      <div 
        className={styles.content}
        style={{ 
          background: contentBg,
          color: contentTextColor
        }}
      >
        {error ? (
          <div className={styles.emptyState}>
            <p style={{ color: 'red' }}>Error parsing media URLs: {error}</p>
            <p style={{ marginTop: '1rem', opacity: 0.7 }}>
              Please check the URL format. Expected JSON array format.
            </p>
          </div>
        ) : mediaItems.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No media URLs found. Use the URL format: <code>/universalplaylist/{'{JSON array}'}</code></p>
            <p style={{ marginTop: '1rem', opacity: 0.7 }}>
              Example: <code>/universalplaylist/{'["gST2Fac1mCo","YnpdVZVyXvw","balaclavarecords.bandcamp.com/album/ep01"]'}</code>
            </p>
          </div>
        ) : (
          <div className={styles.playlistContainer}>
            <h2>Playlist ({mediaItems.length} {mediaItems.length === 1 ? 'item' : 'items'}):</h2>
            <div className={styles.playersList}>
              {mediaItems.map((item, index) => (
                <div 
                  key={index}
                  ref={(el) => { playerRefs.current[`player-${index}`] = el; }}
                  className={`${styles.playerWrapper} ${currentTrackIndex === index && isPlaying ? styles.activePlayer : ''}`}
                >
                  <div className={styles.playerHeader}>
                    <span className={styles.playerNumber}>{index + 1}</span>
                    <a 
                      href={item.url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className={styles.playerLink}
                    >
                      {item.url}
                    </a>
                  </div>
                  {renderMediaPlayer(item)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

