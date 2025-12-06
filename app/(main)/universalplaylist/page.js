'use client'
import React from 'react';
import styles from './universalplaylist.module.css';
import { ColorContext } from '../ColorContext';

export default function UniversalPlaylistBase() {
  const { colors } = React.useContext(ColorContext);

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

  const headerBg = darkenColor(colors.Vibrant || '#667eea', 0.2);
  const contentBg = darkenColor(colors.LightMuted || '#f8f9fa', 0.1);
  const textColor = getReadableTextColor(headerBg);
  const contentTextColor = getReadableTextColor(contentBg);

  return (
    <div className={styles.container}>
      <div 
        className={styles.header}
        style={{ 
          background: headerBg,
          color: textColor
        }}
      >
        <h1>Universal Playlist</h1>
        <p className={styles.subtitle}>View media from multiple platforms</p>
      </div>
      
      <div 
        className={styles.content}
        style={{ 
          background: contentBg,
          color: contentTextColor
        }}
      >
        <div className={styles.emptyState}>
          <p>Use the URL format: <code>/universalplaylist/{'{JSON array}'}</code></p>
          <p style={{ marginTop: '1rem', opacity: 0.7 }}>
            Example: <code>/universalplaylist/{'["gST2Fac1mCo","YnpdVZVyXvw","balaclavarecords.bandcamp.com/album/ep01"]'}</code>
          </p>
          <p style={{ marginTop: '1rem', opacity: 0.7, fontSize: '0.9rem' }}>
            Supports: YouTube IDs, Spotify URLs, SoundCloud URLs, Bandcamp URLs
          </p>
        </div>
      </div>
    </div>
  );
}

