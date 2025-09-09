'use client'
import React, { useState, useEffect } from 'react';
import styles from './vinyl2digital.module.css';
import { ColorContext } from '../ColorContext';

export default function Vinyl2Digital() {
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
        const response = await fetch('https://api.github.com/repos/MartinBarker/vinyl2digital/contents/README.md');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch README: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Decode the base64 content with proper UTF-8 handling
        const binaryString = atob(data.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const content = new TextDecoder('utf-8').decode(bytes);
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

  // Enhanced markdown to HTML converter
  const convertMarkdownToHTML = (markdown) => {
    // First, process images before any other transformations
    let html = markdown
      // Images - convert relative paths to GitHub raw URLs (process first)
      .replace(/!\[([^\]]*)\]\(([^)]*)\)/gim, (match, alt, src) => {
        // If it's already a full URL, use it as is
        if (src.startsWith('http')) {
          return `<img src="${src}" alt="${alt}" style="max-width: 100%; height: auto; border-radius: 8px; margin: 1rem 0;" />`;
        }
        // If it's a relative path, convert to GitHub raw URL
        const githubRawUrl = `https://raw.githubusercontent.com/MartinBarker/vinyl2digital/main/${src}`;
        return `<img src="${githubRawUrl}" alt="${alt}" style="max-width: 100%; height: auto; border-radius: 8px; margin: 1rem 0;" />`;
      })
      // Headers
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      // Code blocks
      .replace(/```(\w+)?\n?([\s\S]*?)```/gim, '<pre><code class="language-$1">$2</code></pre>')
      // Inline code
      .replace(/`([^`]*)`/gim, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]*)\]\(([^)]*)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      // Horizontal rules
      .replace(/^---$/gim, '<hr>')
      .replace(/^\*\*\*$/gim, '<hr>');

    // Handle lists properly
    const lines = html.split('\n');
    const processedLines = [];
    let inList = false;
    let listType = 'ul';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Check if this is a list item
      if (trimmedLine.match(/^[-*]\s/) || trimmedLine.match(/^\d+\.\s/)) {
        if (!inList) {
          listType = trimmedLine.match(/^\d+\.\s/) ? 'ol' : 'ul';
          processedLines.push(`<${listType}>`);
          inList = true;
        }
        const listItem = trimmedLine.replace(/^[-*]\s/, '').replace(/^\d+\.\s/, '');
        processedLines.push(`<li>${listItem}</li>`);
      } else {
        if (inList) {
          processedLines.push(`</${listType}>`);
          inList = false;
        }
        processedLines.push(line);
      }
    }

    // Close any remaining list
    if (inList) {
      processedLines.push(`</${listType}>`);
    }

    let finalHtml = processedLines.join('\n')
      // Convert remaining line breaks to <br> tags
      .replace(/\n/gim, '<br>');
    
    // Additional pass to catch any images that might have been missed
    finalHtml = finalHtml.replace(/<img[^>]+src="([^"]*)"[^>]*>/gim, (match, src) => {
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        const githubRawUrl = `https://raw.githubusercontent.com/MartinBarker/vinyl2digital/main/${src}`;
        return match.replace(src, githubRawUrl);
      }
      return match;
    });
    
    return finalHtml;
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>Loading Vinyl2Digital README...</p>
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
          <p>Please try refreshing the page or check the repository at <a href="https://github.com/MartinBarker/vinyl2digital" target="_blank" rel="noopener noreferrer">https://github.com/MartinBarker/vinyl2digital</a></p>
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
        <h1>Vinyl2Digital 🎵</h1>
        <p className={styles.subtitle}>Batch render an Audacity audio track into an entire album of mp3 files using a Discogs URL for metadata tagging</p>
        <div className={styles.links}>
          <a 
            href="https://github.com/MartinBarker/vinyl2digital" 
            target="_blank" 
            rel="noopener noreferrer"
            className={styles.githubLink}
          >
            View on GitHub
          </a>
          <a 
            href="https://pypi.org/project/vinyl2digital/" 
            target="_blank" 
            rel="noopener noreferrer"
            className={styles.pypiLink}
          >
            View on PyPI
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
