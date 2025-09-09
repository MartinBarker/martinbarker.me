'use client'
import React, { useState, useEffect } from 'react';
import styles from './discord2playlist.module.css';
import { ColorContext } from '../ColorContext';

export default function Discord2Playlist() {
  const [readmeContent, setReadmeContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { colors } = React.useContext(ColorContext);

  useEffect(() => {
    const fetchReadme = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch the README.md content from GitHub API
        const response = await fetch('https://api.github.com/repos/MartinBarker/Discord2Playlist/contents/README.md');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch README: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Decode the base64 content
        const content = atob(data.content);
        setReadmeContent(content);
      } catch (err) {
        console.error('Error fetching README:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchReadme();
  }, []);

  // Simple markdown to HTML converter
  const convertMarkdownToHTML = (markdown) => {
    return markdown
      // Headers
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      // Code blocks
      .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
      // Inline code
      .replace(/`([^`]*)`/gim, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]*)\]\(([^)]*)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      // Line breaks
      .replace(/\n/gim, '<br>')
      // Lists
      .replace(/^\* (.*$)/gim, '<li>$1</li>')
      .replace(/^- (.*$)/gim, '<li>$1</li>')
      .replace(/^\d+\. (.*$)/gim, '<li>$1</li>');
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>Loading Discord2Playlist README...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h2>Error Loading README</h2>
          <p>{error}</p>
          <p>Please try refreshing the page or check the repository at <a href="https://github.com/MartinBarker/Discord2Playlist" target="_blank" rel="noopener noreferrer">https://github.com/MartinBarker/Discord2Playlist</a></p>
        </div>
      </div>
    );
  }

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
      <div 
        className={styles.header}
        style={{ 
          background: headerBg,
          color: textColor
        }}
      >
        <h1>Discord2Playlist</h1>
        <p className={styles.subtitle}>Discord bot to fetch all music links from a Discord channel and convert them to a playlist</p>
        <div className={styles.links}>
          <a 
            href="https://github.com/MartinBarker/Discord2Playlist" 
            target="_blank" 
            rel="noopener noreferrer"
            className={styles.githubLink}
          >
            View on GitHub
          </a>
        </div>
      </div>
      
      <div 
        className={styles.content}
        style={{ 
          background: contentBg,
          color: contentTextColor
        }}
      >
        <div 
          className={styles.markdownContent}
          dangerouslySetInnerHTML={{ 
            __html: convertMarkdownToHTML(readmeContent) 
          }}
        />
      </div>
    </div>
  );
}
