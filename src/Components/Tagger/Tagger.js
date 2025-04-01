import React, { useState, useRef, useEffect } from 'react';
import styles from './Tagger.module.css';
import FileUploader from '../FileUploader/FileUploader';

const Tagger = () => {
  // Load saved settings from localStorage or use defaults
  const loadSavedSettings = () => {
    try {
      const saved = localStorage.getItem('taggerSettings');
      return saved ? JSON.parse(saved) : {
        maxTagChars: 700,
        repetitiveTextDetection: true
      };
    } catch (e) {
      // Fallback to defaults if localStorage fails
      return {
        maxTagChars: 700,
        repetitiveTextDetection: true
      };
    }
  };

  const [url, setUrl] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const [settings, setSettings] = useState(loadSavedSettings());
  const [tracklist, setTracklist] = useState('');
  const [tags, setTags] = useState([]);
  const [repetitiveText, setRepetitiveText] = useState(null);
  const [tagOptions, setTagOptions] = useState({
    artists: 100,
    title: 100,
    genre: 100,
    year: 100
  });

  useEffect(() => {
    try {
      localStorage.setItem('taggerSettings', JSON.stringify(settings));
    } catch (e) {
      console.warn('Failed to save settings to localStorage:', e);
    }
  }, [settings]);

  const processInput = (input) => {
    // Temporary testing data
    const sampleTracklist = `00:00 - 03:45 Track One
03:45 - 07:30 Track Two [Original Mix]
07:30 - 11:15 Track Three [Original Mix]
11:15 - 15:00 Track Four`;

    const sampleTags = [
      'Electronic', 'House', 'Deep House', 'Original Mix',
      'Various Artists', '2024', 'Compilation'
    ];

    setTracklist(sampleTracklist);
    setTags(sampleTags);

    if (settings.repetitiveTextDetection) {
      const repetitive = detectRepetitiveText(sampleTracklist);
      setRepetitiveText(repetitive);
    }
  };

  const detectRepetitiveText = (text) => {
    if (!text) return null;
    
    const lines = text.split('\n');
    const commonPhrases = lines
      .join(' ')
      .match(/\[.*?\]|\(.*?\)/g) || [];
    
    const repeatedPhrases = commonPhrases.filter(
      (phrase, i, arr) => arr.indexOf(phrase) !== i
    );

    return repeatedPhrases.length > 0 ? [...new Set(repeatedPhrases)] : null;
  };

  const handleFileInput = (files) => {
    if (files && files.length > 0) {
      processInput(files);
    }
  };

  const handleUrlSubmit = (e) => {
    e.preventDefault();
    if (url.trim()) {
      processInput(url);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    handleFileInput(files);
  };

  const handleSliderChange = (category, value) => {
    setTagOptions({
      ...tagOptions,
      [category]: value
    });
  };

  return (
    <div className={styles.container}>
      {/* Tutorial */}
      <div className={styles.title}>
        <p>
          Generate timestamped tracklists and metadata tags from Discogs URLs or local files.
          The tool will automatically detect repetitive text and allows you to customize tag output limits.
        </p>
      </div>

      {/* Inputs */}
      <div className={styles.uploadSection}>
        <FileUploader 
          onFileInput={handleFileInput}
          isDragActive={isDragActive}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
          handleDrop={handleDrop}
        />

        {/* URL Input */}
        <form onSubmit={handleUrlSubmit} className={styles.urlInput}>
          <input 
            type="url"
            placeholder="Discogs URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit">Submit</button>
        </form>
      </div>

      {/* Settings */}
      <div className={styles.settings}>
        <h2>Settings</h2>
        <div>
          <label htmlFor="maxChars">Maximum Tag Characters:</label>
          <input
            id="maxChars"
            type="number"
            value={settings.maxTagChars}
            onChange={(e) => setSettings({
              ...settings,
              maxTagChars: Math.max(0, parseInt(e.target.value) || 0)
            })}
            min="0"
          />
        </div>
        <div>
          <label>
            <input
              type="checkbox"
              checked={settings.repetitiveTextDetection}
              onChange={(e) => setSettings({
                ...settings,
                repetitiveTextDetection: e.target.checked
              })}
            />
            Enable Repetitive Text Detection
          </label>
        </div>
      </div>

      {/* Tag Generation Options */}
      <div className={styles.tagOptions}>
        <h2>Tag Generation Options</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Characters</th>
              <th>Slider</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(tagOptions).map((category) => (
              <tr key={category}>
                <td>{category}</td>
                <td>{tagOptions[category]}</td>
                <td>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={tagOptions[category]}
                    onChange={(e) => handleSliderChange(category, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Timestamps Output */}
      <div className={styles.tracklistSection}>
        <h2>Timestamps</h2>
        {repetitiveText && settings.repetitiveTextDetection && (
          <div className={styles.repetitiveText}>
            <p>Repetitive text detected:</p>
            <ul>
              {repetitiveText.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </div>
        )}
        <div className={styles.tracklistContainer}>
          <pre>{tracklist}</pre>
        </div>
      </div>

      {/* Tags Output */}
      <div className={styles.tagsSection}>
        <h2>Tags</h2>
        <div className={styles.tagsContainer}>
          <div>Characters: {tags.join(', ').length} / {settings.maxTagChars}</div>
          <p>{tags.join(', ')}</p>
        </div>
        <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(tags.join(', '))}>
          Copy Tags to Clipboard
        </button>
      </div>
    </div>
  );
};

export default Tagger;