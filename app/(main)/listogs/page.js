'use client';
import React, { useState, useEffect, Suspense, useContext, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import io from 'socket.io-client';
import VideoTable from './Table';
import { ColorContext } from '../ColorContext';

// Helper to flatten videoData object to array with deduplication
function flattenVideoData(videoData) {
  const rows = [];
  const seenVideoIds = new Set();
  
  if (!videoData) return rows;
  
  Object.values(videoData).forEach(releaseObj => {
    if (Array.isArray(releaseObj)) {
      releaseObj.forEach(video => {
        // Only add if we haven't seen this videoId before
        if (video && video.videoId && !seenVideoIds.has(video.videoId)) {
          seenVideoIds.add(video.videoId);
          rows.push(video);
        } else if (video && !video.videoId) {
          // Include videos without videoId (shouldn't happen but be safe)
          rows.push(video);
        }
      });
    } else if (releaseObj && typeof releaseObj === 'object') {
      Object.values(releaseObj).forEach(video => {
        // Only add if we haven't seen this videoId before
        if (video && video.videoId && !seenVideoIds.has(video.videoId)) {
          seenVideoIds.add(video.videoId);
          rows.push(video);
        } else if (video && !video.videoId) {
          // Include videos without videoId (shouldn't happen but be safe)
          rows.push(video);
        }
      });
    }
  });
  
  return rows;
}

// Helper to get all unique video IDs from results
function getAllVideoIds(videoData) {
  const ids = [];
  const seenVideoIds = new Set();
  
  if (!videoData) return ids;
  
  Object.values(videoData).forEach(releaseObj => {
    if (Array.isArray(releaseObj)) {
      releaseObj.forEach(video => {
        if (video && video.videoId && !seenVideoIds.has(video.videoId)) {
          seenVideoIds.add(video.videoId);
          ids.push(video.videoId);
        }
      });
    } else if (releaseObj && typeof releaseObj === 'object') {
      Object.values(releaseObj).forEach(video => {
        if (video && video.videoId && !seenVideoIds.has(video.videoId)) {
          seenVideoIds.add(video.videoId);
          ids.push(video.videoId);
        }
      });
    }
  });
  
  return ids;
}

function DiscogsAuthTestPageInner() {
  const [results, setResults] = useState([]);
  const params = useSearchParams();
  const router = useRouter();
  const oauthToken = params.get('oauth_token');
  const oauthVerifier = params.get('oauth_verifier');
  const { colors } = useContext(ColorContext);

  // Function to darken a color for better contrast
  const darkenColor = (color, amount = 0.3) => {
    if (!color || color === '#ffffff') return '#333333'; // fallback for white/undefined
    const hex = color.replace('#', '');
    const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - Math.floor(255 * amount));
    const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - Math.floor(255 * amount));
    const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - Math.floor(255 * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Get the button color from DarkMuted
  const buttonColor = colors?.DarkMuted || '#333333';

  // Helper: 1 year in ms (simulate expiry)
  const DISCOGS_AUTH_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

  // YouTube playlist creation state
  const [youtubeAuthStatus, setYoutubeAuthStatus] = useState({
    exists: false,
    code: null,
    scope: null,
    setTime: null,
    expiresAt: null
  });
  const [playlistData, setPlaylistData] = useState({
    title: '',
    description: '',
    privacyStatus: 'private'
  });
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistCreated, setPlaylistCreated] = useState(null);
  const [youtubeError, setYoutubeError] = useState('');
  const [discogsError, setDiscogsError] = useState('');
  const [playlistProgress, setPlaylistProgress] = useState({ added: 0, total: 0 });
  const [discogsInfo, setDiscogsInfo] = useState(null);
  const [currentSearchId, setCurrentSearchId] = useState(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [retryAfter, setRetryAfter] = useState(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [useExistingPlaylist, setUseExistingPlaylist] = useState(false);
  const [existingPlaylistId, setExistingPlaylistId] = useState('');

  /** Persist tokens in localStorage, along with set time */
  const storeDiscogsTokens = (token, verifier) => {
    try {
      localStorage.setItem('discogs_oauth_token', token);
      localStorage.setItem('discogs_oauth_verifier', verifier);
      localStorage.setItem('discogs_oauth_set_time', Date.now().toString());
    } catch (err) {
      console.error('❌ Failed to save tokens:', err);
    }
  };

  // On mount: if oauth_token and oauth_verifier exist, store and redirect
  useEffect(() => {
    if (oauthToken && oauthVerifier) {
      storeDiscogsTokens(oauthToken, oauthVerifier);
      // Redirect to /listogs without query params
      router.replace('/listogs');
    }
    // Only run on mount or when params change
  }, [oauthToken, oauthVerifier, router]);

  // Check localStorage for YouTube auth code and expiry
  useEffect(() => {
    const code = localStorage.getItem('youtube_auth_code');
    const scope = localStorage.getItem('youtube_auth_scope');
    const setTime = localStorage.getItem('youtube_auth_set_time');
    
    if (code && setTime) {
      const expiresAt = new Date(parseInt(setTime) + DISCOGS_AUTH_EXPIRY_MS);
      setYoutubeAuthStatus({
        exists: true,
        code: code,
        scope: scope || null,
        setTime: parseInt(setTime),
        expiresAt: expiresAt.getTime()
      });
    } else {
      setYoutubeAuthStatus({
        exists: false,
        code: null,
        scope: null,
        setTime: null,
        expiresAt: null
      });
    }
  }, []);

  // Discogs Auth Status state
  const [discogsAuthStatus, setDiscogsAuthStatus] = useState({
    exists: false,
    token: null,
    verifier: null,
    setTime: null,
    expiresAt: null
  });

  // Check localStorage for Discogs auth tokens and expiry
  useEffect(() => {
    const token = localStorage.getItem('discogs_oauth_token');
    const verifier = localStorage.getItem('discogs_oauth_verifier');
    const setTimeStr = localStorage.getItem('discogs_oauth_set_time');
    let setTime = setTimeStr ? parseInt(setTimeStr, 10) : null;
    let expiresAt = setTime ? setTime + DISCOGS_AUTH_EXPIRY_MS : null;
    setDiscogsAuthStatus({
      exists: !!(token && verifier),
      token,
      verifier,
      setTime,
      expiresAt
    });
  }, []);

  // Add a function to clear Discogs auth from localStorage
  const clearDiscogsAuth = () => {
    localStorage.removeItem('discogs_oauth_token');
    localStorage.removeItem('discogs_oauth_verifier');
    localStorage.removeItem('discogs_oauth_set_time');
    setDiscogsAuthStatus({
      exists: false,
      token: null,
      verifier: null,
      setTime: null,
      expiresAt: null
    });
  };

  // Persist results and form state in localStorage
  const storeListogsData = (results, discogsInput, extractedId, selectedType) => {
    try {
      localStorage.setItem('listogs_results', JSON.stringify(results));
      localStorage.setItem('listogs_discogs_input', discogsInput || '');
      localStorage.setItem('listogs_extracted_id', extractedId || '');
      localStorage.setItem('listogs_selected_type', selectedType || '');
    } catch (err) {
      console.error('❌ Failed to save listogs data:', err);
    }
  };

  // Load persisted data from localStorage
  const loadListogsData = () => {
    try {
      const savedResults = localStorage.getItem('listogs_results');
      const savedInput = localStorage.getItem('listogs_discogs_input');
      const savedId = localStorage.getItem('listogs_extracted_id');
      const savedType = localStorage.getItem('listogs_selected_type');
      
      if (savedResults) {
        setResults(JSON.parse(savedResults));
      }
      if (savedInput) {
        setDiscogsInput(savedInput);
      }
      if (savedId) {
        setExtractedId(savedId);
      }
      if (savedType) {
        setSelectedType(savedType);
      }
    } catch (err) {
      console.error('❌ Failed to load listogs data:', err);
    }
  };

  // Clear all listogs data
  const clearListogsData = () => {
    try {
      localStorage.removeItem('listogs_results');
      localStorage.removeItem('listogs_discogs_input');
      localStorage.removeItem('listogs_extracted_id');
      localStorage.removeItem('listogs_selected_type');
      setResults([]);
      setDiscogsInput('');
      setExtractedId('');
      setSelectedType(null);
      setLogLines([]);
      setSessionStatus(null);
    } catch (err) {
      console.error('❌ Failed to clear listogs data:', err);
    }
  };

  const [authUrl, setAuthUrl] = useState('');
  const [authUrlLoading, setAuthUrlLoading] = useState(true); // <-- Add loading state
  const getDiscogsURL = async () => {
    try {
      setAuthUrlLoading(true); // <-- Set loading true before fetch
      const apiBaseURL =
        process.env.NODE_ENV === 'development'
          ? 'http://localhost:3030'
          : 'https://www.martinbarker.me/internal-api';

      var queryUrl = `${apiBaseURL}/listogs/discogs/getURL`;
      console.log('🔗 [Frontend] Fetching Discogs auth URL from:', queryUrl);
      const res = await fetch(queryUrl);
      
      if (!res.ok) {
        const errorData = await res.json();
        console.error('❌ [Frontend] Error response:', {
          status: res.status,
          statusText: res.statusText,
          error: errorData
        });
        setAuthUrl(`Error ${res.status}: ${errorData.error || res.statusText}`);
        return;
      }
      
      const data = await res.json();
      console.log('✅ [Frontend] Successfully received auth URL');
      setAuthUrl(data.url || '');
    } catch (err) {
      console.error('❌ [Frontend] Network error fetching Discogs URL:', err);
      setAuthUrl(`Network Error: ${err.message}`);
    } finally {
      setAuthUrlLoading(false); // <-- Set loading false after fetch
    }
  };

  // Call getDiscogsURL on initial mount
  useEffect(() => {
    getDiscogsURL();
  }, []);

  // Load persisted data on mount
  useEffect(() => {
    loadListogsData();
  }, []);

  // Helper to format expiry date
  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString();
  }

  const [testDiscogsAuthResult, setTestDiscogsAuthResult] = useState(null);

  // Socket.io log state
  const [logLines, setLogLines] = useState([]);
  const [socket, setSocket] = useState(null);
  const [socketId, setSocketId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);

  // Ref for auto-scroll
  const logRef = React.useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Track last non-zero progress for rate limit display
  const lastProgressRef = React.useRef({
    currentIndex: 0,
    total: 0,
    currentVideoIndex: 0,
    totalVideoPages: 0,
    videos: 0
  });

  // Update lastProgressRef when sessionStatus.progress changes and not waiting for rate limit
  useEffect(() => {
    if (sessionStatus && sessionStatus.progress) {
      const { currentIndex, total, currentVideoIndex, totalVideoPages, videos } = sessionStatus.progress;
      // Only update if not waiting for rate limit and values are > 0
      if (
        sessionStatus.status !== 'Waiting for rate limit' &&
        ((currentIndex > 0 && total > 0) || (currentVideoIndex > 0 && totalVideoPages > 0))
      ) {
        lastProgressRef.current = {
          currentIndex: currentIndex || lastProgressRef.current.currentIndex,
          total: total || lastProgressRef.current.total,
          currentVideoIndex: currentVideoIndex || lastProgressRef.current.currentVideoIndex,
          totalVideoPages: totalVideoPages || lastProgressRef.current.totalVideoPages,
          videos: typeof videos !== 'undefined' ? videos : lastProgressRef.current.videos
        };
      }
      // Always update videos count if present
      if (typeof videos !== 'undefined') {
        lastProgressRef.current.videos = videos;
      }
    }
  }, [sessionStatus]);

  // Auto-scroll progress log to bottom when logLines change, unless user scrolled up
  useEffect(() => {
    if (logRef.current && autoScroll) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines, autoScroll]);

  // Handler to detect user scroll and disable auto-scroll if not at bottom
  const handleLogScroll = () => {
    if (logRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logRef.current;
      // If user is not at the bottom, disable auto-scroll
      if (scrollTop + clientHeight < scrollHeight - 2) {
        setAutoScroll(false);
      } else {
        setAutoScroll(true);
      }
    }
  };

  useEffect(() => {
    // Connect to socket.io server
    const isDev = process.env.NODE_ENV === 'development';
    const socketUrl = isDev
      ? 'http://localhost:3030'
      : 'https://www.martinbarker.me';
    const socketPath = isDev
      ? '/socket.io'
      : '/internal-api/socket.io';


    const sock = io(socketUrl, {
      withCredentials: true,
      path: socketPath
    });
    setSocket(sock);

    sock.on('connect', () => {
      setSocketId(sock.id);
    });

    sock.on('connect_error', (err) => {
      console.error('[Socket.IO] connect_error →', err.message);
    });

    // Listen for session log events (per-session)
    sock.on('sessionLog', (msg) => {
      setLogLines(prev => [...prev, msg]);
    });

    // Listen for session results
    sock.on('sessionResults', (result) => {
      //setResults(result);
    });

    // Listen for videos 
    sock.on('sessionVideos', (videos) => {
      // --- Remove duplicate videoIds ---
      let uniqueVideos;
      if (Array.isArray(videos)) {
        const seen = new Set();
        uniqueVideos = videos.filter(v => {
          if (!v.videoId) return true;
          if (seen.has(v.videoId)) return false;
          seen.add(v.videoId);
          return true;
        });
      } else if (typeof videos === 'object' && videos !== null) {
        // If videos is an object of releases, deduplicate within all releases
        const seen = new Set();
        uniqueVideos = {};
        Object.entries(videos).forEach(([releaseKey, releaseVideos]) => {
          if (Array.isArray(releaseVideos)) {
            uniqueVideos[releaseKey] = releaseVideos.filter(v => {
              if (!v.videoId) return true;
              if (seen.has(v.videoId)) return false;
              seen.add(v.videoId);
              return true;
            });
          } else {
            // If not array, just assign
            uniqueVideos[releaseKey] = releaseVideos;
          }
        });
      } else {
        uniqueVideos = videos;
      }
      setResults(prev => {
        let newResults;
        // If prev is empty, just set uniqueVideos
        if (!prev || prev.length === 0) {
          newResults = uniqueVideos;
        } else if (Array.isArray(uniqueVideos)) {
          // Merge and deduplicate with previous results
          const seen = new Set();
          newResults = [...prev, ...uniqueVideos].filter(v => {
            if (!v.videoId) return true;
            if (seen.has(v.videoId)) return false;
            seen.add(v.videoId);
            return true;
          });
        } else if (typeof uniqueVideos === 'object' && uniqueVideos !== null) {
          // Merge releases, deduplicate videoIds across all releases
          const merged = { ...prev, ...uniqueVideos };
          const seen = new Set();
          Object.keys(merged).forEach(releaseKey => {
            if (Array.isArray(merged[releaseKey])) {
              merged[releaseKey] = merged[releaseKey].filter(v => {
                if (!v.videoId) return true;
                if (seen.has(v.videoId)) return false;
                seen.add(v.videoId);
                return true;
              });
            }
          });
          newResults = merged;
        } else {
          newResults = uniqueVideos;
        }
        
        // Save to localStorage - use saved input if available
        const savedInput = localStorage.getItem('listogs_discogs_input');
        storeListogsData(newResults, savedInput || discogsInput, extractedId, selectedType);
        
        // Trigger auto-populate after results are updated
        setTimeout(() => {
          if (newResults && (Array.isArray(newResults) ? newResults.length > 0 : Object.keys(newResults).length > 0)) {
            console.log('Socket handler triggering autoPopulatePlaylistData with searchId:', currentSearchId);
            autoPopulatePlaylistData(currentSearchId);
          }
        }, 100);
        
        return newResults;
      });
    });

    // Listen for status updates 
    sock.on('sessionStatus', (status) => {
      setSessionStatus(status); // <-- Save status to state
    });

    // Add beforeunload listener to ensure socket disconnection
    const handleBeforeUnload = () => {
      if (sock) {
        sock.disconnect();
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      sock.disconnect();
    };
  }, []);

  // Query /discogs/api endpoint with Discogs type, discogs id, oauthToken, and socketId
  const discogsApiQuery = async (discogsType, discogsId) => {
    try {
      setLogLines([]); // Clear logs before each request
      const apiBaseURL =
        process.env.NODE_ENV === 'development'
          ? 'http://localhost:3030'
          : 'https://www.martinbarker.me/internal-api';

      if (!discogsType || !discogsId) {
        console.error('❌ [Frontend] discogsApiQuery() - discogsType or discogsId is missing');
        return;
      }
      const oauthToken = discogsAuthStatus.token;
      const oauthVerifier = discogsAuthStatus.verifier;
      if (!oauthToken || !oauthVerifier) {
        console.error('❌ [Frontend] discogsApiQuery() - Missing oauthToken or oauthVerifier');
        setTestDiscogsAuthResult({ error: 'Missing oauthToken or oauthVerifier' });
        return;
      }

      const requestUrl = `${apiBaseURL}/discogs/api`;
      console.log('🔍 [Frontend] Making Discogs API request to:', requestUrl);

      const res = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          discogsType,
          discogsId,
          oauthToken,
          oauthVerifier,
          socketId
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        console.error('❌ [Frontend] Discogs API error response:', {
          status: res.status,
          statusText: res.statusText,
          error: errorData
        });
        setTestDiscogsAuthResult({ 
          error: `API Error ${res.status}: ${errorData.error || res.statusText}`,
          details: errorData.details
        });
        return;
      }

      const data = await res.json();
      console.log('✅ [Frontend] Discogs API success:', data);
      setTestDiscogsAuthResult(data);
    } catch (err) {
      console.error('❌ [Frontend] Network error in discogsApiQuery:', err);
      setTestDiscogsAuthResult({ error: `Network Error: ${err.message}` });
    }
  };

  // --- Discogs URL Submit Form State ---
  const [discogsInput, setDiscogsInput] = useState('');
  const [extractedId, setExtractedId] = useState('');
  const [selectedType, setSelectedType] = useState(null);
  const [inputError, setInputError] = useState('');
  const [discogsResponse, setDiscogsResponse] = useState('');

  // Discogs input change handler (copied logic)
  const handleInputChange = (value) => {
    setDiscogsInput(value);
    setInputError('');
    setExtractedId('');
    setSelectedType(null);
    
    // Save current form state
    storeListogsData(results, value, '', null);

    // Try matching URLs first
    const artistMatch = value.match(/discogs\.com\/artist\/(\d+)/);
    if (artistMatch && artistMatch[1]) {
      setExtractedId(artistMatch[1]);
      setSelectedType('artist');
      storeListogsData(results, value, artistMatch[1], 'artist');
      return;
    }

    const labelMatch = value.match(/discogs\.com\/label\/(\d+)/);
    if (labelMatch && labelMatch[1]) {
      setExtractedId(labelMatch[1]);
      setSelectedType('label');
      storeListogsData(results, value, labelMatch[1], 'label');
      return;
    }

    const releaseMatch = value.match(/discogs\.com\/release\/(\d+)/);
    if (releaseMatch && releaseMatch[1]) {
      setExtractedId(releaseMatch[1]);
      setSelectedType('release');
      storeListogsData(results, value, releaseMatch[1], 'release');
      return;
    }

    // Improved list URL detection: match /lists/.../<id> at end of URL
    const listMatch = value.match(/discogs\.com\/lists\/[^\/]+\/(\d+)/);
    if (listMatch && listMatch[1]) {
      setExtractedId(listMatch[1]);
      setSelectedType('list');
      storeListogsData(results, value, listMatch[1], 'list');
      return;
    }
    // Also match /lists/<id> (simple form)
    const listMatchSimple = value.match(/discogs\.com\/lists\/(\d+)/);
    if (listMatchSimple && listMatchSimple[1]) {
      setExtractedId(listMatchSimple[1]);
      setSelectedType('list');
      storeListogsData(results, value, listMatchSimple[1], 'list');
      return;
    }

    // Try matching bracket format
    const bracketArtistMatch = value.match(/^\[a(\d+)\]$/);
    if (bracketArtistMatch && bracketArtistMatch[1]) {
      setExtractedId(bracketArtistMatch[1]);
      setSelectedType('artist');
      storeListogsData(results, value, bracketArtistMatch[1], 'artist');
      return;
    }

    const bracketLabelMatch = value.match(/^\[l(\d+)\]$/);
    if (bracketLabelMatch && bracketLabelMatch[1]) {
      setExtractedId(bracketLabelMatch[1]);
      setSelectedType('label');
      storeListogsData(results, value, bracketLabelMatch[1], 'label');
      return;
    }

    // Try matching release bracket format
    const bracketReleaseMatch = value.match(/^\[r(\d+)\]$/);
    if (bracketReleaseMatch && bracketReleaseMatch[1]) {
      setExtractedId(bracketReleaseMatch[1]);
      setSelectedType('release');
      storeListogsData(results, value, bracketReleaseMatch[1], 'release');
      return;
    }

    // If only numbers, assume it *could* be an ID, but don't set type yet
    if (/^\d+$/.test(value)) {
      setExtractedId(value);
      // Don't set selectedType here, let the user choose via radio buttons
    }
  };

  // Discogs search submit handler (mocked, just sets a response)
  const handleSearchClick = async () => {
    if (!selectedType) {
      setInputError('Please select a type (Artist, Label, or List).');
      return;
    }
    if (!discogsInput.trim() || !extractedId) {
      setInputError(`Please enter a valid Discogs ${selectedType} URL.`);
      return;
    }
    setInputError('');
    setDiscogsError(''); // Clear any previous Discogs errors
    
    console.log('=== FORM SUBMISSION DEBUG ===');
    console.log('Submitting discogsInput:', discogsInput);
    console.log('selectedType:', selectedType);
    console.log('extractedId:', extractedId);
    
    // Clear previous playlist data for new search
    setPlaylistData({
      title: '',
      description: ''
    });
    console.log('Cleared previous playlist data');
    
    // Generate new search ID for this search
    const searchId = Date.now().toString();
    setCurrentSearchId(searchId);
    console.log('Generated new search ID:', searchId);
    
    // Save the discogs URL to localStorage before clearing results
    localStorage.setItem('listogs_discogs_input', discogsInput);
    console.log('Saved to localStorage:', localStorage.getItem('listogs_discogs_input'));
    
    setResults([]); // <-- Clear results on new submit
    
    // Fetch Discogs info first for playlist metadata
    console.log('Fetching Discogs info for:', discogsInput);
    const info = await fetchDiscogsInfo(discogsInput);
    console.log('Fetched Discogs info:', info);
    
    // Clear localStorage for new search but keep the discogs input
    storeListogsData([], discogsInput, extractedId, selectedType);
    discogsApiQuery(selectedType, extractedId);
    console.log('=== END FORM SUBMISSION DEBUG ===');
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (discogsInput.trim()) {
        handleSearchClick();
      }
    }
  };

  // --- Display results ---
  const videoCount = flattenVideoData(results).length;

  // --- YouTube Playlist Links ---
  const videoIds = getAllVideoIds(results);
  const playlistLinks = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.youtube.com/watch_videos?video_ids=${batch.join(',')}`;
    playlistLinks.push(url);
  }

  // --- All video IDs as comma separated string ---
  const allVideoIdsString = videoIds.join(',');

  // --- Copy to clipboard handler with visual feedback ---
  const [copyButtonClicked, setCopyButtonClicked] = useState(false);
  const [filteredTableRows, setFilteredTableRows] = useState([]);
  const handleCopyIds = () => {
    navigator.clipboard.writeText(allVideoIdsString);
    setCopyButtonClicked(true);
    setTimeout(() => setCopyButtonClicked(false), 1000); // Reset after 1 second
  };

  const handleFilteredDataChange = useCallback((rows) => {
    setFilteredTableRows(rows || []);
  }, []);

  useEffect(() => {
    setFilteredTableRows(flattenVideoData(results));
  }, [results]);

  // Check if user can create YouTube playlists
  const canCreatePlaylists = youtubeAuthStatus.exists && youtubeAuthStatus.expiresAt && new Date(youtubeAuthStatus.expiresAt) > new Date();
  const isSubmitDisabled = !extractedId || !selectedType || !discogsAuthStatus.exists;

  // Fetch Discogs info for the given URL
  const fetchDiscogsInfo = async (url) => {
    try {
      const apiBaseURL = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3030'
        : 'https://www.martinbarker.me/internal-api';

      console.log('🔍 [Frontend] Fetching Discogs info for URL:', url);
      const response = await fetch(`${apiBaseURL}/discogs/info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ url })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ [Frontend] Discogs info fetched successfully:', data);
        setDiscogsInfo(data);
        setDiscogsError(''); // Clear any previous errors
        return data;
      } else {
        let errorData = null;
        try {
          const raw = await response.text();
          if (raw) {
            errorData = JSON.parse(raw);
          }
        } catch (parseErr) {
          console.warn('⚠️ [Frontend] Failed to parse Discogs error payload as JSON');
        }
        console.error('❌ [Frontend] Failed to fetch Discogs info:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        
        // Set user-friendly error message
        if (response.status === 429) {
          setDiscogsError('Site is under heavy load. Please try again later.');
        } else if (response.status >= 500) {
          setDiscogsError('Site is under heavy load. Please try again later.');
        } else {
          setDiscogsError('Failed to fetch Discogs data. Please try again later.');
        }
        
        return null;
      }
    } catch (error) {
      console.error('❌ [Frontend] Network error fetching Discogs info:', error);
      setDiscogsError('Site is under heavy load. Please try again later.');
      return null;
    }
  };

  // Auto-populate playlist data based on search results
  const autoPopulatePlaylistData = (searchId = null) => {
    if (videoIds.length === 0) return;
    
    // Only auto-populate for the current search
    if (searchId && currentSearchId && searchId !== currentSearchId) {
      console.log('Skipping auto-populate for old search:', searchId, 'current:', currentSearchId);
      return;
    }

    console.log('=== AUTO-POPULATE DEBUG ===');
    console.log('searchId:', searchId, 'currentSearchId:', currentSearchId);
    console.log('discogsInfo:', discogsInfo);
    console.log('discogsInput:', discogsInput);
    console.log('results length:', results.length);
    console.log('videoIds length:', videoIds.length);

    // Get the Discogs URL with comprehensive fallback logic
    let discogsUrl = 'N/A';
    let discogsName = 'Unknown';
    let discogsProfile = '';

    // 1. Try discogsInfo first (from API response)
    if (discogsInfo && discogsInfo.url) {
      discogsUrl = discogsInfo.url;
      discogsName = discogsInfo.name || 'Unknown';
      discogsProfile = discogsInfo.profile || '';
      console.log('Using discogsInfo URL:', discogsUrl);
    }
    // 2. Try current discogsInput state
    else if (discogsInput && discogsInput.trim()) {
      discogsUrl = discogsInput.trim();
      console.log('Using discogsInput URL:', discogsUrl);
    }
    // 3. Try saved input from localStorage
    else {
      const savedInput = localStorage.getItem('listogs_discogs_input');
      if (savedInput && savedInput.trim()) {
        discogsUrl = savedInput.trim();
        console.log('Using saved input URL:', discogsUrl);
      }
    }

    // Extract name from URL if we have a URL but no name
    if (discogsUrl !== 'N/A' && discogsName === 'Unknown') {
      const artistMatch = discogsUrl.match(/discogs\.com\/artist\/(\d+)-(.+)/);
      if (artistMatch) {
        const artistSlug = artistMatch[2];
        discogsName = decodeURIComponent(artistSlug)
          .replace(/-/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        console.log('Extracted name from URL:', discogsName);
      }
    }

    // Final fallback: use most common artist from video data
    if (discogsName === 'Unknown') {
      const artistCounts = {};
      const videos = flattenVideoData(results);
      
      videos.forEach(video => {
        if (video.artist) {
          artistCounts[video.artist] = (artistCounts[video.artist] || 0) + 1;
        }
      });

      const mostCommonArtist = Object.keys(artistCounts).reduce((a, b) => 
        artistCounts[a] > artistCounts[b] ? a : b, Object.keys(artistCounts)[0]
      );
      
      if (mostCommonArtist) {
        discogsName = mostCommonArtist;
        console.log('Using most common artist:', discogsName);
      }
    }

    // Create title
    const title = `${discogsName} - All Discogs Videos [Listogs]`;
    
    // Create description with proper URL
    let description = `Curated playlist from Listogs search results.

🔗 Generated by: https://www.martinbarker.me/listogs
📀 Original Discogs: ${discogsUrl}`;

    // Add profile info if available
    if (discogsProfile && discogsProfile.trim()) {
      description += `\n\n📝 About: ${discogsProfile.substring(0, 200)}${discogsProfile.length > 200 ? '...' : ''}`;
    }

    description += `\n\nThis playlist was automatically generated from Discogs data using Listogs.`;

    console.log('Final playlist data:', { title, description, discogsUrl });
    console.log('=== END AUTO-POPULATE DEBUG ===');

    setPlaylistData(prev => ({
      ...prev,
      title: title,
      description: description
    }));
  };

  // Auto-populate playlist data when videos are found
  useEffect(() => {
    if (videoIds.length > 0 && canCreatePlaylists) {
      // Always auto-populate when we have videos, even if playlist data exists
      // This ensures fresh playlist data for each new search
      autoPopulatePlaylistData(currentSearchId);
    }
  }, [videoIds.length, canCreatePlaylists, discogsInput, results, discogsInfo, currentSearchId]);

  // Reset rate limiting state
  const resetRateLimitState = () => {
    setRateLimited(false);
    setRetryAfter(null);
    setRetryAttempt(0);
    setYoutubeError('');
  };

  // Create YouTube playlist with video IDs
  const createYouTubePlaylist = async () => {
    if (!useExistingPlaylist && !playlistData.title.trim()) {
      setYoutubeError('Please enter a playlist title');
      return;
    }

    if (useExistingPlaylist && !existingPlaylistId.trim()) {
      setYoutubeError('Please enter an existing playlist ID');
      return;
    }

    if (videoIds.length === 0) {
      setYoutubeError('No videos found to add to playlist');
      return;
    }

    // Reset rate limiting state when starting new playlist creation
    resetRateLimitState();
    setPlaylistLoading(true);
    setPlaylistProgress({ added: 0, total: videoIds.length });

    try {
      const apiBaseURL = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3030'
        : 'https://www.martinbarker.me/internal-api';

      // Exchange auth code for tokens if needed
      if (youtubeAuthStatus.exists && youtubeAuthStatus.code) {
        if (process.env.NODE_ENV === 'development') {
          console.log('Exchanging auth code for tokens...');
        }
        const tokenResponse = await fetch(`${apiBaseURL}/youtube/exchangeCode`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            code: youtubeAuthStatus.code,
            scope: youtubeAuthStatus.scope
          })
        });

        if (!tokenResponse.ok) {
          const tokenError = await tokenResponse.json();
          setYoutubeError(tokenError.error || 'Failed to exchange auth code for tokens');
          setPlaylistLoading(false);
          return;
        }
      }

      let playlistId;
      let playlistResult;

      if (useExistingPlaylist) {
        // Use existing playlist
        playlistId = existingPlaylistId.trim();
        playlistResult = { id: playlistId, title: 'Existing Playlist' };
        if (process.env.NODE_ENV === 'development') {
          console.log('Using existing playlist ID:', playlistId);
        }
      } else {
        // Create new playlist
        const response = await fetch(`${apiBaseURL}/youtube/createPlaylist`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify(playlistData)
        });

        if (response.ok) {
          playlistResult = await response.json();
          playlistId = playlistResult.id;
          setPlaylistCreated(playlistResult);
        } else {
          const errorData = await response.json();
          setYoutubeError(errorData.error || 'Failed to create playlist');
          setPlaylistLoading(false);
          return;
        }
      }
      
      // Now add videos to the playlist with progress tracking
      if (process.env.NODE_ENV === 'development') {
        console.log(`Adding ${videoIds.length} videos to playlist...`);
      }
      await addVideosToPlaylist(playlistId, videoIds);
        
      setPlaylistData({
        title: '',
        description: '',
        privacyStatus: 'private'
      });
    } catch (err) {
      console.error('Error creating playlist:', err);
      setYoutubeError('Failed to create playlist');
    } finally {
      setPlaylistLoading(false);
      setPlaylistProgress({ added: 0, total: 0 });
    }
  };

  // Add videos to playlist
  const addVideosToPlaylist = async (playlistId, videoIds) => {
    try {
      const apiBaseURL = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3030'
        : 'https://www.martinbarker.me/internal-api';

      let addedCount = 0;
      let retryCount = 0;
      
      for (const videoId of videoIds) {
        try {
          const response = await fetch(`${apiBaseURL}/youtube/addVideoToPlaylist`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
              playlistId: playlistId,
              videoId: videoId
            })
          });

          if (response.status === 429) {
            // Rate limited
            const errorData = await response.json();
            setRateLimited(true);
            setRetryAfter(errorData.retryAfter || 3600);
            setYoutubeError(`Rate limited: ${errorData.error}. Please try again in ${Math.ceil((errorData.retryAfter || 3600) / 60)} minutes.`);
            break;
          } else if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          addedCount++;
          setPlaylistProgress({ added: addedCount, total: videoIds.length });
          retryCount = 0; // Reset retry count on success
        } catch (err) {
          console.error(`Error adding video ${videoId} to playlist:`, err);
          
          // Check if it's a rate limit error
          if (err.message.includes('429') || err.message.includes('quota')) {
            setRateLimited(true);
            setRetryAfter(3600); // Default to 1 hour
            setYoutubeError('Rate limited by YouTube API. Please try again later.');
            break;
          }
          
          // For other errors, continue with next video
          retryCount++;
          if (retryCount > 3) {
            setYoutubeError('Too many consecutive errors. Please try again later.');
            break;
          }
        }
      }
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`Successfully added ${addedCount} videos to playlist`);
      }
    } catch (err) {
      console.error('Error adding videos to playlist:', err);
    }
  };

  // --- ExportCSVButton component ---
  const ExportCSVButton = ({ data, fileName, headers }) => {
    const handleExport = () => {
      const generateCsvContent = (data, headers) => {
        const headerRow = headers.join(",");
        const dataRows = data
          .map((row) =>
            headers
              .map((header) => {
                let value = row[header];
                if (Array.isArray(value)) {
                  value = value.join('; ');
                }
                if (typeof value === 'number') {
                  value = value.toString();
                }
                if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
                  value = `"${value.replace(/"/g, '""')}"`;
                }
                return value ?? "";
              })
              .join(",")
          )
          .join("\n");
        return `${headerRow}\n${dataRows}`;
      };

      const csvContent = generateCsvContent(data, headers);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", fileName || "videos.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };

    return (
      <button
        onClick={handleExport}
        style={{
          padding: '8px 16px',
          fontSize: 16,
          background: (!data || data.length === 0) ? '#cccccc' : buttonColor,
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: (!data || data.length === 0) ? 'not-allowed' : 'pointer',
          marginTop: 8,
          transition: 'background-color 0.3s ease'
        }}
        onMouseOver={e => {
          if (data && data.length > 0) {
            e.currentTarget.style.background = darkenColor(buttonColor, 0.2);
          }
        }}
        onMouseOut={e => {
          if (data && data.length > 0) {
            e.currentTarget.style.background = buttonColor;
          }
        }}
        disabled={!data || data.length === 0}
      >
        Export Table to CSV
      </button>
    );
  };

  return (
    <div >
      {/* --- Listogs Info Section --- */}
      <div style={{
        background: '#f5f7fa',
        border: '1px solid #e3e8ee',
        borderRadius: 8,
        padding: '24px 20px',
        marginBottom: 32,
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
      }}>
        <p style={{ fontSize: 17, marginBottom: 8 }}>
          <strong>Listogs</strong> is a tool for converting <a href="https://www.discogs.com/" target="_blank" rel="noopener noreferrer">Discogs</a> artist, label, or list pages into YouTube playlists.
        </p>
        <ul style={{ fontSize: 16, marginBottom: 8, paddingLeft: 22 }}>
          <li>Authenticate with Discogs to access your lists and releases.</li>
          <li>Paste a Discogs URL (artist, label, or list) and submit.</li>
          <li>Listogs will find YouTube videos for each release and generate playlists and tables.</li>
          <li>Export results to CSV or copy all YouTube video IDs for use elsewhere.</li>
        </ul>
     
      </div>
      {/* Discogs Auth Status and Button (combined in one line) */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
        {discogsAuthStatus.exists ? (
          <button
            style={{
              color: 'white',
              background: buttonColor,
              fontWeight: 'bold',
              padding: '10px 24px',
              border: 'none',
              borderRadius: 6,
              fontSize: 18,
              cursor: 'pointer',
              transition: 'background 0.2s, box-shadow 0.2s',
              boxShadow: '0 2px 8px rgba(0,0,0,0.07)'
            }}
            onMouseOver={e => {
              e.currentTarget.style.background = darkenColor(buttonColor, 0.2);
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.18)';
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = buttonColor;
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)';
            }}
            onClick={clearDiscogsAuth}
          >
            Clear Discogs Auth
          </button>
        ) : (
          <button
            style={{
              color: 'white',
              background: authUrlLoading ? '#cccccc' : buttonColor,
              fontWeight: 'bold',
              padding: '10px 24px',
              border: 'none',
              borderRadius: 6,
              fontSize: 18,
              cursor: authUrlLoading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s, box-shadow 0.2s',
              boxShadow: '0 2px 8px rgba(0,0,0,0.07)'
            }}
            onClick={() => { if (!authUrlLoading && authUrl) window.location.href = authUrl; }}
            onMouseOver={e => {
              if (!authUrlLoading) {
                e.currentTarget.style.background = darkenColor(buttonColor, 0.2);
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.18)';
              }
            }}
            onMouseOut={e => {
              if (!authUrlLoading) {
                e.currentTarget.style.background = buttonColor;
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)';
              }
            }}
            disabled={authUrlLoading || !authUrl || authUrl.startsWith('Error')}
          >
            {authUrlLoading
              ? 'Fetching Discogs URL...'
              : 'Authorize Discogs'}
          </button>
        )}
        <strong>Discogs Auth Status:</strong>{' '}
        {discogsAuthStatus.exists ? (
          <span style={{ color: 'green' }}>
            Signed In
          </span>
        ) : (
          <span style={{ color: 'red' }}>Not signed in</span>
        )}
        
        {/* Clear button - only show if there are video results */}
        {videoCount > 0 && (
          <button
            style={{
              color: 'white',
              background: '#dc3545',
              fontWeight: 'bold',
              padding: '10px 24px',
              border: 'none',
              borderRadius: 6,
              fontSize: 18,
              cursor: 'pointer',
              transition: 'background 0.2s, box-shadow 0.2s',
              boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
              marginLeft: 16
            }}
            onClick={clearListogsData}
            onMouseOver={e => {
              e.currentTarget.style.background = '#c82333';
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.18)';
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = '#dc3545';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)';
            }}
          >
            Clear All Data
          </button>
        )}
      </div>

      {/* --- Discogs URL Submit Form --- */}
      <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Discogs URL Submit Form</h3>
        {/* Removed Artist/Label/List radio selection */}
        {/* <div style={{ marginBottom: 8 }}>
          ...radio buttons...
        </div> */}
        <input
          type="text"
          value={discogsInput}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Enter a Discogs URL (artist, label, release, or list)"
          style={{ width: '90%', padding: 8, marginBottom: 8, fontSize: 16 }}
          disabled={!discogsAuthStatus.exists}
        />
        <button
          onClick={handleSearchClick}
          style={{ 
            padding: '8px 16px', 
            fontSize: 16,
            background: isSubmitDisabled ? '#cccccc' : buttonColor,
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: isSubmitDisabled ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.3s ease'
          }}
          onMouseOver={e => {
            if (!isSubmitDisabled) {
              e.currentTarget.style.background = darkenColor(buttonColor, 0.2);
            }
          }}
          onMouseOut={e => {
            if (!isSubmitDisabled) {
              e.currentTarget.style.background = buttonColor;
            }
          }}
          disabled={isSubmitDisabled}
        >
          {discogsInput.trim() ? 'Submit' : 'Enter a URL and click to submit'}
        </button>
        {discogsError && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px',
              backgroundColor: '#fee2e2',
              border: '1px solid #fca5a5',
              borderRadius: '6px',
              color: '#dc2626',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            ⚠️ {discogsError}
          </div>
        )}
        {extractedId && (
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Detected ID: <b>{extractedId}</b> {selectedType ? `(Type: ${selectedType})` : ''}
          </div>
        )}
        {/* Show invalid URL message if input is non-empty and no type detected */}
        {discogsInput && !selectedType && (
          <div style={{ color: 'red', marginTop: 8 }}>
            Not a valid Discogs artist, label, or list URL.
          </div>
        )}
        {inputError && <div style={{ color: 'red', marginTop: 8 }}>{inputError}</div>}
        {discogsResponse && <pre style={{ color: 'green', marginTop: 8 }}>{discogsResponse}</pre>}
      </div>

      {/* Socket.io log output */}
      <div style={{  }}>
        <h3 style={{ marginTop: 0 }}>Progress:</h3>
        <textarea
          ref={logRef}
          onScroll={handleLogScroll}
          value={logLines.length === 0 ? 'Setting up socket.io..' : logLines.join('\n')}
          readOnly
          style={{
            background: '#111',
            color: '#0ff',
            padding: 8,
            minHeight: 10,
            maxHeight: 200,
            width: '100%',
            fontFamily: 'monospace',
            fontSize: 14,
            resize: 'vertical',
            overflowY: 'auto',
            borderRadius: 6,
            border: '1px solid #333'
          }}
        />
        {/* Display session status */}
        {sessionStatus && (
          <div style={{ marginTop: 12, padding: 8, background: '#222', color: '#fff', borderRadius: 6 }}>
            <strong>Status:</strong> {sessionStatus.status}
            <br />
            {sessionStatus.progress && (
              <span>
                {/* Always show progress index/total and video count, even if status is 'Waiting for rate limit' */}
                {(() => {
                  let { currentIndex, total, currentVideoIndex, totalVideoPages, videos } = sessionStatus.progress;
                  // If waiting for rate limit, use last non-zero progress
                  if (sessionStatus.status === 'Waiting for rate limit') {
                    currentIndex = lastProgressRef.current.currentIndex;
                    total = lastProgressRef.current.total;
                    currentVideoIndex = lastProgressRef.current.currentVideoIndex;
                    totalVideoPages = lastProgressRef.current.totalVideoPages;
                    videos = lastProgressRef.current.videos;
                  }
                  return (
                    <>
                      {typeof currentIndex !== 'undefined' && typeof total !== 'undefined' && total > 0 && 
                       !(sessionStatus.status === 'Waiting for rate limit' && currentIndex >= total) && (
                        <span>
                          Page Progress: {currentIndex} / {total}
                          <br />
                        </span>
                      )}
                      {typeof currentVideoIndex !== 'undefined' && typeof totalVideoPages !== 'undefined' && totalVideoPages > 0 && (
                        <span>
                          Analyzing Release: {currentVideoIndex} / {totalVideoPages}
                          <br />
                        </span>
                      )}
                      {typeof videos !== 'undefined' && (
                        <span>
                          Videos found: {videos}
                        </span>
                      )}
                    </>
                  );
                })()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* YouTube Playlist Links Section */}
      {playlistLinks.length > 0 && (
        <div style={{ marginTop: 32, marginBottom: 16 }}>
          <h3>YouTube Playlists:</h3>
          <ul style={{ paddingLeft: 20 }}>
            {playlistLinks.map((url, idx) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {`YouTube Playlist ${idx + 1} (${Math.min(50, videoIds.length - idx * 50)} videos)`}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* YouTube Playlist Creation Section */}
      {/* {canCreatePlaylists && videoIds.length > 0 && ( */}
      {false && canCreatePlaylists && videoIds.length > 0 && ( 
        
        <div style={{ marginTop: 32, marginBottom: 16 }}>
          <h3>Create YouTube Playlist:</h3>
          <div style={{
            background: '#f8f9fa',
            border: '1px solid #dee2e6',
            borderRadius: 6,
            padding: '20px',
            marginTop: 16
          }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: 12, fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={useExistingPlaylist}
                  onChange={(e) => setUseExistingPlaylist(e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                Add to existing playlist
              </label>
            </div>

            {useExistingPlaylist ? (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                  Existing Playlist ID *
                </label>
                <input
                  type="text"
                  value={existingPlaylistId}
                  onChange={(e) => setExistingPlaylistId(e.target.value)}
                  placeholder="Enter YouTube playlist ID (e.g., PLpQuORMLvnZbiL-UWg6uUAthRgaEmW2JK)"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ced4da',
                    borderRadius: 4,
                    fontSize: 14
                  }}
                />
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  You can find the playlist ID in the URL of your YouTube playlist
                </div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                    Playlist Title *
                  </label>
                  <input
                    type="text"
                    value={playlistData.title}
                    onChange={(e) => setPlaylistData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter playlist title"
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #ced4da',
                      borderRadius: 4,
                      fontSize: 14
                    }}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                    Description
                  </label>
                  <textarea
                    value={playlistData.description}
                    onChange={(e) => setPlaylistData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Enter playlist description (optional)"
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #ced4da',
                      borderRadius: 4,
                      fontSize: 14,
                      resize: 'vertical'
                    }}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                    Privacy Status
                  </label>
                  <select
                    value={playlistData.privacyStatus}
                    onChange={(e) => setPlaylistData(prev => ({ ...prev, privacyStatus: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #ced4da',
                      borderRadius: 4,
                      fontSize: 14,
                      background: 'white'
                    }}
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                    <option value="unlisted">Unlisted</option>
                  </select>
                </div>
              </>
            )}

            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 14, color: '#666', margin: 0 }}>
                This will create a playlist with <strong>{videoIds.length} videos</strong> found in your search results.
              </p>
            </div>

            <div>
              <button
                onClick={createYouTubePlaylist}
                disabled={playlistLoading}
                style={{
                  padding: '12px 24px',
                  fontSize: 16,
                  background: playlistLoading ? '#6c757d' : buttonColor,
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: playlistLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  transition: 'background 0.2s'
                }}
                onMouseOver={e => {
                  if (!playlistLoading) {
                    e.currentTarget.style.background = darkenColor(buttonColor);
                  }
                }}
                onMouseOut={e => {
                  if (!playlistLoading) {
                    e.currentTarget.style.background = buttonColor;
                  }
                }}
              >
                {playlistLoading ? (useExistingPlaylist ? 'Adding videos...' : 'Creating...') : (useExistingPlaylist ? `Add to Playlist (${videoIds.length} videos)` : `Create Playlist (${videoIds.length} videos)`)}
              </button>
              
              {/* Progress Display */}
              {playlistLoading && playlistProgress.total > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ 
                    fontSize: 14, 
                    color: '#666', 
                    marginBottom: 8,
                    textAlign: 'center'
                  }}>
                    Adding videos: {playlistProgress.added} / {playlistProgress.total}
                  </div>
                  <div style={{
                    width: '100%',
                    height: 8,
                    backgroundColor: '#e9ecef',
                    borderRadius: 4,
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${(playlistProgress.added / playlistProgress.total) * 100}%`,
                      height: '100%',
                      backgroundColor: '#28a745',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </div>
              )}
            </div>

            {youtubeError && (
              <div style={{
                marginTop: 16,
                padding: '12px',
                background: rateLimited ? '#fff3cd' : '#f8d7da',
                border: `1px solid ${rateLimited ? '#ffeaa7' : '#f5c6cb'}`,
                borderRadius: 4
              }}>
                <span style={{ color: rateLimited ? '#856404' : '#721c24' }}>
                  {rateLimited ? '⚠️ Rate Limited: ' : 'Error: '}{youtubeError}
                </span>
                {rateLimited && retryAfter && (
                  <div style={{ marginTop: 8, fontSize: 14 }}>
                    <div>Please wait {Math.ceil(retryAfter / 60)} minutes before trying again.</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                      YouTube API quota has been exceeded. The system will automatically retry with exponential backoff.
                    </div>
                  </div>
                )}
              </div>
            )}

            {rateLimited && (
              <div style={{
                marginTop: 16,
                padding: '12px',
                background: '#e2e3e5',
                border: '1px solid #d6d8db',
                borderRadius: 4
              }}>
                <div style={{ color: '#383d41', fontWeight: 'bold', marginBottom: 8 }}>
                  🔄 Retry Information
                </div>
                <div style={{ fontSize: 14, color: '#666' }}>
                  The system is automatically retrying failed requests with exponential backoff.
                  This helps avoid hitting YouTube's API rate limits.
                </div>
                <button
                  onClick={resetRateLimitState}
                  style={{
                    marginTop: 8,
                    padding: '6px 12px',
                    fontSize: 12,
                    background: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer'
                  }}
                >
                  Reset Rate Limit Status
                </button>
              </div>
            )}

            {playlistCreated && (
              <div style={{
                marginTop: 16,
                padding: '12px',
                background: '#d4edda',
                border: '1px solid #c3e6cb',
                borderRadius: 4
              }}>
                <div style={{ color: '#155724', fontWeight: 'bold', marginBottom: 8 }}>
                  ✅ Playlist Created Successfully!
                </div>
                <div style={{ color: '#155724', marginBottom: 4 }}>
                  <strong>Title:</strong> {playlistCreated.snippet?.title}
                </div>
                <div style={{ color: '#155724', marginBottom: 4 }}>
                  <strong>ID:</strong> {playlistCreated.id}
                </div>
                <div style={{ color: '#155724', marginBottom: 8 }}>
                  <strong>Privacy:</strong> {playlistCreated.status?.privacyStatus}
                </div>
                <a
                  href={`https://www.youtube.com/playlist?list=${playlistCreated.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#007bff',
                    textDecoration: 'none',
                    fontWeight: 'bold'
                  }}
                >
                  View Playlist on YouTube →
                </a>
              </div>
            )}
          </div>
        </div>

      )}

      {/* YouTube Auth Status */}
      {/* {!canCreatePlaylists && videoIds.length > 0 && (
        <div style={{ marginTop: 32, marginBottom: 16 }}>
          <h3>YouTube Playlist Creation:</h3>
          <div style={{
            background: '#fff3cd',
            border: '1px solid #ffeaa7',
            borderRadius: 6,
            padding: '16px'
          }}>
            <p style={{ margin: 0, color: '#856404' }}>
              To create YouTube playlists with your found videos, you need to authenticate with YouTube first. 
              Visit the <a href="/youtube" style={{ color: '#007bff' }}>YouTube page</a> to sign in.
            </p>
          </div>
        </div>
      )} */}

      {/* Display results */}
      <div style={{ marginTop: 32 }}>
        <h3>
          {videoCount > 0 ? `Videos Table: ${videoCount} videos Found:` : 'Results:'}
        </h3>
        <VideoTable
          videoData={results}
          onFilteredDataChange={handleFilteredDataChange}
        />
        {/* Export Table to CSV button directly under the table */}
        <div style={{ marginTop: 16 }}>
          <ExportCSVButton
            data={filteredTableRows}
            fileName="videos.csv"
            headers={[
              "releaseTitle",
              "artist",
              "year",
              "releaseType",
              "labelsAndCompanies",
              "country",
              "title",
              "videoId",
              "fullUrl",
              "discogsUrl"
            ]}
          />
          <div style={{ fontSize: 14, color: '#555', marginTop: 8 }}>
          Exports the rows exactly as they appear with the active table filters.
          </div>
        </div>
      </div>

      {/* All YouTube Video IDs Section (bottom of page) */}
      {videoIds.length > 0 && (
        <div style={{ marginTop: 32, marginBottom: 32 }}>
          <h3>All YouTube Video IDs (comma separated) - {videoIds.length} videos:</h3>
          <textarea
            value={allVideoIdsString}
            readOnly
            rows={Math.min(6, Math.ceil(allVideoIdsString.length / 80))}
            style={{
              width: '100%',
              fontSize: 14,
              padding: 8,
              marginBottom: 8,
              resize: 'vertical'
            }}
          />
          <button
            onClick={handleCopyIds}
            style={{
              padding: '8px 16px',
              fontSize: 16,
              background: copyButtonClicked ? '#28a745' : buttonColor,
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'background-color 0.3s ease'
            }}
            onMouseOver={e => {
              if (!copyButtonClicked) {
                e.currentTarget.style.background = darkenColor(buttonColor, 0.2);
              }
            }}
            onMouseOut={e => {
              if (!copyButtonClicked) {
                e.currentTarget.style.background = buttonColor;
              }
            }}
          >
            {copyButtonClicked ? `Copied ${videoIds.length} IDs!` : `Copy ${videoIds.length} IDs to Clipboard`}
          </button>
        </div>
      )}
    </div>
  );
}

export default function DiscogsAuthTestPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DiscogsAuthTestPageInner />
    </Suspense>
  );
}