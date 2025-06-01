"use client";

import React, { useEffect, useRef, useState } from 'react';
import styles from './Tagger.module.css';
import FileDrop from '../FileDrop/FileDrop';
import { useColorContext } from '../ColorContext';

export default function TaggerPage() {
  const { colors } = useColorContext();
  const urlInputContainerRef = useRef(null);
  const [isStacked, setIsStacked] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [debugInfo, setDebugInfo] = useState({ url: '', files: [] });
  const [copyState, setCopyState] = useState('idle'); // idle | copied | hover
  const [discogsResponse, setDiscogsResponse] = useState(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

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
    try {
      const savedOrder = localStorage.getItem('tagger_formatOrder');
      const savedOptions = localStorage.getItem('tagger_selectOptions');
      const savedInputValue = localStorage.getItem('tagger_inputValue');
      const savedArtistDisabled = localStorage.getItem('tagger_artistDisabled');
      if (savedOrder) setFormatOrder(JSON.parse(savedOrder));
      if (savedOptions) setSelectOptions(JSON.parse(savedOptions));
      if (savedInputValue) setInputValue(savedInputValue);
      if (savedArtistDisabled !== null) setArtistDisabled(savedArtistDisabled === 'true');
    } catch {}
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

    // Build tracklist lines
    let currentTime = 0;
    const lines = audioFiles.map((file, idx) => {
      const start = formatTime(currentTime);
      const end = formatTime(currentTime + durations[idx]);
      const title = file.name.replace(/\.[^/.]+$/, '');
      currentTime += durations[idx];

      return formatOrder
        .map((item) => {
          if (item.value === 'blank') return '';
          if (item.value === 'startTime') return start;
          if (item.value === 'endTime') return end;
          if (item.value === 'title') return title;
          if (item.value === 'dash') return '-';
          if (item.value === 'dash-artist') return artistDisabled ? '' : '-';
          if (item.value === 'artist') return '';
          return '';
        })
        .filter(Boolean)
        .join(' ');
    });

    setInputValue(lines.join('\n'));
    setIsLoadingFiles(false);
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
            if (item.value === 'title') return title;
            if (item.value === 'dash') return '-';
            if (item.value === 'dash-artist') return dashArtistEnabled ? '-' : '';
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
            if (item.value === 'title') return track.title || '';
            if (item.value === 'dash') return '-';
            if (item.value === 'dash-artist') return dashArtistEnabled ? '-' : '';
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
            if (item.value === 'title') return title;
            if (item.value === 'dash') return '-';
            if (item.value === 'dash-artist') return dashArtistEnabled ? '-' : '';
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
            if (item.value === 'startTime') return start;
            if (item.value === 'endTime') return end;
            if (item.value === 'title') return track.title || '';
            if (item.value === 'dash') return '-';
            if (item.value === 'dash-artist') return dashArtistEnabled ? '-' : '';
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

  // Apply formatting suggestion
  const applyFormatSuggestion = () => {
    if (formatSuggestion) {
      setInputValue(formatSuggestion.after);
      setFormatSuggestion(null);
    }
  };

  // Handle URL submit (button or enter)
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
        logDiscogsRequest({ route, payload: discogsInfo, response: data });
        // If response has a tracklist, generate textarea output
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
          // Store Discogs tracks and durations for dropdown reactivity
          discogsTracksRef.current = data.tracklist;
          discogsDurationsRef.current = data.tracklist.map(track => parseDuration(track.duration));
          audioFilesRef.current = [];
          durationsRef.current = [];
          setInputSource('discogs');
          // Enable artist dropdown if any track has an artist
          const hasArtist = data.tracklist.some(track => Array.isArray(track.artists) && track.artists.length > 0 && track.artists[0].name);
          setArtistDisabled(!hasArtist);
          // Build textarea output
          let currentTime = 0;
          // Helper: check if dash-artist dropdown is present and enabled
          const dashArtistIdx = formatOrder.findIndex(item => item.value === 'dash-artist');
          const dashArtistEnabled = dashArtistIdx !== -1 && hasArtist;
          const lines = data.tracklist.map((track, idx) => {
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
                if (item.value === 'title') return track.title || '';
                if (item.value === 'dash') return '-';
                if (item.value === 'dash-artist') return dashArtistEnabled ? '-' : '';
                if (item.value === 'artist') return artistName;
                return '';
              })
              .filter(Boolean)
              .join(' ');
          });
          setInputValue(lines.join('\n'));
        }
      } catch (err) {
        console.error('Error fetching Discogs data:', err);
        setDiscogsResponse(null);
        logDiscogsRequest({ route, payload: discogsInfo, response: String(err) });
      }
    }
  };

  // Method to print Discogs response
  const printDiscogsResponse = () => {
    if (discogsResponse) {
      console.log('Discogs API response:', discogsResponse);
    } else {
      console.log('No Discogs response available.');
    }
  };

  // Detect if anything has changed from defaults
  const isChanged =
    JSON.stringify(formatOrder) !== JSON.stringify(defaultFormatOrder) ||
    JSON.stringify(selectOptions) !== JSON.stringify(defaultSelectOptions) ||
    inputValue !== '' ||
    urlInput !== '' ||
    debugInfo.url !== '' ||
    (debugInfo.files && debugInfo.files.length > 0);

  // Reset everything to default
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
    // Remove from localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tagger_formatOrder');
      localStorage.removeItem('tagger_selectOptions');
      localStorage.removeItem('tagger_inputValue');
      localStorage.removeItem('tagger_artistDisabled');
    }
  };

  // Remove artist from placeholder lines
  const exampleLines = [
    {
      startTime: '00:00',
      dash: '-',
      endTime: '02:36',
      title: 'Metal'
    },
    {
      startTime: '02:36',
      dash: '-',
      endTime: '06:06',
      title: 'Nada Mas'
    },
    {
      startTime: '06:06',
      dash: '-',
      endTime: '10:17',
      title: 'El Sombrero De Metal'
    },
    {
      startTime: '10:17',
      dash: '-',
      endTime: '13:52',
      title: 'Plata De Azul'
    },
    {
      startTime: '13:52',
      dash: '-',
      endTime: '18:18',
      title: 'Manzanita'
    },
    {
      startTime: '18:18',
      dash: '-',
      endTime: '21:03',
      title: 'Imprevu'
    }
  ];

  const getPlaceholder = () => {
    const lines = exampleLines.map(lineObj =>
      formatOrder
        .map((item, idx) => {
          if (item.value === 'blank') return '';
          if (item.value in lineObj) return lineObj[item.value];
          return '';
        })
        .filter(Boolean)
        .join(' ')
    );
    return `Sample timestamps generated by https://tagger.site:\n${lines.join('\n')}`;
  };

  useEffect(() => {
    function handleResize() {
      const container = urlInputContainerRef.current;
      if (container) {
        const prev = container.previousElementSibling;
        if (prev) {
          const prevRect = prev.getBoundingClientRect();
          const currRect = container.getBoundingClientRect();
          setIsStacked(currRect.top > prevRect.bottom - 5);
        }
      }
    }
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
          id='url-input-container'
          ref={urlInputContainerRef}
          style={{
            flex: '1 1 300px',
            minWidth: 0,
            width: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            height: '100%',
            paddingTop: isStacked ? 0 : '1rem'
          }}
        >
          <form
            style={{
              marginBottom: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              width: '100%' // Changed from 80% to 100%
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
            <div style={{ display: 'flex', flex: 1, width: '100%' }}> {/* Added width: 100% */}
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
                  width: '100%', // Changed from 0 to 100%
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
                  width: 'auto', // Ensures button only as wide as content
                  flexShrink: 0 // Prevents button from shrinking
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#ffe156';
                  e.currentTarget.style.color = '#000';
                  e.currentTarget.style.boxShadow = '0 2px 8px #ffe15655';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#eee';
                  e.currentTarget.style.color = '#222';
                  e.currentTarget.style.boxShadow = 'none';
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
      <hr style={{ border: 'none', borderTop: '1px solid black', height: '1px' }} />
      <div className={styles.taggerText} style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
        <strong>Timestamps:</strong>
      </div>
      <div style={{ width: '100%' }}>
        <textarea
          value={inputValue ? `Timestamps generated by https://tagger.site:\n${inputValue}` : ''}
          onChange={e => {
            // Remove the prefix if present, then update inputValue
            const prefix = 'Timestamps generated by https://tagger.site:\n';
            let val = e.target.value;
            if (val.startsWith(prefix)) val = val.slice(prefix.length);
            setInputValue(val);
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder={inputFocused ? '' : getPlaceholder()}
          rows={7}
          cols={44}
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
            transition: 'background 0.2s, box-shadow 0.2s, color 0.2s',
            ...(copyState === 'hover'
              ? { background: '#ffe156', color: '#222', boxShadow: '0 2px 8px #ffe15655' }
              : {})
          }}
          onClick={handleCopy}
          onMouseEnter={() => setCopyState(copyState === 'copied' ? 'copied' : 'hover')}
          onMouseLeave={() => setCopyState(copyState === 'copied' ? 'copied' : 'idle')}
        >
          {copyState === 'copied'
            ? 'Copied!'
            : `Copy ${(inputValue ? (`Timestamps generated by https://tagger.site:\n${inputValue}`) : '').length} chars to clipboard`}
        </button>
        {/* Formatting Suggestion Popup */}
        {formatSuggestion && (
          <div
            style={{
              marginTop: '1rem',
              background: '#fffbe6',
              border: '1px solid #ffe156',
              borderRadius: 6,
              padding: '1rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              maxWidth: 600,
              position: 'relative'
            }}
          >
            {/* X button */}
            <button
              onClick={() => setFormatSuggestion(null)}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'transparent',
                border: 'none',
                fontSize: '1.5rem',
                color: '#d97706',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                transition: 'color 0.2s'
              }}
              aria-label="Close formatting suggestion"
              onMouseEnter={e => { e.currentTarget.style.color = '#b45309'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#d97706'; }}
            >
              ×
            </button>
            <button
              onClick={applyFormatSuggestion}
              style={{
                background: '#ffe156',
                color: '#222',
                border: 'none',
                borderRadius: 4,
                padding: '0.5rem 1.2rem',
                fontWeight: 700,
                fontSize: '1em',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                marginBottom: 12,
                display: 'block',
                transition: 'background 0.2s, box-shadow 0.2s, color 0.2s'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#ffd700';
                e.currentTarget.style.color = '#000';
                e.currentTarget.style.boxShadow = '0 2px 8px #ffd70055';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = '#ffe156';
                e.currentTarget.style.color = '#222';
                e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)';
              }}
            >
              Click to remove duplicate text: "{formatSuggestion.prefix}"
            </button>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              Formatting Suggestion: Remove duplicate text <span style={{ color: '#d97706' }}>"{formatSuggestion.prefix}"</span>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.95em', color: '#888', marginBottom: 2 }}>Before:</div>
                <pre style={{
                  background: '#f6f6f6',
                  border: '1px solid #eee',
                  borderRadius: 4,
                  padding: 8,
                  margin: 0,
                  fontSize: '0.98em',
                  whiteSpace: 'pre-wrap'
                }}>{formatSuggestion.before}</pre>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.95em', color: '#888', marginBottom: 2 }}>After:</div>
                <pre style={{
                  background: '#f6f6f6',
                  border: '1px solid #eee',
                  borderRadius: 4,
                  padding: 8,
                  margin: 0,
                  fontSize: '0.98em',
                  whiteSpace: 'pre-wrap'
                }}>{formatSuggestion.after}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Loading Spinner Overlay */}
      {isLoadingFiles && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(255,255,255,0.7)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            border: '6px solid #eee',
            borderTop: '6px solid #6366f1',
            borderRadius: '50%',
            width: 60,
            height: 60,
            animation: 'spin 1s linear infinite',
          }} />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {/* Clear/Reset Button moved here above Debug Box */}
      {isChanged && (
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
          onMouseEnter={e => {
            e.currentTarget.style.background = '#ffe156';
            e.currentTarget.style.color = '#000';
            e.currentTarget.style.boxShadow = '0 2px 8px #ffe15655';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = '#f6f6f6';
            e.currentTarget.style.color = '#222';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          Clear / Reset
        </button>
      )}
      {/* Print Discogs Response Button */}
      {discogsResponse && (
        <button
          type="button"
          onClick={printDiscogsResponse}
          style={{
            margin: '0.5rem 0',
            background: '#e0e7ff',
            border: '1px solid #6366f1',
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
          onMouseEnter={e => {
            e.currentTarget.style.background = '#6366f1';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = '#e0e7ff';
            e.currentTarget.style.color = '#222';
          }}
        >
          Print Discogs API Response to Console
        </button>
      )}
    </div>
  );
}