'use client'
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import styles from '../bandcamplaylist.module.css';
import { ColorContext } from '../../ColorContext';

export default function BandcampPlaylist() {
  const params = useParams();
  const { colors } = React.useContext(ColorContext);
  const [bandcampUrls, setBandcampUrls] = useState([]);
  const [currentReleaseIndex, setCurrentReleaseIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRefs = React.useRef({});

  useEffect(() => {
    // Get the slug parameter (array of path segments)
    const slugArray = params?.slug || [];
    
    if (slugArray.length === 0) {
      setBandcampUrls([]);
      return;
    }

    // Join all segments to form the full path
    const fullPath = slugArray.join('/');
    
    // Parse Bandcamp URLs by finding all ".bandcamp.com" occurrences
    // Pattern: domain.bandcamp.com/path/nextdomain.bandcamp.com/path/...
    const urls = [];
    
    // Find all positions where ".bandcamp.com" appears
    const bandcampPattern = /([^/]+\.bandcamp\.com)/g;
    const matches = [];
    let match;
    
    while ((match = bandcampPattern.exec(fullPath)) !== null) {
      matches.push({
        domain: match[1],
        index: match.index,
        endIndex: match.index + match[0].length
      });
    }
    
    // For each domain, extract the path that follows it
    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const nextMatch = matches[i + 1];
      
      // Get the path after this domain
      const pathStart = currentMatch.endIndex;
      const pathEnd = nextMatch ? nextMatch.index : fullPath.length;
      let path = fullPath.substring(pathStart, pathEnd);
      
      // Ensure path starts with / if it's not empty
      if (path && !path.startsWith('/')) {
        path = '/' + path;
      }
      
      // Construct the full URL
      const url = `https://${currentMatch.domain}${path}`;
      urls.push(url);
    }
    
    setBandcampUrls(urls);
  }, [params]);

  // Scroll to a specific player
  const scrollToPlayer = (index) => {
    const ref = playerRefs.current[`player-${index}`];
    if (ref) {
      ref.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
    }
  };

  // Handle play/pause
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
    if (!isPlaying) {
      // When starting to play, scroll to current release
      scrollToPlayer(currentReleaseIndex);
    }
  };

  // Handle fast forward (next release)
  const handleFastForward = () => {
    if (currentReleaseIndex < bandcampUrls.length - 1) {
      const nextIndex = currentReleaseIndex + 1;
      setCurrentReleaseIndex(nextIndex);
      scrollToPlayer(nextIndex);
    }
  };

  // Handle rewind (previous release)
  const handleRewind = () => {
    if (currentReleaseIndex > 0) {
      const prevIndex = currentReleaseIndex - 1;
      setCurrentReleaseIndex(prevIndex);
      scrollToPlayer(prevIndex);
    }
  };

  // Function to darken a color
  const darkenColor = (color, amount = 0.3) => {
    const hex = color.replace('#', '');
    const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - Math.floor(255 * amount));
    const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - Math.floor(255 * amount));
    const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - Math.floor(255 * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Function to calculate readable text color based on background color
  const getReadableTextColor = (backgroundColor) => {
    const color = backgroundColor.replace('#', '');
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 125 ? '#000' : '#fff';
  };

  const headerBg = darkenColor(colors.Vibrant || '#667eea', 0.2);
  const contentBg = darkenColor(colors.LightMuted || '#f8f9fa', 0.1);
  const textColor = getReadableTextColor(headerBg);
  const contentTextColor = getReadableTextColor(contentBg);

  return (
    <div className={styles.container}>
      {/* Sticky Footer Controls */}
      {bandcampUrls.length > 0 && (
        <div 
          className={styles.stickyFooter}
          style={{ 
            background: headerBg,
            color: textColor,
            borderTop: `2px solid ${textColor}20`
          }}
        >
          <div className={styles.footerControls}>
            <button
              onClick={handleRewind}
              disabled={currentReleaseIndex === 0}
              className={styles.controlButton}
              aria-label="Previous release"
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
              onClick={handleFastForward}
              disabled={currentReleaseIndex === bandcampUrls.length - 1}
              className={styles.controlButton}
              aria-label="Next release"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
          </div>
          <div className={styles.footerInfo}>
            <span className={styles.releaseCounter}>
              {currentReleaseIndex + 1} / {bandcampUrls.length}
            </span>
          </div>
        </div>
      )}

      <div 
        className={styles.header}
        style={{ 
          background: headerBg,
          color: textColor
        }}
      >
        <h1>Bandcamp Playlist</h1>
        <p className={styles.subtitle}>Bandcamp URLs</p>
      </div>
      
      <div 
        className={styles.content}
        style={{ 
          background: contentBg,
          color: contentTextColor
        }}
      >
        {bandcampUrls.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No Bandcamp URLs found. Use the URL format: /bandcamplaylist/domain.bandcamp.com/path/...</p>
          </div>
        ) : (
          <div className={styles.playlistContainer}>
            <h2>Bandcamp Playlist ({bandcampUrls.length} {bandcampUrls.length === 1 ? 'release' : 'releases'}):</h2>
            <div className={styles.playersList}>
              {bandcampUrls.map((url, index) => {
                // Extract the path from the URL to determine if it's an album or track
                const urlObj = new URL(url);
                const path = urlObj.pathname;
                const isAlbum = path.includes('/album/');
                const isTrack = path.includes('/track/');
                
                // Construct the embed URL using Bandcamp's embed format
                // Bandcamp supports embedding by encoding the URL
                const encodedUrl = encodeURIComponent(url);
                // Use Bandcamp's embed player with the URL parameter
                const embedUrl = `https://bandcamp.com/EmbeddedPlayer/url=${encodedUrl}/size=large/bgcol=ffffff/linkcol=0687f5/tracklist=${isAlbum ? 'true' : 'false'}/artwork=small/transparent=true/`;
                
                return (
                  <div 
                    key={index} 
                    ref={(el) => { playerRefs.current[`player-${index}`] = el; }}
                    className={`${styles.playerWrapper} ${currentReleaseIndex === index && isPlaying ? styles.activePlayer : ''}`}
                  >
                    <div className={styles.playerHeader}>
                      <span className={styles.playerNumber}>{index + 1}</span>
                      <a 
                        href={url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className={styles.playerLink}
                      >
                        {url}
                      </a>
                    </div>
                    <iframe
                      src={embedUrl}
                      style={{
                        border: '0',
                        width: '100%',
                        height: isTrack ? '120px' : '472px',
                        minHeight: isTrack ? '120px' : '472px'
                      }}
                      seamless
                      title={`Bandcamp player ${index + 1}`}
                      className={styles.bandcampPlayer}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

