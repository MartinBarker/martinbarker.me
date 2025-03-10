import React, { useState, useRef, useEffect } from 'react';

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
  const fileInputRef = useRef(null);

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

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-8">
      {/* Tutorial */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <p className="text-gray-700">
          Generate timestamped tracklists and metadata tags from Discogs URLs or local files.
          The tool will automatically detect repetitive text and allows you to customize tag output limits.
        </p>
      </div>

      {/* Inputs */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Inputs</h2>
        
        {/* File Upload */}
        <div 
          className={`mb-4 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
            ${isDragActive ? 'border-gray-600 bg-gray-50' : 'border-gray-300'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <input 
            type="file"
            ref={fileInputRef}
            onChange={(e) => handleFileInput(Array.from(e.target.files))}
            className="hidden"
            multiple
            accept="audio/*"
          />
          <p>Upload files by clicking or dropping them here</p>
        </div>

        {/* URL Input */}
        <form onSubmit={handleUrlSubmit} className="flex">
          <input 
            type="url"
            placeholder="Discogs URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 border rounded-l px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button 
            type="submit"
            className="bg-blue-500 text-white px-4 py-2 rounded-r hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Submit
          </button>
        </form>
      </div>

      {/* Settings */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Settings</h2>
        <div className="space-y-4 bg-gray-50 p-4 rounded-lg">
          <div>
            <label htmlFor="maxChars" className="block mb-2">
              Maximum Tag Characters:
            </label>
            <input
              id="maxChars"
              type="number"
              value={settings.maxTagChars}
              onChange={(e) => setSettings({
                ...settings,
                maxTagChars: Math.max(0, parseInt(e.target.value) || 0)
              })}
              className="border rounded px-3 py-2 w-32"
              min="0"
            />
          </div>
          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.repetitiveTextDetection}
                onChange={(e) => setSettings({
                  ...settings,
                  repetitiveTextDetection: e.target.checked
                })}
                className="mr-2"
              />
              Enable Repetitive Text Detection
            </label>
          </div>
        </div>
      </div>

      {/* Timestamps Output */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Timestamps</h2>
        {repetitiveText && settings.repetitiveTextDetection && (
          <div className="bg-yellow-50 border border-yellow-200 p-4 mb-4 rounded-lg">
            <p className="font-semibold text-yellow-800">Repetitive text detected:</p>
            <ul className="list-disc ml-4 mt-2 text-yellow-700">
              {repetitiveText.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="border rounded-lg p-4 bg-white">
          <pre className="whitespace-pre-wrap font-mono text-sm">{tracklist}</pre>
        </div>
      </div>

      {/* Tags Output */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Tags</h2>
        <div className="border rounded-lg p-4 bg-white">
          <div className="mb-2 text-sm text-gray-600">
            Characters: {tags.join(', ').length} / {settings.maxTagChars}
          </div>
          <p className="font-mono text-sm">{tags.join(', ')}</p>
        </div>
      </div>
    </div>
  );
};

export default Tagger;