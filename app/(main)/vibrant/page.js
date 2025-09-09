'use client'
import React, { useState, useRef, useContext } from 'react';
import { Upload, Link as LinkIcon, Image as ImageIcon, Palette, Copy, Check } from 'lucide-react';
import { ColorContext } from '../ColorContext';
import styles from './vibrant.module.css';

export default function VibrantDemo() {
  const { colors: contextColors } = useContext(ColorContext);
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [extractedColors, setExtractedColors] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedColor, setCopiedColor] = useState(null);
  const fileInputRef = useRef(null);
  const imageRef = useRef(null);
  
  // Use extracted colors if available, otherwise fall back to context colors
  const colors = extractedColors || contextColors;
  
  // Helper function to get color value (handles both string and object formats)
  const getColorValue = (color) => {
    if (!color) return null;
    if (typeof color === 'string') return color;
    if (color.hex) return color.hex;
    return null;
  };
  
  // Get the primary color for buttons (prefer DarkMuted, fallback to other colors)
  const getPrimaryColor = () => {
    if (getColorValue(colors?.DarkMuted)) return getColorValue(colors.DarkMuted);
    if (getColorValue(colors?.Muted)) return getColorValue(colors.Muted);
    if (getColorValue(colors?.DarkVibrant)) return getColorValue(colors.DarkVibrant);
    if (getColorValue(colors?.Vibrant)) return getColorValue(colors.Vibrant);
    return null;
  };
  
  // Get the secondary color for gradients
  const getSecondaryColor = () => {
    if (getColorValue(colors?.Muted)) return getColorValue(colors.Muted);
    if (getColorValue(colors?.LightMuted)) return getColorValue(colors.LightMuted);
    if (getColorValue(colors?.Vibrant)) return getColorValue(colors.Vibrant);
    return getPrimaryColor();
  };
  
  
  const primaryColor = getPrimaryColor();
  const secondaryColor = getSecondaryColor();
  
  

  // Function to calculate readable text color based on background color
  const getReadableTextColor = (backgroundColor) => {
    if (!backgroundColor) return '#ffffff';
    // Remove "#" and parse hex color values
    const color = backgroundColor.replace('#', '');
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    // Calculate brightness
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 125 ? '#000000' : '#ffffff';
  };

  // Function to darken a color
  const darkenColor = (hexColor, factor = 0.3) => {
    if (!hexColor) return '#000000';
    const color = hexColor.replace('#', '');
    const r = Math.floor(parseInt(color.substr(0, 2), 16) * (1 - factor));
    const g = Math.floor(parseInt(color.substr(2, 2), 16) * (1 - factor));
    const b = Math.floor(parseInt(color.substr(4, 2), 16) * (1 - factor));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  const handleImageUrlSubmit = async (e) => {
    e.preventDefault();
    if (!imageUrl.trim()) return;
    
    setLoading(true);
    setError('');
    setExtractedColors(null);
    
    try {
      const apiBaseURL =
        process.env.NODE_ENV === 'development'
          ? 'http://localhost:3030'
          : 'https://www.martinbarker.me/internal-api';
      
      const response = await fetch(`${apiBaseURL}/vibrant/extract-colors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ imageUrl }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract colors');
      }
      
      setExtractedColors(data.colors);
      setImageFile(null);
    } catch (err) {
      setError(err.message || 'Failed to load image from URL. Please check the URL and try again.');
      console.error('Error loading image:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file.');
      return;
    }

    setLoading(true);
    setError('');
    setExtractedColors(null);
    setImageUrl('');

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const base64Data = event.target.result;
          
          const apiBaseURL =
            process.env.NODE_ENV === 'development'
              ? 'http://localhost:3030'
              : 'https://www.martinbarker.me/internal-api';
          
          const response = await fetch(`${apiBaseURL}/vibrant/extract-colors`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ imageData: base64Data }),
          });
          
          const data = await response.json();
          
          if (!response.ok) {
            throw new Error(data.error || 'Failed to extract colors');
          }
          
          setExtractedColors(data.colors);
          setImageFile(file);
        } catch (err) {
          setError(err.message || 'Failed to process image. Please try again.');
          console.error('Error processing image:', err);
        } finally {
          setLoading(false);
        }
      };
      
      reader.readAsDataURL(file);
    } catch (err) {
      setError('Failed to process image. Please try again.');
      console.error('Error processing image:', err);
      setLoading(false);
    }
  };

  const copyToClipboard = async (colorValue) => {
    try {
      await navigator.clipboard.writeText(colorValue);
      setCopiedColor(colorValue);
      setTimeout(() => setCopiedColor(null), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const getImageSource = () => {
    if (imageFile) {
      return URL.createObjectURL(imageFile);
    }
    return imageUrl;
  };

  const colorNames = {
    Vibrant: 'Vibrant',
    LightVibrant: 'Light Vibrant',
    DarkVibrant: 'Dark Vibrant',
    Muted: 'Muted',
    LightMuted: 'Light Muted',
    DarkMuted: 'Dark Muted'
  };

  return (
    <div className={styles.container}>
      {/* Vibrant.js Info Section */}
      <div style={{
        background: '#f5f7fa',
        border: '1px solid #e3e8ee',
        borderRadius: 8,
        padding: '24px 20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
      }}>
        <p style={{ fontSize: 17, marginBottom: 8 }}>
          <strong>Vibrant.js Demo</strong> is a tool for extracting dominant colors from images using the Vibrant.js library for color analysis and palette generation.
        </p>
        <ul style={{ fontSize: 16, marginBottom: 8, paddingLeft: 22 }}>
          <li>Upload an image to automatically extract its dominant colors and create color palettes.</li>
          <li>Generate vibrant, muted, and dark color variations for design and branding purposes.</li>
          <li>Copy color codes in various formats (hex, RGB, HSL) for use in design projects.</li>
          <li>Analyze color relationships and create harmonious color schemes from any image.</li>
        </ul>
      </div>

      <div className={styles.uploadSection}>
        <h2>Upload Image</h2>
        
        {/* File Upload */}
        <div className={styles.uploadArea}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className={styles.fileInput}
          />
          <button
            key={`upload-${primaryColor}-${secondaryColor}`}
            onClick={() => fileInputRef.current?.click()}
            className={styles.uploadButton}
            disabled={loading}
            style={{
              background: primaryColor ? `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor || primaryColor} 100%)` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: primaryColor ? getReadableTextColor(primaryColor) : 'white',
              boxShadow: primaryColor ? `0 4px 12px ${primaryColor}40` : '0 4px 12px rgba(102, 126, 234, 0.4)'
            }}
          >
            <Upload size={20} />
            Choose Image File
          </button>
        </div>

        <div className={styles.divider}>
          <span>OR</span>
        </div>

        {/* URL Input */}
        <form onSubmit={handleImageUrlSubmit} className={styles.urlForm}>
          <div className={styles.urlInputGroup}>
            <LinkIcon size={20} className={styles.urlIcon} />
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Enter image URL..."
              className={styles.urlInput}
              disabled={loading}
            />
            <button
              key={`submit-${primaryColor}-${secondaryColor}`}
              type="submit"
              className={styles.submitButton}
              disabled={loading || !imageUrl.trim()}
              style={{
                background: primaryColor ? `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor || primaryColor} 100%)` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: primaryColor ? getReadableTextColor(primaryColor) : 'white',
                boxShadow: primaryColor ? `0 2px 8px ${primaryColor}30` : '0 2px 8px rgba(102, 126, 234, 0.3)'
              }}
            >
              Extract Colors
            </button>
          </div>
        </form>

        {error && (
          <div className={styles.error}>
            {error}
          </div>
        )}

        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            Processing image...
          </div>
        )}
      </div>

      {/* Image Preview */}
      {(imageFile || imageUrl) && !loading && (
        <div className={styles.imageSection}>
          <h3>Image Preview</h3>
          <div className={styles.imageContainer}>
            <img
              ref={imageRef}
              src={getImageSource()}
              alt="Uploaded image"
              className={styles.previewImage}
            />
          </div>
        </div>
      )}

      {/* Color Palette */}
      {colors && !loading && (
        <div className={styles.colorsSection}>
          <h3>Extracted Colors</h3>
          <div className={styles.colorGrid}>
            {Object.entries(colors).map(([key, color]) => {
              if (!color) return null;
              
              const colorValue = color.hex;
              const isCopied = copiedColor === colorValue;
              
              return (
                <div key={key} className={styles.colorCard}>
                  <div
                    className={styles.colorSwatch}
                    style={{ backgroundColor: colorValue }}
                    onClick={() => copyToClipboard(colorValue)}
                    title={`Click to copy ${colorValue}`}
                  >
                    <div className={styles.colorOverlay}>
                      {isCopied ? (
                        <Check size={24} className={styles.copyIcon} />
                      ) : (
                        <Copy size={24} className={styles.copyIcon} />
                      )}
                    </div>
                  </div>
                  <div className={styles.colorInfo}>
                    <h4 className={styles.colorName}>{color.name || colorNames[key] || key}</h4>
                    <div className={styles.colorValue}>
                      <code>{colorValue}</code>
                      <button
                        onClick={() => copyToClipboard(colorValue)}
                        className={styles.copyButton}
                        title="Copy to clipboard"
                      >
                        {isCopied ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                    <div className={styles.colorDetails}>
                      <span>Population: {color.population}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className={styles.instructions}>
        <h3>How to use</h3>
        <ul>
          <li>Upload an image file or paste an image URL</li>
          <li>Vibrant.js will extract the most prominent colors from the image</li>
          <li>Click on any color swatch or the copy button to copy the hex value</li>
          <li>Colors are sorted by prominence in the image</li>
        </ul>
      </div>
    </div>
  );
}
