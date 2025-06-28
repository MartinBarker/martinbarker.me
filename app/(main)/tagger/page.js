"use client";

import React, { useEffect, useRef, useState } from 'react';
import styles from './Tagger.module.css';
import FileDrop from '../FileDrop/FileDrop';
import { useColorContext } from '../ColorContext';
import { GripVertical } from 'lucide-react';

// Helper: Extract Discogs type and ID from URL
function parseDiscogsUrl(url) {
  // Examples:
  // https://www.discogs.com/release/1234567-Artist-Title
  // https://www.discogs.com/master/7654321-Artist-Title
  const releaseMatch = url.match(/discogs\.com\/(release|master)\/(\d+)/i);
  if (releaseMatch) {
    return { type: releaseMatch[1].toLowerCase(), id: releaseMatch[2] };
  }
  return null;
}

// Log backend request/response for Discogs
function logDiscogsRequest({ route, payload, response }) {
  console.log('[Discogs API Request]');
  console.log('Route:', route);
  console.log('Payload:', payload);
  console.log('Response:', response);
}

export default function TaggerPage() {
  const { colors } = useColorContext();
  const urlInputContainerRef = useRef(null);
  const [isStacked, setIsStacked] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [debugInfo, setDebugInfo] = useState({ url: '', files: [] });
  const [copyState, setCopyState] = useState('idle'); // idle | copied | hover
  const [discogsResponse, setDiscogsResponse] = useState(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);  const [tagsValue, setTagsValue] = useState('');
  const [tagsCopyState, setTagsCopyState] = useState('idle'); // idle | copied | hover
  const [hashtagsValue, setHashtagsValue] = useState('');
  const [hashtagsCopyState, setHashtagsCopyState] = useState('idle'); // idle | copied | hover
  // Add new states for tag optimization
  const [charLimit, setCharLimit] = useState('500');
  const [optimizeStatus, setOptimizeStatus] = useState(''); // For feedback messages
  const [tagFilters, setTagFilters] = useState({
    artists: { enabled: true, percentage: 100, count: 0, totalChars: 0, sliderValue: 100 },
    album: { enabled: true, percentage: 100, count: 0, totalChars: 0, sliderValue: 100 },
    tracklist: { enabled: true, percentage: 100, count: 0, totalChars: 0, sliderValue: 100 },
    combinations: { enabled: true, percentage: 100, count: 0, totalChars: 0, sliderValue: 100 }
  });
  const [selectAllTags, setSelectAllTags] = useState(true);
  // Add hydration state
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isClient, setIsClient] = useState(false); // Track if we're on the client side

  // Add the missing parsedTags state
  const [parsedTags, setParsedTags] = useState({
    artists: [],
    album: [],
    tracklist: [],
    combinations: []
  });  // Add state for video title recommendations
  const [videoTitleRecommendations, setVideoTitleRecommendations] = useState([]);
  const [videoTitleCopyState, setVideoTitleCopyState] = useState('idle'); // idle | copied | hover
  const [videoTitleVariation, setVideoTitleVariation] = useState(0); // Track current variation
  const [discogsData, setDiscogsData] = useState(null); // Store Discogs data for refresh  // Add state for combined input sources
  const [inputSources, setInputSources] = useState({
    url: {
      data: null,
      metadata: true,
      times: true,
      label: ''
    },
    files: {
      data: null,
      metadata: true,
      times: true,
      label: ''
    }  });

  // Add state for timestamps formatting options
  const [includeTrackCredits, setIncludeTrackCredits] = useState(false);

  const [formatOrder, setFormatOrder] = useState([
    { id: 1, value: 'startTime' },
    { id: 2, value: 'dash' },
    { id: 3, value: 'endTime' },
    { id: 4, value: 'title' },
    { id: 5, value: 'dash-artist' }, // new dash before artist
    { id: 6, value: 'artist' }
  ]);

  const [selectOptions, setSelectOptions] = useState([
    [
      { value: 'startTime', label: 'start' },
      { value: 'blank', label: '(blank)' }
    ],
    [
      { value: 'dash', label: '-' },
      { value: 'blank', label: '(blank)' }
    ],
    [
      { value: 'endTime', label: 'end' },
      { value: 'blank', label: '(blank)' }
    ],
    [
      { value: 'title', label: 'title' }
    ],
    [
      { value: 'dash-artist', label: '-' },
      { value: 'blank', label: '(blank)' }
    ],
    [
      { value: 'artist', label: 'artist' },
      { value: 'blank', label: '(blank)' }
    ]
  ]);

  // Default values for reset
  const defaultFormatOrder = [
    { id: 1, value: 'startTime' },
    { id: 2, value: 'dash' },
    { id: 3, value: 'endTime' },
    { id: 4, value: 'title' },
    { id: 5, value: 'dash-artist' },
    { id: 6, value: 'artist' }
  ];
  const defaultSelectOptions = [
    [
      { value: 'startTime', label: 'start' },
      { value: 'blank', label: '(blank)' }
    ],
    [
      { value: 'dash', label: '-' },
      { value: 'blank', label: '(blank)' }
    ],
    [
      { value: 'endTime', label: 'end' },
      { value: 'blank', label: '(blank)' }
    ],
    [
      { value: 'title', label: 'title' }
    ],
    [
      { value: 'dash-artist', label: '-' },
      { value: 'blank', label: '(blank)' }
    ],
    [
      { value: 'artist', label: 'artist' },
      { value: 'blank', label: '(blank)' }
    ]
  ];

  // Set artist dropdown disabled by default
  const [artistDisabled, setArtistDisabled] = useState(true);

  // Formatting suggestion state
  const [formatSuggestion, setFormatSuggestion] = useState(null);

  // Store last audioFiles/durations for dynamic textarea update
  const audioFilesRef = useRef([]);
  const durationsRef = useRef([]);

  // Store last Discogs tracks/durations for dynamic textarea update
  const discogsTracksRef = useRef([]);
  const discogsDurationsRef = useRef([]);
  // Track input source: 'files' | 'discogs' | null
  const [inputSource, setInputSource] = useState(null);

  // Load formatOrder/selectOptions/inputValue/artistDisabled from localStorage on mount (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    setIsClient(true); // Set client flag
    
    try {
      const savedOrder = localStorage.getItem('tagger_formatOrder');
      const savedOptions = localStorage.getItem('tagger_selectOptions');
      const savedInputValue = localStorage.getItem('tagger_inputValue');
      const savedArtistDisabled = localStorage.getItem('tagger_artistDisabled');
      if (savedOrder) setFormatOrder(JSON.parse(savedOrder));
      if (savedOptions) setSelectOptions(JSON.parse(savedOptions));
      if (savedInputValue) setInputValue(savedInputValue);
      if (savedArtistDisabled !== null) setArtistDisabled(savedArtistDisabled === 'true');
    } finally {
      setHasHydrated(true); // Mark hydration complete
    }
  }, []);

  // Save formatOrder/selectOptions/inputValue/artistDisabled to localStorage on change (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('tagger_formatOrder', JSON.stringify(formatOrder));
      localStorage.setItem('tagger_selectOptions', JSON.stringify(selectOptions));
      localStorage.setItem('tagger_inputValue', inputValue);
      localStorage.setItem('tagger_artistDisabled', String(artistDisabled));
    } catch {}
  }, [formatOrder, selectOptions, inputValue, artistDisabled]);

  const handleSelectChange = (idx, val) => {
    setFormatOrder((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], value: val };
      return updated;
    });
  };

  // Helper to format seconds as mm:ss
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // Helper to get audio duration from a File
  function getAudioDuration(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const audio = new window.Audio();
      audio.src = url;
      audio.addEventListener('loadedmetadata', () => {
        resolve(audio.duration);
        URL.revokeObjectURL(url);
      });
      audio.addEventListener('error', (e) => {
        reject(e);
        URL.revokeObjectURL(url);
      });
    });
  }
  // Helper function to generate video title recommendations for full album uploads
  function generateVideoTitleRecommendations(discogsData, variation = 0) {
    if (!discogsData) return [];
    
    // Helper function to clean Discogs entity names by removing (number) suffixes
    const cleanDiscogsSuffix = (name) => {
      if (!name) return '';
      return name.replace(/\s+\(\d+\)$/, '');
    };

    const albumTitle = discogsData.title ? cleanDiscogsSuffix(discogsData.title) : '';
    const primaryArtist = (discogsData.artists && discogsData.artists.length > 0) 
      ? cleanDiscogsSuffix(discogsData.artists[0].name) 
      : '';
    const year = discogsData.released ? discogsData.released.substring(0, 4) : '';
    const genres = discogsData.genres || [];
    const styles = discogsData.styles || [];
    const label = (discogsData.labels && discogsData.labels.length > 0) 
      ? cleanDiscogsSuffix(discogsData.labels[0].name) 
      : '';
    const country = discogsData.country || '';

    // Create different format template sets based on variation
    const formatSets = [
      // Variation 0: Original formats
      [
        (a, t, y, g, s, l, c) => y && g.length > 0 ? `${t} - ${a} | ${y} | ${g[0]} | Full Album` : null,
        (a, t, y, g, s, l, c) => y && g.length > 0 ? `${a} - ${t} (${y}) [${g[0]}] Full Album` : null,
        (a, t, y, g, s, l, c) => y ? `${t} by ${a} • ${y} • Full Album` : null,
        (a, t, y, g, s, l, c) => l && y ? `${a} - ${t} | ${l} | ${y} | Complete Album` : null,
        (a, t, y, g, s, l, c) => c && y ? `${t} - ${a} [${c} ${y}] Full LP` : null,
      ],
      // Variation 1: Style-focused formats
      [
        (a, t, y, g, s, l, c) => s.length > 0 && y ? `${a} - ${t} | ${s[0]} | ${y} | Full Album` : null,
        (a, t, y, g, s, l, c) => s.length > 0 ? `${t} (${a}) | ${s[0]} Full Album` : null,
        (a, t, y, g, s, l, c) => s.length > 1 && y ? `${t} - ${a} | ${s[0]} ${s[1]} | ${y}` : null,
        (a, t, y, g, s, l, c) => g.length > 0 && s.length > 0 ? `${a}: ${t} | ${g[0]}/${s[0]} | Complete LP` : null,
        (a, t, y, g, s, l, c) => y ? `${t} by ${a} (${y}) | Full Album` : null,
      ],
      // Variation 2: Label and country focused
      [
        (a, t, y, g, s, l, c) => l && c ? `${t} - ${a} | ${l} (${c}) | Full Album` : null,
        (a, t, y, g, s, l, c) => l && y ? `${a}: ${t} | ${l} ${y} | Complete Album` : null,
        (a, t, y, g, s, l, c) => c && g.length > 0 ? `${t} | ${a} | ${c} ${g[0]} | Full LP` : null,
        (a, t, y, g, s, l, c) => l ? `${a} - ${t} | ${l} Records | Full Album` : null,
        (a, t, y, g, s, l, c) => y && c ? `${t} (${y}) - ${a} | ${c} Release | Full Album` : null,
      ],
      // Variation 3: Alternative separators and formats
      [
        (a, t, y, g, s, l, c) => y && g.length > 0 ? `${a} ★ ${t} ★ ${g[0]} ★ ${y} ★ Full Album` : null,
        (a, t, y, g, s, l, c) => y ? `${t} / ${a} / ${y} / Complete Album` : null,
        (a, t, y, g, s, l, c) => g.length > 0 ? `[${g[0]}] ${a} - ${t} | Full Album` : null,        (a, t, y, g, s, l, c) => s.length > 0 && y ? `${t} → ${a} → ${s[0]} → ${y} → Full LP` : null,
        (a, t, y, g, s, l, c) => `${a} presents: ${t} | Complete Album`,
      ],
      // Variation 4: Mixed genre/style combinations
      [
        (a, t, y, g, s, l, c) => g.length > 1 ? `${t} - ${a} | ${g[0]} & ${g[1]} | Full Album` : null,
        (a, t, y, g, s, l, c) => g.length > 0 && s.length > 0 && y ? `${a} - ${t} | ${g[0]}/${s[0]} | ${y} | Full LP` : null,
        (a, t, y, g, s, l, c) => s.length > 1 ? `${t} by ${a} | ${s[0]} + ${s[1]} | Complete Album` : null,
        (a, t, y, g, s, l, c) => g.length > 0 && y ? `${t} | ${a} | ${g[0]} Classic | ${y}` : null,
        (a, t, y, g, s, l, c) => l && g.length > 0 ? `${a}: ${t} | ${l} | ${g[0]} | Full Album` : null,
      ]
    ];

    const recommendations = [];
    
    if (albumTitle && primaryArtist) {
      const currentSet = formatSets[variation % formatSets.length];
      
      // Apply each format template
      currentSet.forEach(formatFn => {
        const result = formatFn(primaryArtist, albumTitle, year, genres, styles, label, country);
        if (result) {
          recommendations.push(result);
        }
      });

      // Fallback formats if we don't have enough recommendations
      const fallbacks = [
        `${albumTitle} - ${primaryArtist} | Full Album`,
        `${primaryArtist} - ${albumTitle} | Complete Album`,
        `${albumTitle} by ${primaryArtist} - Full LP`,
        `${primaryArtist}: ${albumTitle} | Full Album`,
        `${albumTitle} (${primaryArtist}) | Complete Album`
      ];

      // Add fallbacks if needed
      fallbacks.forEach(fallback => {
        if (recommendations.length < 5 && !recommendations.includes(fallback)) {
          recommendations.push(fallback);
        }
      });
    }

    // Return only the first 5 unique recommendations
    return [...new Set(recommendations)].slice(0, 5);
  }

  // Handle files: get durations, build tracklist, update debug
const handleFilesSelected = async (files) => {
  setIsLoadingFiles(true);
  const fileArr = Array.from(files);
  setDebugInfo(prev => ({
    ...prev,
    files: fileArr.map(f => f.name)
  }));

  // Only process audio files
  const audioFiles = fileArr.filter(f =>
    f.type.startsWith('audio/') ||
    /\.(mp3|wav|aiff|flac)$/i.test(f.name)
  );

  // Get durations for each file
  const durations = await Promise.all(audioFiles.map(async (file) => {
    try {
      const duration = await getAudioDuration(file);
      return duration;
    } catch {
      return 0;
    }
  }));

  // Store for later use in dropdown changes
  audioFilesRef.current = audioFiles;
  durationsRef.current = durations;
  discogsTracksRef.current = [];
  discogsDurationsRef.current = [];
  setInputSource('files');

  // Update input sources state
  setInputSources(prev => ({
    ...prev,
    files: {
      ...prev.files,
      data: {
        files: audioFiles,
        durations: durations
      },
      label: `${audioFiles.length} audio file${audioFiles.length !== 1 ? 's' : ''}`
    }
  }));

  // Generate combined timestamps
  setTimeout(generateCombinedTimestamps, 0);

  // ✅ Auto-populate tags, hashtags, titles
  if (discogsData) {
    processDiscogsResponseToTags(discogsData);
    const videoTitles = generateVideoTitleRecommendations(discogsData, videoTitleVariation);
    setVideoTitleRecommendations(videoTitles);
  } else {
    // Basic tag fallback using filenames
    const filenameTags = audioFiles.map(file =>
      file.name.replace(/\.[^/.]+$/, '').replace(/[\-_]/g, ' ').trim()
    );

    const fallbackTags = {
      artists: [],
      album: [],
      tracklist: [],
      combinations: [],
      credits: [],
      filenames: filenameTags
    };

    setParsedTags(prev => ({
      ...prev,
      filenames: filenameTags
    }));

    // Create a single tag pool from filenames
    setTagsValue(filenameTags.join(', '));
    updateHashtagsValue(filenameTags.join(', '));
    setVideoTitleRecommendations([]);
  }

  setIsLoadingFiles(false);
};




  // Handle URL submission
  const handleUrlSubmit = async (e) => {
    if (e) e.preventDefault();
    setDebugInfo(prev => ({
      ...prev,
      url: urlInput
    }));

    // Discogs URL logic
    const discogsInfo = parseDiscogsUrl(urlInput);
    if (discogsInfo) {
      const route = 'http://localhost:3030/discogsFetch';
      try {
        const res = await fetch(route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discogsInfo)
        });
        const data = await res.json();
        setDiscogsResponse(data); // Save to state
        setDiscogsData(data); // Store for video title refresh
        logDiscogsRequest({ route, payload: discogsInfo, response: data });
        
        // Process the response for tags
        processDiscogsResponseToTags(data);
        
        // Generate video title recommendations
        const videoTitles = generateVideoTitleRecommendations(data, videoTitleVariation);
        setVideoTitleRecommendations(videoTitles);
        
        // If response has a tracklist, process timing data
        if (Array.isArray(data.tracklist) && data.tracklist.length > 0) {
          // Helper to parse duration string (mm:ss or hh:mm:ss) to seconds
          function parseDuration(str) {
            if (!str) return 0;
            const parts = str.split(':').map(Number);
            if (parts.length === 3) {
              return parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else if (parts.length === 2) {
              return parts[0] * 60 + parts[1];
            } else if (parts.length === 1) {
              return parts[0];
            }
            return 0;
          }
          
          const durations = data.tracklist.map(track => parseDuration(track.duration));
          
          // Store Discogs tracks and durations for dropdown reactivity
          discogsTracksRef.current = data.tracklist;
          discogsDurationsRef.current = durations;
          setInputSource('discogs');
          
          // Enable artist dropdown if any track has an artist
          const hasArtist = data.tracklist.some(track => 
            Array.isArray(track.artists) && track.artists.length > 0 && track.artists[0].name
          );
          setArtistDisabled(!hasArtist);
          
          // Update input sources state
          setInputSources(prev => ({
            ...prev,
            url: {
              ...prev.url,
              data: {
                ...data,
                durations: durations
              },
              label: `Discogs: ${data.title || 'Unknown Album'}`
            }
          }));
          
          // Generate combined timestamps
          setTimeout(generateCombinedTimestamps, 0);
        }
      } catch (err) {
        console.error('Error fetching Discogs data:', err);
        setDiscogsResponse(null);
        logDiscogsRequest({ route, payload: discogsInfo, response: String(err) });
      }
    }
  };

  // Update textarea when dropdowns change and audioFilesRef/discogsTracksRef is set
  useEffect(() => {
    // Helper: check if dash-artist dropdown is present and enabled
    const dashArtistIdx = formatOrder.findIndex(item => item.value === 'dash-artist');
    const dashArtistEnabled = dashArtistIdx !== -1 && !artistDisabled;
    if (inputSource === 'files' && audioFilesRef.current.length > 0) {
      let currentTime = 0;
      const lines = audioFilesRef.current.map((file, idx) => {
        const start = formatTime(currentTime);
        const end = formatTime(currentTime + (durationsRef.current[idx] || 0));
        const title = file.name.replace(/\.[^/.]+$/, '');
        currentTime += durationsRef.current[idx] || 0;
        return formatOrder
          .map((item) => {
            if (item.value === 'blank') return '';
            if (item.value === 'startTime') return start;
            if (item.value === 'endTime') return end;
            if (item.value === 'title' ) return title;
            if (item.value === 'dash' ) return '-';
            if (item.value === 'dash-artist' ) return dashArtistEnabled ? '-' : '';
            if (item.value === 'artist') return '';
            return '';
          })
          .filter(Boolean)
          .join(' ');
      });
      setInputValue(lines.join('\n'));
    } else if (inputSource === 'discogs' && discogsTracksRef.current.length > 0) {
      let currentTime = 0;
      const lines = discogsTracksRef.current.map((track, idx) => {
        const durationSec = discogsDurationsRef.current[idx] || 0;
        const start = formatTime(currentTime);
        const end = formatTime(currentTime + durationSec);
        currentTime += durationSec;
        // Get artist name for this track if present
        let artistName = '';
        if (Array.isArray(track.artists) && track.artists.length > 0 && track.artists[0].name) {
          artistName = track.artists.map(a => a.name).join(', ');
        }
        return formatOrder
          .map(item => {
            if (item.value === 'blank') return '';
            if (item.value === 'startTime') return start;
            if (item.value === 'endTime') return end;
            if (item.value === 'title' ) return track.title || '';
            if (item.value === 'dash' ) return '-'; // Fixed: removed extra quote
            if (item.value === 'dash-artist' ) return dashArtistEnabled ? '-' : '';
            if (item.value === 'artist') return artistName;
            return '';
          })
          .filter(Boolean)
          .join(' ');
      });
      setInputValue(lines.join('\n'));
    }
    // eslint-disable-next-line
  }, [formatOrder]);

  // Update textarea when dropdowns change and audioFilesRef/discogsTracksRef/inputValue is set
  useEffect(() => {
    // Helper: check if dash-artist dropdown is present and enabled
    const dashArtistIdx = formatOrder.findIndex(item => item.value === 'dash-artist');
    const dashArtistEnabled = dashArtistIdx !== -1 && !artistDisabled;
    // If we have discogsTracksRef or audioFilesRef, use those for accurate data
    if (inputSource === 'files' && audioFilesRef.current.length > 0) {
      let currentTime = 0;
      const newLines = audioFilesRef.current.map((file, idx) => {
        const start = formatTime(currentTime);
        const end = formatTime(currentTime + (durationsRef.current[idx] || 0));
        const title = file.name.replace(/\.[^/.]+$/, '');
        currentTime += durationsRef.current[idx] || 0;
        return formatOrder
          .map((item) => {
            if (item.value === 'blank') return '';
            if (item.value === 'startTime') return start;
            if (item.value === 'endTime') return end;
            if (item.value === 'title' ) return title;
            if (item.value === 'dash' ) return '-';
            if (item.value === 'dash-artist' ) return dashArtistEnabled ? '-' : '';
            if (item.value === 'artist') return '';
            return '';
          })
          .filter(Boolean)
          .join(' ');
      });
      setInputValue(newLines.join('\n'));
    } else if (inputSource === 'discogs' && discogsTracksRef.current.length > 0) {
      let currentTime = 0;
      const newLines = discogsTracksRef.current.map((track, idx) => {
        const durationSec = discogsDurationsRef.current[idx] || 0;
        const start = formatTime(currentTime);
        const end = formatTime(currentTime + durationSec);
        currentTime += durationSec;
        let artistName = '';
        if (Array.isArray(track.artists) && track.artists.length > 0 && track.artists[0].name) {
          artistName = track.artists.map(a => a.name).join(', ');
        }
        return formatOrder
          .map(item => {
            if (item.value === 'blank') return '';
            if (item.value === 'startTime' ) return start;
            if (item.value === 'endTime' ) return end;
            if (item.value === 'title' ) return track.title || '';
            if (item.value === 'dash' ) return '-'; // Fixed: removed extra quote
            if (item.value === 'dash-artist' ) return dashArtistEnabled ? '-' : '';
            if (item.value === 'artist') return artistName;
            return '';
          })
          .filter(Boolean)
          .join(' ');
      });
      setInputValue(newLines.join('\n'));
    }
    // eslint-disable-next-line
  }, [formatOrder, artistDisabled, inputSource]);

  // Detect duplicate prefix in textarea and show suggestion
  useEffect(() => {
    // Only run if textarea has at least 2 lines
    const lines = inputValue.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      setFormatSuggestion(null);
      return;
    }
    // Improved: Remove all leading timestamps, dashes, and track numbers
    const getTitlePart = (line) => {
      // Remove all leading timestamps (e.g. 00:00, 02:01), dashes, and track numbers
      // Matches: 00:00 - 02:01 03 Alan Burn - Plaything
      //          00:00 05 Alan Burn - Beach House
      //          02:01 - 04:10 04 Alan Burn - That's How It All Began
      //          02:16 06 Alan Burn - Somebody Wrote Their Name
      // Regex: ^((\d{2}:\d{2}\s*(-\s*)?)+)?(\d{2}\s+)?-?\s*
      return line.replace(/^((\d{2}:\d{2}\s*(-\s*)?)+)?(\d{2}\s+)?-?\s*/i, '');
    };
    const titleParts = lines.map(getTitlePart);
    // Only consider suggestion if all lines have a non-empty title part
    if (titleParts.length < 2 || titleParts.some(t => !t.trim())) {
      setFormatSuggestion(null);
      return;
    }
    // Find common prefix (case-insensitive)
    function commonPrefix(arr) {
      if (!arr.length) return '';
      let prefix = arr[0];
      for (let i = 1; i < arr.length; i++) {
        while (
          arr[i].toLowerCase().indexOf(prefix.toLowerCase()) !== 0 &&
          prefix.length > 0
        ) {
          prefix = prefix.slice(0, -1);
        }
        if (!prefix) break;
      }
      return prefix;
    }
    const prefix = commonPrefix(titleParts);
    // Only suggest if prefix is at least 3 chars and appears in all lines
    if (
      prefix &&
      prefix.length >= 3 &&
      titleParts.every(t => t.toLowerCase().startsWith(prefix.toLowerCase()))
    ) {
      setFormatSuggestion({
        prefix,
        before: lines.join('\n'),
        after: lines.map(line => {
          // Remove only the first occurrence of the prefix after the time/dash/track
          const rest = getTitlePart(line);
          const replaced = rest.replace(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '');
          // Rebuild the line with the original prefix removed
          return line.replace(rest, replaced);
        }).join('\n')
      });
    } else {
      setFormatSuggestion(null);
    }
  }, [inputValue, formatOrder, selectOptions]);

  const handleCopy = () => {
    navigator.clipboard.writeText(inputValue ? `Timestamps generated by https://tagger.site:\n${inputValue}` : '');
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 900);
  };

  // Handle tags copy
  const handleTagsCopy = () => {
    navigator.clipboard.writeText(tagsValue);
    setTagsCopyState('copied');
    setTimeout(() => setTagsCopyState('idle'), 900);
  };

  // Handle hashtags copy
  const handleHashtagsCopy = () => {
    navigator.clipboard.writeText(hashtagsValue);
    setHashtagsCopyState('copied');
    setTimeout(() => setHashtagsCopyState('idle'), 900);
  };

  // Handler for copying video title recommendations
  const handleVideoTitleCopy = async (title) => {
    try {
      await navigator.clipboard.writeText(title);
      setVideoTitleCopyState('copied');
      setTimeout(() => setVideoTitleCopyState('idle'), 2000);
    } catch (err) {
      console.error('Failed to copy video title:', err);
    }
  };

  // Handler for refreshing video title recommendations
  const handleVideoTitleRefresh = () => {
    if (discogsData) {
      const nextVariation = (videoTitleVariation + 1) % 5; // Cycle through 5 variations
      setVideoTitleVariation(nextVariation);
      const newTitles = generateVideoTitleRecommendations(discogsData, nextVariation);
      setVideoTitleRecommendations(newTitles);
      setVideoTitleCopyState('idle'); // Reset copy state
    }
  };

  // Handler for input source checkbox changes
  const handleInputSourceChange = (sourceType, field, value) => {
    setInputSources(prev => ({
      ...prev,
      [sourceType]: {
        ...prev[sourceType],
        [field]: value
      }
    }));
    
    // Regenerate timestamps when settings change
    generateCombinedTimestamps();
  };

  // Function to generate timestamps from combined input sources
  const generateCombinedTimestamps = () => {
    const urlSource = inputSources.url;
    const filesSource = inputSources.files;
    
    // Determine which source to use for times and metadata
    const useUrlTimes = urlSource.data && urlSource.times;
    const useFileTimes = filesSource.data && filesSource.times;
    const useUrlMetadata = urlSource.data && urlSource.metadata;
    const useFileMetadata = filesSource.data && filesSource.metadata;
    
    // Priority: if both sources have times enabled, prefer files for timing accuracy
    let timingData = null;
    let metadataSource = null;
    
    if (useFileTimes && filesSource.data) {
      timingData = {
        type: 'files',
        files: filesSource.data.files,
        durations: filesSource.data.durations
      };
    } else if (useUrlTimes && urlSource.data) {
      timingData = {
        type: 'url',
        tracks: urlSource.data.tracklist,
        durations: urlSource.data.durations
      };
    }
    
    if (useUrlMetadata && urlSource.data) {
      metadataSource = {
        type: 'url',
        data: urlSource.data
      };
    } else if (useFileMetadata && filesSource.data) {
      metadataSource = {
        type: 'files',
        files: filesSource.data.files
      };
    }
    
    if (!timingData) {
      setInputValue('');
      return;
    }
    // Generate timestamps based on combined sources
    let currentTime = 0;
    const lines = [];
    if (timingData.type === 'files') {
      timingData.files.forEach((file, idx) => {
        const duration = timingData.durations[idx] || 0;
        const start = formatTime(currentTime);
        const end = formatTime(currentTime + duration);
        
        let title = '';
        let artistName = '';
        
        if (metadataSource && metadataSource.type === 'url') {
          // Use Discogs metadata if available
          const track = metadataSource.data.tracklist?.[idx];
          if (track) {
            title = track.title || file.name.replace(/\.[^/.]+$/, '');
            if (track.artists && track.artists.length > 0) {
              artistName = track.artists.map(a => a.name.replace(/\s+\(\d+\)$/, '')).join(', ');
            }
          } else {
            title = file.name.replace(/\.[^/.]+$/, '');
          }
        } else {
          // Use filename as title
          title = file.name.replace(/\.[^/.]+$/, '');
        }
          // Build line based on format order
        const lineData = formatOrder
          .map(item => {
            if (item.value === 'blank') return '';
            if (item.value === 'startTime') return start;
            if (item.value === 'endTime') return end;
            if (item.value === 'title') return title;
            if (item.value === 'dash') return '-';
            if (item.value === 'dash-artist') return (!artistDisabled && artistName) ? '-' : '';
            if (item.value === 'artist') return artistName;
            return '';
          })
          .filter(Boolean)
          .join(' ');
          
        lines.push(lineData);
        // Add track credits if enabled and available from Discogs data
        if (includeTrackCredits && metadataSource && metadataSource.type === 'url') {
          const track = metadataSource.data.tracklist?.[idx];
          if (track && track.extraartists && track.extraartists.length > 0) {
            lines.push(`  Credits:`);
            track.extraartists.forEach(artist => {
              lines.push(`      ${artist.name} (${artist.role})`);
            });
            lines.push(''); // Add blank line after credits
          }
        }

        currentTime += duration;
      });
    } else if (timingData.type === 'url') {
      timingData.tracks.forEach((track, idx) => {
        const duration = timingData.durations[idx] || 0;
        const start = formatTime(currentTime);
        const end = formatTime(currentTime + duration);
        
        let title = track.title || '';
        let artistName = '';
        
        if (track.artists && track.artists.length > 0) {
          artistName = track.artists.map(a => a.name.replace(/\s+\(\d+\)$/, '')).join(', ');
        }
          // Build line based on format order
        const lineData = formatOrder
          .map(item => {
            if (item.value === 'blank') return '';
            if (item.value === 'startTime' ) return start;
            if (item.value === 'endTime' ) return end;
            if (item.value === 'title' ) return title;
            if (item.value === 'dash' ) return '-';
            if (item.value === 'dash-artist' ) return (!artistDisabled && artistName) ? '-' : '';
            if (item.value === 'artist') return artistName;
            return '';
          })
          .filter(Boolean)
          .join(' ');
            
        lines.push(lineData);
        // Add track credits if enabled and available
        if (includeTrackCredits && track.extraartists && track.extraartists.length > 0) {
          lines.push(`  Credits:`);
          track.extraartists.forEach(artist => {
            lines.push(`      ${artist.name} (${artist.role})`);
          });
          lines.push('');
        }

        currentTime += duration;
      });
    }
    
    setInputValue(lines.join('\n'));
  };
  // Helper function to update combined timestamps when format changes
  useEffect(() => {
    if (inputSources.url.data || inputSources.files.data) {
      generateCombinedTimestamps();
    }
  }, [formatOrder, artistDisabled, inputSources, includeTrackCredits]);

  // Reset function for input sources
  const handleReset = () => {
    setFormatOrder(defaultFormatOrder);
    setSelectOptions(defaultSelectOptions);
    setInputValue('');
    setUrlInput('');
    setDebugInfo({ url: '', files: [] });
    setArtistDisabled(true);
    audioFilesRef.current = [];
    durationsRef.current = [];
    discogsTracksRef.current = [];
    discogsDurationsRef.current = [];
    setInputSource(null);
    setFormatSuggestion(null);
    setTagsValue('');
    setHashtagsValue('');
    setTagsCopyState('idle');
    setHashtagsCopyState('idle');
    setParsedTags({
      artists: [],
      album: [],
      tracklist: [],
      combinations: []
    });    setTagFilters({
      artists: { enabled: true, percentage: 100, count: 0, totalChars: 0, sliderValue: 100 },
      album: { enabled: true, percentage: 100, count: 0, totalChars: 0, sliderValue: 100 },
      tracklist: { enabled: true, percentage: 100, count: 0, totalChars: 0, sliderValue: 100 },
      combinations: { enabled: true, percentage: 100, count: 0, totalChars: 0, sliderValue: 100 }
    });
    setVideoTitleRecommendations([]);
    setVideoTitleCopyState('idle');
    setVideoTitleVariation(0);
    setDiscogsData(null);
    
    // Reset input sources
    setInputSources({
      url: {
        data: null,
        metadata: true,
        times: true,
        label: ''
      },
      files: {
        data: null,
        metadata: true,
        times: true,
        label: ''      }
    });
  };  const processDiscogsResponseToTags = (response) => {
    if (!response) return;
    
    const tagCategories = {
      artists: new Set(),
      album: new Set(), 
      tracklist: new Set(),
      combinations: new Set(),
      credits: new Set() // NEW: for credits
    };
    
    // Clean function to remove Discogs suffixes and slashes
    const cleanName = (name) => {
      if (!name) return '';
      return name
        .replace(/\s+\(\d+\)$/, '') // Remove (number) suffixes
        .replace(/\s*\/\s*/g, ', ') // Replace slashes with commas
        .trim();
    };
    
    // Process main album artists
    if (response.artists) {
      response.artists.forEach(artist => {
        if (artist.name) {
          const cleanArtist = cleanName(artist.name);
          // Split by commas in case cleaning created multiple items
          cleanArtist.split(',').forEach(item => {
            const trimmed = item.trim();
            if (trimmed) tagCategories.artists.add(trimmed);
          });
        }
      });
    }
    
    // Process album info
    if (response.title) {
      const cleanTitle = cleanName(response.title);
      cleanTitle.split(',').forEach(item => {
        const trimmed = item.trim();
        if (trimmed) tagCategories.album.add(trimmed);
      });
    }
    if (response.released) tagCategories.album.add(response.released.substring(0, 4));
    if (response.genres) {
      response.genres.forEach(genre => {
        const cleanGenre = cleanName(genre);
        cleanGenre.split(',').forEach(item => {
          const trimmed = item.trim();
          if (trimmed) tagCategories.album.add(trimmed);
        });
      });
    }
    if (response.styles) {
      response.styles.forEach(style => {
        const cleanStyle = cleanName(style);
        cleanStyle.split(',').forEach(item => {
          const trimmed = item.trim();
          if (trimmed) tagCategories.album.add(trimmed);
        });
      });
    }
    if (response.labels && response.labels.length > 0) {
      const cleanLabel = cleanName(response.labels[0].name);
      cleanLabel.split(',').forEach(item => {
        const trimmed = item.trim();
        if (trimmed) tagCategories.album.add(trimmed);
      });
    }
    
    // Process tracklist
    if (response.tracklist) {
      response.tracklist.forEach(track => {
        // Add track titles
        if (track.title) {
          const cleanTitle = cleanName(track.title);
          cleanTitle.split(',').forEach(item => {
            const trimmed = item.trim();
            if (trimmed) tagCategories.tracklist.add(trimmed);
          });
        }
        
        // Add individual track artists to artists category
        if (track.artists && track.artists.length > 0) {
          track.artists.forEach(artist => {
            if (artist.name) {
              const cleanArtist = cleanName(artist.name);
              cleanArtist.split(',').forEach(item => {
                const trimmed = item.trim();
                if (trimmed) tagCategories.artists.add(trimmed);
              });
            }
          });
        }
        
        // Add track extra artists (producers, etc.)
        if (track.extraartists && track.extraartists.length > 0) {
          track.extraartists.forEach(artist => {
            if (artist.name) {
              const cleanArtist = cleanName(artist.name);
              cleanArtist.split(',').forEach(item => {
                const trimmed = item.trim();
                if (trimmed) tagCategories.artists.add(trimmed);
              });
              // Add credit as "Name (Role)" to credits set
              if (artist.role) {
                tagCategories.credits.add(`${artist.name.replace(/\s+\(\d+\)$/, '')} (${artist.role})`);
              }
            }
          });
        }
      });
    }
    
    // Generate combinations (artist + album, artist + track, etc.)
    const albumTitle = response.title ? cleanName(response.title).split(',')[0].trim() : '';
    const mainArtists = Array.from(tagCategories.artists);
    
    // Create artist + album combinations
    if (albumTitle && mainArtists.length > 0) {
      mainArtists.slice(0, 3).forEach(artist => {
        tagCategories.combinations.add(`${artist} ${albumTitle}`);
      });
    }
    
    // Create artist + genre combinations if available
    if (response.genres && mainArtists.length > 0) {
      response.genres.slice(0, 2).forEach(genre => {
        const cleanGenre = cleanName(genre).split(',')[0].trim();
        if (cleanGenre) {
          mainArtists.slice(0, 2).forEach(artist => {
            tagCategories.combinations.add(`${artist} ${cleanGenre}`);
          });
        }
      });
    }
    
    const processedTags = {
      artists: Array.from(tagCategories.artists),
      album: Array.from(tagCategories.album),
      tracklist: Array.from(tagCategories.tracklist),
      combinations: Array.from(tagCategories.combinations),
      credits: Array.from(tagCategories.credits) // NEW
    };
    
    setParsedTags(processedTags);
    
    // Calculate tag filter statistics with slider values
    const calculateStats = (tags) => ({
      enabled: true,
      percentage: 100,
      count: tags.length,
      totalChars: tags.join(',').length,
      sliderValue: 100 // Default to 100% (show all tags)
    });
    
    setTagFilters({
      artists: calculateStats(processedTags.artists),
      album: calculateStats(processedTags.album),
      tracklist: calculateStats(processedTags.tracklist),
      combinations: calculateStats(processedTags.combinations),
      credits: calculateStats(processedTags.credits) // NEW
    });
    
    // Generate initial tags value with all categories (including credits if enabled)
    updateTagsValue(processedTags, {
      artists: { enabled: true, sliderValue: 100 },
      album: { enabled: true, sliderValue: 100 },
      tracklist: { enabled: true, sliderValue: 100 },
      combinations: { enabled: true, sliderValue: 100 },
      credits: { enabled: includeTrackCredits, sliderValue: 100 } // NEW
    });
  };
    // Helper function to update tags value based on filters and sliders
  const updateTagsValue = (tags, filters) => {
    const allSelectedTags = new Set(); // Use Set to prevent duplicates
    
    if (filters.artists.enabled && tags.artists.length > 0) {
      const count = Math.ceil((tags.artists.length * filters.artists.sliderValue) / 100);
      tags.artists.slice(0, count).forEach(tag => allSelectedTags.add(tag));
    }
    if (filters.album.enabled && tags.album.length > 0) {
      const count = Math.ceil((tags.album.length * filters.album.sliderValue) / 100);
      tags.album.slice(0, count).forEach(tag => allSelectedTags.add(tag));
    }
    if (filters.tracklist.enabled && tags.tracklist.length > 0) {
      const count = Math.ceil((tags.tracklist.length * filters.tracklist.sliderValue) / 100);
      tags.tracklist.slice(0, count).forEach(tag => allSelectedTags.add(tag));
    }
    if (filters.combinations.enabled && tags.combinations.length > 0) {
      const count = Math.ceil((tags.combinations.length * filters.combinations.sliderValue) / 100);
      tags.combinations.slice(0, count).forEach(tag => allSelectedTags.add(tag));
    }
    // NEW: Add credits if enabled
    if (filters.credits && filters.credits.enabled && tags.credits && tags.credits.length > 0) {
      const count = Math.ceil((tags.credits.length * (filters.credits.sliderValue || 100)) / 100);
      tags.credits.slice(0, count).forEach(tag => allSelectedTags.add(tag));
    }
    setTagsValue(Array.from(allSelectedTags).join(', ')); // No ellipsis or truncation marker
  };

  // Helper function to convert tags to hashtags
  const updateHashtagsValue = (tagsStr) => {
    if (!tagsStr.trim()) {
      setHashtagsValue('');
      return;
    }
    
    // Split by comma, clean each tag, and convert to hashtag format
    const hashtags = tagsStr
      .split(',')
      .map(tag => {
        const cleanTag = tag.trim();
        if (!cleanTag) return '';
        
        // Remove spaces and special characters, keep alphanumeric and basic chars
        const hashtagText = cleanTag
          .replace(/[^\w\s-]/g, '') // Remove special chars except hyphens
          .replace(/\s+/g, '') // Remove all spaces
          .replace(/-+/g, ''); // Remove hyphens
        
        return hashtagText ? `#${hashtagText}` : '';
      })
      .filter(Boolean); // Remove empty strings
    
    setHashtagsValue(hashtags.join(' '));
  };

  // Update hashtags whenever tagsValue changes
  useEffect(() => {
    updateHashtagsValue(tagsValue);
  }, [tagsValue]);

  const logDiscogsRequest = ({ route, payload, response }) => {
    console.log('[Discogs API Request]', { route, payload, response });
  };

  // Check if anything has changed
  const isChanged = inputSources.url.data || inputSources.files.data || inputValue !== '' || urlInput !== '';

  // Loading state
  if (!hasHydrated || !isClient) {
    return (
      <div>
        <div className={styles.taggerText} style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
          <strong>Loading...</strong>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.taggerText} style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
        <strong>Input:</strong>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '1rem',
          marginBottom: '1rem',
          flexWrap: 'wrap'
        }}
      >
        <div
          style={{
            flex: '1 1 300px',
            minWidth: 0,
            width: '100%',
            boxSizing: 'border-box'
          }}
        >
          <FileDrop onFilesSelected={handleFilesSelected} />
        </div>
        <div
          style={{
            flex: '1 1 300px',
            minWidth: 0,
            width: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            height: '100%'
          }}
        >
          <form
            style={{
              marginBottom: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              width: '100%'
            }}
            onSubmit={handleUrlSubmit}
          >
            <label
              htmlFor="url-input"
              className={styles.taggerText}
              style={{ marginBottom: 0, marginRight: '0.5rem' }}
            >
              URL:
            </label>
            <div style={{ display: 'flex', flex: 1, width: '100%' }}>
              <input
                id="url-input"
                type="text"
                placeholder="Paste a supported URL"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                style={{
                  padding: '0.5rem',
                  borderRadius: '4px 0 0 4px',
                  border: '1px solid #fafafa',
                  borderRight: 'none',
                  color: '#222',
                  background: '#fff',
                  flex: 1,
                  minWidth: 0,
                  width: '100%',
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleUrlSubmit(e);
                  }
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0 4px 4px 0',
                  border: '1px solid #ccc',
                  borderLeft: 'none',
                  background: '#eee',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.2s, box-shadow 0.2s, color 0.2s',
                  width: 'auto',
                  flexShrink: 0
                }}
              >
                Submit
              </button>
            </div>
          </form>
          <div
            className={styles.taggerText}
            style={{
              marginBottom: '0.25rem',
              maxWidth: '100%',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              fontSize: '0.95em'
            }}
          >
            <small>
              Supported URLs: Discogs, Bandcamp
            </small>
          </div>
        </div>
      </div>

      {/* Input Sources Table */}
      {(inputSources.url.data || inputSources.files.data) && (
        <>
          {/* <hr style={{ border: 'none', borderTop: '1px solid black', height: '1px' }} /> */}
          <div className={styles.taggerText} style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
            <strong>Input Sources:</strong>
          </div>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid #ccc',
            marginBottom: '1rem',
            background: '#ffffff'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem', border: '1px solid #ccc', width: '40%' }}>Source</th>
                <th style={{ textAlign: 'center', padding: '0.5rem', border: '1px solid #ccc', width: '30%' }}>Metadata</th>
                <th style={{ textAlign: 'center', padding: '0.5rem', border: '1px solid #ccc', width: '30%' }}>Times</th>
              </tr>
            </thead>
            <tbody>{inputSources.url.data && (
                <tr>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc' }}>
                    <strong>URL:</strong> {inputSources.url.label}
                  </td>
                  <td style={{ textAlign: 'center', padding: '0.5rem', border: '1px solid #ccc' }}>
                    <input
                      type="checkbox"
                      checked={inputSources.url.metadata}
                      onChange={e => handleInputSourceChange('url', 'metadata', e.target.checked)}
                    />
                  </td>
                  <td style={{ textAlign: 'center', padding: '0.5rem', border: '1px solid #ccc' }}>
                    <input
                      type="checkbox"
                      checked={inputSources.url.times}
                      onChange={e => handleInputSourceChange('url', 'times', e.target.checked)}
                    />
                  </td>
                </tr>
              )}
              {inputSources.files.data && (
                <tr>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc' }}>
                    <strong>Files:</strong> {inputSources.files.label}
                  </td>
                  <td style={{ textAlign: 'center', padding: '0.5rem', border: '1px solid #ccc' }}>
                    <input
                      type="checkbox"
                      checked={inputSources.files.metadata}
                      onChange={e => handleInputSourceChange('files', 'metadata', e.target.checked)}
                    />
                  </td>
                  <td style={{ textAlign: 'center', padding: '0.5rem', border: '1px solid #ccc' }}>
                    <input
                      type="checkbox"
                      checked={inputSources.files.times}
                      onChange={e => handleInputSourceChange('files', 'times', e.target.checked)}
                    />
                  </td>
                </tr>
              )}</tbody>
          </table>
        </>
      )}      
      {/* <hr style={{ border: 'none', borderTop: '1px solid black', height: '1px' }} /> */}
      <div className={styles.taggerText} style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
        <strong>Timestamps:</strong>
      </div>

      {/* --- Timestamp Formatting Dropdowns & Drag-and-Drop --- */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          gap: 0,
          justifyContent: 'center',
          alignItems: 'stretch',
          height: '2.5rem',
        }}
        className="timestamp-format-container"
      >
        {formatOrder.map((item, idx) => (
          <div
            key={`format-item-${item.id}`}
            draggable
            onDragStart={(e) => {
              setDraggedIndex(idx);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', idx.toString());
              // Drag image logic
              const originalElement = e.target;
              const dragImage = originalElement.cloneNode(true);
              dragImage.style.position = 'absolute';
              dragImage.style.top = '-1000px';
              dragImage.style.left = '-1000px';
              dragImage.style.opacity = '0.8';
              dragImage.style.transform = 'rotate(5deg)';
              dragImage.style.width = originalElement.offsetWidth + 'px';
              dragImage.style.height = originalElement.offsetHeight + 'px';
              dragImage.style.display = 'flex';
              dragImage.style.alignItems = 'stretch';
              dragImage.style.pointerEvents = 'none';
              dragImage.style.zIndex = '9999';
              document.body.appendChild(dragImage);
              e.dataTransfer.setDragImage(dragImage, e.offsetX, e.offsetY);
              setTimeout(() => {
                if (document.body.contains(dragImage)) {
                  document.body.removeChild(dragImage);
                }
              }, 0);
            }}
            onDragEnd={() => {
              setDraggedIndex(null);
              setDragOverIndex(null);
            }}
            onDragOver={e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDragEnter={e => {
              e.preventDefault();
              if (draggedIndex !== null && draggedIndex !== idx) {
                setDragOverIndex(idx);
              }
            }}
            onDragLeave={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX;
              const y = e.clientY;
              if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                setDragOverIndex(null);
              }
            }}
            onDrop={e => {
              e.preventDefault();
              if (draggedIndex === null || draggedIndex === idx) {
                setDragOverIndex(null);
                return;
              }
              // Reorder both formatOrder and selectOptions
              const newFormatOrder = [...formatOrder];
              const newSelectOptions = [...selectOptions];
              const draggedItem = newFormatOrder[draggedIndex];
              const draggedOptions = newSelectOptions[draggedIndex];
              newFormatOrder.splice(draggedIndex, 1);
              newSelectOptions.splice(draggedIndex, 1);
              newFormatOrder.splice(idx, 0, draggedItem);
              newSelectOptions.splice(idx, 0, draggedOptions);
              setFormatOrder(newFormatOrder);
              setSelectOptions(newSelectOptions);
              setDragOverIndex(null);

              // --- ADDED: Regenerate timestamps after drag-and-drop ---
              // This ensures the textarea updates immediately after reordering
              setTimeout(() => {
                if (inputSources.url.data || inputSources.files.data) {
                  generateCombinedTimestamps();
                } else {
                  // fallback: update from refs if not using inputSources
                  // Helper: check if dash-artist dropdown is present and enabled
                  const dashArtistIdx = newFormatOrder.findIndex(item => item.value === 'dash-artist');
                  const dashArtistEnabled = dashArtistIdx !== -1 && !artistDisabled;
                  if (inputSource === 'files' && audioFilesRef.current.length > 0) {
                    let currentTime = 0;
                    const lines = audioFilesRef.current.map((file, idx2) => {
                      const start = formatTime(currentTime);
                      const end = formatTime(currentTime + (durationsRef.current[idx2] || 0));
                      const title = file.name.replace(/\.[^/.]+$/, '');
                      currentTime += durationsRef.current[idx2] || 0;
                      return newFormatOrder
                        .map((item2) => {
                          if (item2.value === 'blank') return '';
                          if (item2.value === 'startTime') return start;
                          if (item2.value === 'endTime') return end;
                          if (item2.value === 'title' ) return title;
                          if (item2.value === 'dash' ) return '-';
                          if (item2.value === 'dash-artist' ) return dashArtistEnabled ? '-' : '';
                          if (item2.value === 'artist') return '';
                          return '';
                        })
                        .filter(Boolean)
                        .join(' ');
                    });
                    setInputValue(lines.join('\n'));
                  } else if (inputSource === 'discogs' && discogsTracksRef.current.length > 0) {
                    let currentTime = 0;
                    const lines = discogsTracksRef.current.map((track, idx2) => {
                      const durationSec = discogsDurationsRef.current[idx2] || 0;
                      const start = formatTime(currentTime);
                      const end = formatTime(currentTime + durationSec);
                      currentTime += durationSec;
                      // Get artist name for this track if present
                      let artistName = '';
                      if (Array.isArray(track.artists) && track.artists.length > 0 && track.artists[0].name) {
                        artistName = track.artists.map(a => a.name).join(', ');
                      }
                      return newFormatOrder
                        .map(item2 => {
                          if (item2.value === 'blank') return '';
                          if (item2.value === 'startTime') return start;
                          if (item2.value === 'endTime') return end;
                          if (item2.value === 'title' ) return track.title || '';
                          if (item2.value === 'dash' ) return '-'; // Fixed: removed extra quote
                          if (item2.value === 'dash-artist' ) return dashArtistEnabled ? '-' : '';
                          if (item2.value === 'artist') return artistName;
                          return '';
                        })
                        .filter(Boolean)
                        .join(' ');
                    });
                    setInputValue(lines.join('\n'));
                  }
                }
              }, 0);
              // --- END ADDED ---
            }}
            style={{
              display: 'flex',
              alignItems: 'stretch',
              flex: 1,
              minWidth: 0,
              opacity: draggedIndex === idx ? 0.3 : 1,
              backgroundColor: dragOverIndex === idx ? '#e3f2fd' : 'transparent',
              transform: draggedIndex === idx ? 'scale(1.02) rotate(2deg)' : 'none',
              transition: draggedIndex === idx ? 'none' : 'all 0.2s ease',
              cursor: draggedIndex === idx ? 'grabbing' : 'grab',
              zIndex: draggedIndex === idx ? 1000 : 1,
              border: dragOverIndex === idx ? '2px dashed #2196f3' : '2px solid transparent'
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: 0,
                paddingLeft: 4,
                paddingRight: 4,
                background: draggedIndex === idx ? '#bbdefb' : '#fff',
                borderTopLeftRadius: idx === 0 ? 4 : 0,
                borderBottomLeftRadius: idx === 0 ? 4 : 0,
                borderTopRightRadius: 0,
                borderBottomRightRadius: 0,
                border: '1px solid #ccc',
                borderRight: 'none',
                cursor: draggedIndex === idx ? 'grabbing' : 'grab',
                userSelect: 'none',
                transition: 'background-color 0.2s',
                color: draggedIndex === idx ? '#1976d2' : '#666'
              }}
            >
              <GripVertical size={18} />
            </span>
            <select
              className="taggerOptions"
              id={`taggerOption${item.id}`}
              value={item.value}
              onChange={e => handleSelectChange(idx, e.target.value)}
              disabled={
                (item.value === 'artist' && artistDisabled) ||
                (item.value === 'dash-artist' && artistDisabled)
              }
              style={{
                height: '100%',
                flex: 1,
                minWidth: 0,
                padding: 0,
                borderRadius: idx === 0
                  ? '0 0 0 0'
                  : idx === formatOrder.length - 1
                  ? '0 4px 4px 0'
                  : '0',
                border: '1px solid #ccc',
                borderLeft: 'none',
                borderRight: idx !== formatOrder.length - 1 ? 'none' : '1px solid #ccc',
                fontSize: '1rem',
                textAlign: 'center',
                background: draggedIndex === idx ? '#f5f5f5' : '#fff',
                boxSizing: 'border-box',
                cursor:
                  ((item.value === 'artist' && artistDisabled) ||
                    (item.value === 'dash-artist' && artistDisabled))
                    ? 'not-allowed'
                    : 'pointer',
                pointerEvents: draggedIndex === idx ? 'none' : 'auto'
              }}
            >
              {selectOptions[idx].map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {/* --- End Timestamp Formatting Dropdowns --- */}

      <div style={{ width: '100%' }}>
        <textarea
          value={inputValue ? `Timestamps generated by https://tagger.site:\n${inputValue}` : ''}
          onChange={e => {
            const prefix = 'Timestamps generated by https://tagger.site:\n';
            let val = e.target.value;
            if (val.startsWith(prefix)) val = val.slice(prefix.length);
            setInputValue(val);
          }}
          placeholder={
            inputValue
              ? ''
              : `Tracklist generated by http://tagger.site: 
00:00 - 02:36 Metal
02:36 - 06:06 Nada Mas 
06:06 - 10:17 El Sombrero De Metal 
10:17 - 13:52 Plata De Azul
13:52 - 18:18 Manzanita
18:18 - 21:03 Imprevu`
          }
          rows={7}
          style={{
            width: '100%',
            minWidth: '100%',
            padding: '0.5rem',
            borderRadius: '4px',
            border: '1px solid #ccc',
            fontSize: '1rem',
            boxSizing: 'border-box',
            display: 'block',
            resize: 'both'
          }}
        />
        <button
          style={{
            width: '100%',
            padding: '0.5rem',
            borderRadius: '4px',
            border: '1px solid #ccc',
            background: copyState === 'copied' ? '#ffe156' : '#eee',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: '0.25rem',
            display: 'block',
            transition: 'background 0.2s, box-shadow 0.2s, color 0.2s'
          }}
          onClick={handleCopy}
        >
          {copyState === 'copied'
            ? 'Copied!'
            : `Copy ${(inputValue ? (`Timestamps generated by https://tagger.site:\n${inputValue}`) : '').length} chars to clipboard`}
        </button>
        <div style={{ margin: '0.5rem 0' }}>
          <label style={{ fontSize: '0.95rem', color: '#333' }}>
            <input
              type="checkbox"
              checked={includeTrackCredits}
              onChange={e => {
                const enabled = e.target.checked;
                setIncludeTrackCredits(enabled);
                // regenerate timestamps with credits
                generateCombinedTimestamps();
                // update tag filters so credits show up in Tags/Hashtags
                setTagFilters(prev => {
                  const next = {
                    ...prev,
                    credits: { ...(prev.credits || { sliderValue: 100 }), enabled }
                  };
                  updateTagsValue(parsedTags, next);
                  return next;
                });
              }}
              style={{ marginRight: '0.5rem' }}
            />
            Include track credits
          </label>
        </div>
      </div>

      <button
        type="button"
        onClick={handleReset}
        style={{
          margin: '1rem 0 1rem 0',
          background: '#f6f6f6',
          border: '1px solid #ccc',
          borderRadius: 4,
          padding: '0.5rem 1.2rem',
          fontWeight: 600,
          fontSize: '1em',
          cursor: 'pointer',
          color: '#222',
          display: 'block',
          width: '100%',
          transition: 'background 0.2s, box-shadow 0.2s, color 0.2s'
        }}
      >
        Clear / Reset
      </button>

      {/* Video Title Recommendations Section */}
      {videoTitleRecommendations.length > 0 && (
        <>
          {/* <hr style={{ border: 'none', borderTop: '1px solid black', height: '1px' }} /> */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div className={styles.taggerText} style={{ fontSize: '1.1rem', marginBottom: 0 }}>
              <strong>Video Title Recommendations:</strong>
            </div>
            <button
              onClick={handleVideoTitleRefresh}
              style={{
                padding: '0.25rem 0.5rem',
                fontSize: '0.8rem',
                borderRadius: '4px',
                border: '1px solid #ccc',
                background: '#eee',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s, box-shadow 0.2s, color 0.2s',
                whiteSpace: 'nowrap'
              }}
              title="Generate different video title combinations"
            >
              🔄 Refresh
            </button>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            {videoTitleRecommendations.map((title, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: '0.5rem',
                  padding: '0.5rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#f9f9f9'
                }}
              >
                <div
                  style={{
                    flex: 1,
                    fontSize: '0.95rem',
                    color: '#333',
                    wordBreak: 'break-word',
                    marginRight: '0.5rem'
                  }}
                >
                  {title}
                </div>
                <button
                  onClick={() => handleVideoTitleCopy(title)}
                  style={{
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.8rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    background: videoTitleCopyState === 'copied' ? '#ffe156' : '#eee',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s, box-shadow 0.2s, color 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {videoTitleCopyState === 'copied' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}     
          
      {/* <hr style={{ border: 'none', borderTop: '1px solid black', height: '1px' }} /> */}
      <div className={styles.taggerText} style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
        <strong>Tags:</strong>
      </div>
      
      {/* Tags Type Table */}
      {(parsedTags.artists.length > 0 || parsedTags.album.length > 0 || parsedTags.tracklist.length > 0 || parsedTags.combinations.length > 0 || (includeTrackCredits && parsedTags.credits && parsedTags.credits.length > 0)) && (
        <>          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid #ccc',
            marginBottom: '1rem',
            background: '#ffffff'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5' }}>
                <th style={{ textAlign: 'center', padding: '0.5rem', border: '1px solid #ccc', width: '15%' }}>Include</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', border: '1px solid #ccc', width: '35%' }}>Tag Type</th>
                <th style={{ textAlign: 'center', padding: '0.5rem', border: '1px solid #ccc', width: '50%' }}>Percentage</th>
              </tr>
            </thead>
            <tbody>{parsedTags.artists.length > 0 && (
                <tr>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <input
                      type="checkbox"
                      checked={tagFilters.artists.enabled}
                      onChange={(e) => setTagFilters(prev => {
                        const newFilters = {
                          ...prev,
                          artists: { ...prev.artists, enabled: e.target.checked }
                        };
                        updateTagsValue(parsedTags, newFilters);
                        return newFilters;
                      })}
                    />
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', verticalAlign: 'middle' }}>
                    <strong>Artist(s)</strong>
                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                      {parsedTags.artists.length} total tags
                    </div>
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={tagFilters.artists.sliderValue}
                        onChange={(e) => {

                          const newValue = parseInt(e.target.value);
                          setTagFilters(prev => ({
                            ...prev,
                            artists: { ...prev.artists, sliderValue: newValue }
                          }));
                          updateTagsValue(parsedTags, {
                            ...tagFilters,
                            artists: { ...tagFilters.artists, sliderValue: newValue }
                          });
                        }}
                        style={{ width: '100%' }}
                      />
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>
                        {tagFilters.artists.sliderValue}% ({Math.ceil((parsedTags.artists.length * tagFilters.artists.sliderValue) / 100)} tags)
                      </div>
                    </div>
                  </td>
                </tr>
              )}              {parsedTags.album.length > 0 && (
                <tr>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <input
                      type="checkbox"
                      checked={tagFilters.album.enabled}
                      onChange={(e) => setTagFilters(prev => {
                        const newFilters = {
                          ...prev,
                          album: { ...prev.album, enabled: e.target.checked }
                        };
                        updateTagsValue(parsedTags, newFilters);
                        return newFilters;
                      })}
                    />
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', verticalAlign: 'middle' }}>
                    <strong>Album</strong>
                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                      {parsedTags.album.length} total tags
                    </div>
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={tagFilters.album.sliderValue}
                        onChange={(e) => {
                          const newValue = parseInt(e.target.value);
                          setTagFilters(prev => ({
                            ...prev,
                            album: { ...prev.album, sliderValue: newValue }
                          }));
                          updateTagsValue(parsedTags, {
                            ...tagFilters,
                            album: { ...tagFilters.album, sliderValue: newValue }
                          });
                        }}
                        style={{ width: '100%' }}
                      />
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>
                        {tagFilters.album.sliderValue}% ({Math.ceil((parsedTags.album.length * tagFilters.album.sliderValue) / 100)} tags)
                      </div>
                    </div>
                  </td>
                </tr>
              )}              {parsedTags.tracklist.length > 0 && (
                <tr>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <input
                      type="checkbox"
                      checked={tagFilters.tracklist.enabled}
                      onChange={(e) => setTagFilters(prev => {
                        const newFilters = {
                          ...prev,
                          tracklist: { ...prev.tracklist, enabled: e.target.checked }
                        };
                        updateTagsValue(parsedTags, newFilters);
                        return newFilters;
                      })}
                    />
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', verticalAlign: 'middle' }}>
                    <strong>Tracklist</strong>
                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                      {parsedTags.tracklist.length} total tags
                    </div>
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={tagFilters.tracklist.sliderValue}
                        onChange={(e) => {
                          const newValue = parseInt(e.target.value);
                          setTagFilters(prev => ({
                            ...prev,
                            tracklist: { ...prev.tracklist, sliderValue: newValue }
                          }));
                          updateTagsValue(parsedTags, {
                            ...tagFilters,
                            tracklist: { ...tagFilters.tracklist, sliderValue: newValue }
                          });
                        }}
                        style={{ width: '100%' }}
                      />
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>
                        {tagFilters.tracklist.sliderValue}% ({Math.ceil((parsedTags.tracklist.length * tagFilters.tracklist.sliderValue) / 100)} tags)
                      </div>
                    </div>
                  </td>
                </tr>
              )}              {parsedTags.combinations.length > 0 && (
                <tr>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <input
                      type="checkbox"
                      checked={tagFilters.combinations.enabled}
                      onChange={(e) => setTagFilters(prev => {
                        const newFilters = {
                          ...prev,
                          combinations: { ...prev.combinations, enabled: e.target.checked }
                        };
                        updateTagsValue(parsedTags, newFilters);
                        return newFilters;
                      })}
                    />
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', verticalAlign: 'middle' }}>
                    <strong>Combinations</strong>
                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                      {parsedTags.combinations.length} total tags
                    </div>
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={tagFilters.combinations.sliderValue}
                        onChange={(e) => {
                          const newValue = parseInt(e.target.value);
                          setTagFilters(prev => ({
                            ...prev,
                            combinations: { ...prev.combinations, sliderValue: newValue }
                          }));
                          updateTagsValue(parsedTags, {
                            ...tagFilters,
                            combinations: { ...tagFilters.combinations, sliderValue: newValue }
                          });
                        }}
                        style={{ width: '100%' }}
                      />
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>
                        {tagFilters.combinations.sliderValue}% ({Math.ceil((parsedTags.combinations.length * tagFilters.combinations.sliderValue) / 100)} tags)
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {/* Add credits row if enabled and available */}
              {includeTrackCredits && parsedTags.credits && parsedTags.credits.length > 0 && (
                <tr>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <input
                      type="checkbox"
                      checked={tagFilters.credits && tagFilters.credits.enabled}
                      onChange={e => setTagFilters(prev => {
                        const newFilters = {
                          ...prev,
                          credits: { ...prev.credits, enabled: e.target.checked }
                        };
                        updateTagsValue(parsedTags, newFilters);
                        return newFilters;
                      })}
                    />
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', verticalAlign: 'middle' }}>
                    <strong>Track Credits</strong>
                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                      {parsedTags.credits.length} total credits
                    </div>
                  </td>
                  <td style={{ padding: '0.5rem', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={tagFilters.credits ? tagFilters.credits.sliderValue : 100}
                        onChange={e => {
                          const newValue = parseInt(e.target.value);
                          setTagFilters(prev => ({
                            ...prev,
                            credits: { ...prev.credits, sliderValue: newValue }
                          }));
                          updateTagsValue(parsedTags, {
                            ...tagFilters,
                            credits: { ...tagFilters.credits, sliderValue: newValue }
                          });
                        }}
                        style={{ width: '100%' }}
                      />
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>
                        {tagFilters.credits ? tagFilters.credits.sliderValue : 100}% ({Math.ceil((parsedTags.credits.length * (tagFilters.credits ? tagFilters.credits.sliderValue : 100)) / 100)} credits)
                      </div>
                    </div>
                  </td>
                </tr>
              )}</tbody>
          </table>
        </>
      )}
      
      <textarea
        value={tagsValue}
        onChange={e => setTagsValue(e.target.value)}
        placeholder={
          tagsValue
            ? ''
            : `Booker T. Jones,Priscilla Jones,Booker T & The MGs,The Mar-Keys,The Stax Staff,The Packers,The RCO All-Stars,Priscilla Coolidge,Booker T. & Priscilla,1971,France,The Wedding Song,She,The Indian Song,Sea Gull,For Priscilla,The Delta  Song,Why,Mississippi Voodoo,Cool  Black Dream,Sweet Child Youre Not Alone,Booker T. & Priscilla 1971,Booker T. Jones 1971,`
        }
        rows={7}
        style={{
          width: '100%',
          minWidth: '100%',
          padding: '0.5rem',
          borderRadius: '4px',
          border: '1px solid #ccc',
          fontSize: '1rem',
          boxSizing: 'border-box',
          display: 'block',
          resize: 'none'
        }}
      />
      

      
      {/* Simple copy button - always visible */}
      <button
        style={{
          width: '100%',
          padding: '0.5rem',
          borderRadius: '4px',
          border: '1px solid #ccc',
          background: tagsCopyState === 'copied' ? '#ffe156' : '#eee',
          fontWeight: 600,
          cursor: 'pointer',
          marginBottom: '0.5rem',
          display: 'block',
          transition: 'background 0.2s, box-shadow 0.2s, color 0.2s'
        }}
        onClick={handleTagsCopy}
      >
        {tagsCopyState === 'copied'
          ? 'Copied!'
          : `Copy ${tagsValue.length} chars to clipboard`}
      </button>

            {/* Tags Controls - moved to appear underneath textarea */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', marginTop: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>

        <input
          type="number"
          value={charLimit}
          onChange={(e) => setCharLimit(e.target.value)}
          min="1"
          max="1000"
          style={{
            padding: '0.5rem',
            borderRadius: '4px',
            border: '1px solid #ccc',
            width: '80px',
            textAlign: 'center'
          }}
          title="Character limit for tag optimization"
        />
        
        <button
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            border: '1px solid #ccc',
            background: '#eee',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.2s, box-shadow 0.2s, color 0.2s'
          }}
          onClick={() => {
            // Optimize tags based on character limit and enabled filters
            const enabledTags = [];
            if (tagFilters.artists.enabled) {
              const count = Math.ceil((parsedTags.artists.length * tagFilters.artists.sliderValue) / 100);
              enabledTags.push(...parsedTags.artists.slice(0, count));
            }
            if (tagFilters.album.enabled) {
              const count = Math.ceil((parsedTags.album.length * tagFilters.album.sliderValue) / 100);
              enabledTags.push(...parsedTags.album.slice(0, count));
            }
            if (tagFilters.tracklist.enabled) {
              const count = Math.ceil((parsedTags.tracklist.length * tagFilters.tracklist.sliderValue) / 100);
              enabledTags.push(...parsedTags.tracklist.slice(0, count));
            }
            if (tagFilters.combinations.enabled) {
              const count = Math.ceil((parsedTags.combinations.length * tagFilters.combinations.sliderValue) / 100);
              enabledTags.push(...parsedTags.combinations.slice(0, count));
            }
            
            // Remove duplicates using Set, then join with commas and spaces
            const uniqueTags = Array.from(new Set(enabledTags));
            const optimized = uniqueTags.join(', ');
            
            if (optimized.length <= parseInt(charLimit)) {
              setTagsValue(optimized);
              setOptimizeStatus(`Optimized to ${optimized.length} chars`);
            } else {
              // Truncate to fit within limit
              const truncated = optimized.substring(0, parseInt(charLimit) - 3) + '...';
              setTagsValue(truncated);
              setOptimizeStatus(`Truncated to ${charLimit} chars`);
            }
            setTimeout(() => setOptimizeStatus(''), 3000);
          }}
        >
          Optimize
        </button>
        
        {optimizeStatus && (
          <span style={{ fontSize: '0.9rem', color: '#666' }}>
            {optimizeStatus}
          </span>
        )}
      </div>

    {/* Hashtags Section */}
    <div>
      <h3 style={{
        color: colors.primaryText,
        marginBottom: '1rem',
        fontSize: '1.2rem',
        fontWeight: 600
      }}>
        Hashtags:
      </h3>
      
      <textarea
        value={hashtagsValue}
        onChange={e => setHashtagsValue(e.target.value)}
        placeholder={
          hashtagsValue
            ? ''
            : `#BookerT.Jones #PriscillaJones #BookerT&TheMGs #TheMar-Keys #TheStaxStaff #ThePackers #TheRCOAll-Stars #PriscillaCoolidge #BookerT.&Priscilla #1971 #France #TheWeddingSong #She #TheIndianSong #SeaGull #ForPriscilla #TheDeltaSong #Why #MississippiVoodoo #CoolBlackDream #SweetChildYoureNotAlone #BookerT.&Priscilla1971 #BookerT.Jones1971`
        }
        rows={5}
        style={{
          width: '100%',
          minWidth: '100%',
          padding: '0.5rem',
          borderRadius: '4px',
          border: '1px solid #ccc',
          fontSize: '1rem',
          boxSizing: 'border-box',
          display: 'block',
          resize: 'none'
        }}
      />
      
      <button
        style={{
          width: '100%',
          padding: '0.5rem',
          borderRadius: '4px',
          border: '1px solid #ccc',
          background: hashtagsCopyState === 'copied' ? '#ffe156' : '#eee',
          fontWeight: 600,
          cursor: 'pointer',
          marginBottom: '0.5rem',
          display: 'block',
          transition: 'background 0.2s, box-shadow 0.2s, color 0.2s'
        }}
        onClick={handleHashtagsCopy}
      >
        {hashtagsCopyState === 'copied'
          ? 'Copied!'
          : `Copy ${hashtagsValue.length} chars to clipboard`}
      </button>
    </div>
    </div>
  );
}