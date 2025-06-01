"use client";

import React, { useEffect, useRef, useState } from 'react';
import styles from './Tagger.module.css';
import FileDrop from '../FileDrop/FileDrop';
import { useColorContext } from '../ColorContext';
import { GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

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

  const [formatOrder, setFormatOrder] = useState([
    { id: 1, value: 'startTime' },
    { id: 2, value: 'dash' },
    { id: 3, value: 'endTime' },
    { id: 4, value: 'title' },
    { id: 5, value: 'artist' }
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
    { id: 5, value: 'artist' }
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
      { value: 'artist', label: 'artist' },
      { value: 'blank', label: '(blank)' }
    ]
  ];

  // Set artist dropdown disabled by default
  const [artistDisabled, setArtistDisabled] = useState(true);

  // Formatting suggestion state
  const [formatSuggestion, setFormatSuggestion] = useState(null);

  // Load formatOrder/selectOptions from localStorage on mount (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedOrder = localStorage.getItem('tagger_formatOrder');
      const savedOptions = localStorage.getItem('tagger_selectOptions');
      if (savedOrder) setFormatOrder(JSON.parse(savedOrder));
      if (savedOptions) setSelectOptions(JSON.parse(savedOptions));
    } catch {}
  }, []);

  // Save formatOrder/selectOptions to localStorage on change (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('tagger_formatOrder', JSON.stringify(formatOrder));
      localStorage.setItem('tagger_selectOptions', JSON.stringify(selectOptions));
    } catch {}
  }, [formatOrder, selectOptions]);

  const handleSelectChange = (idx, val) => {
    setFormatOrder((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], value: val };
      return updated;
    });
    // Save immediately after change (optional, but useEffect above will also handle)
    // localStorage.setItem('tagger_formatOrder', JSON.stringify(updated));
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

  // Store last audioFiles/durations for dynamic textarea update
  const audioFilesRef = useRef([]);
  const durationsRef = useRef([]);

  // Handle files: get durations, build tracklist, update debug
  const handleFilesSelected = async (files) => {
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
          if (item.value === 'artist') return '';
          return '';
        })
        .filter(Boolean)
        .join(' ');
    });

    setInputValue(lines.join('\n'));
  };

  // Update textarea when dropdowns change and audioFilesRef is set
  useEffect(() => {
    if (audioFilesRef.current.length === 0) return;
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
          if (item.value === 'artist') return '';
          return '';
        })
        .filter(Boolean)
        .join(' ');
    });
    setInputValue(lines.join('\n'));
    // eslint-disable-next-line
  }, [formatOrder]);

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
    navigator.clipboard.writeText(inputValue);
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
  const handleUrlSubmit = (e) => {
    if (e) e.preventDefault();
    setDebugInfo(prev => ({
      ...prev,
      url: urlInput
    }));
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
    setFormatSuggestion(null);
    // Remove from localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tagger_formatOrder');
      localStorage.removeItem('tagger_selectOptions');
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
    return `Sample tracklist generated by http://tagger.site:\n${lines.join('\n')}`;
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

  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  const handleDragStart = (index) => {
    dragItem.current = index;
    setDraggedIndex(index);
  };

  const handleDragEnter = (index) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    const from = dragItem.current;
    const to = dragOverItem.current;
    if (
      from !== undefined &&
      to !== undefined &&
      from !== to &&
      from !== null &&
      to !== null
    ) {
      const newOrder = [...formatOrder];
      const [removed] = newOrder.splice(from, 1);
      newOrder.splice(to, 0, removed);
      setFormatOrder(newOrder);
    }
    setDraggedIndex(null);
    dragItem.current = null;
    dragOverItem.current = null;
  };

  // react-beautiful-dnd reorder helper
  function reorder(list, startIndex, endIndex) {
    const result = Array.from(list);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  }

  // DnD handler for timestamp format dropdowns
  function onFormatDragEnd(result) {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;
    setFormatOrder(prev => reorder(prev, result.source.index, result.destination.index));
    setSelectOptions(prev => reorder(prev, result.source.index, result.destination.index));
    // Save immediately after drag (optional, but useEffect above will also handle)
    // localStorage.setItem('tagger_formatOrder', JSON.stringify(newOrder));
    // localStorage.setItem('tagger_selectOptions', JSON.stringify(newOptions));
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
              gap: 0, // No gap between input and button
              width: '80%'
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
            <div style={{ display: 'flex', flex: 1 }}>
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
                  width: '0',
                  // Ensures input shrinks to allow button to always be visible
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
                  transition: 'background 0.2s, box-shadow 0.2s, color 0.2s'
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
      <DragDropContext onDragEnd={onFormatDragEnd}>
        <Droppable
          droppableId="timestamp-format"
          direction="horizontal"
          isDropDisabled={false}
          isCombineEnabled={false}
          ignoreContainerClipping={false}
        >
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              style={{
                width: '100%',
                display: 'flex',
                gap: 0,
                justifyContent: 'center',
                alignItems: 'stretch',
                height: '2.5rem'
              }}
              className="timestamp-format-container"
            >
              {formatOrder.map((item, idx) => (
                <Draggable draggableId={String(item.id)} index={idx} key={item.id}>
                  {(draggableProvided, draggableSnapshot) => (
                    <div
                      ref={draggableProvided.innerRef}
                      {...draggableProvided.draggableProps}
                      style={{
                        display: 'flex',
                        alignItems: 'stretch',
                        flex: 1,
                        minWidth: 0,
                        opacity: draggableSnapshot.isDragging ? 0.5 : 1,
                        ...draggableProvided.draggableProps.style
                      }}
                    >
                      <span
                        {...draggableProvided.dragHandleProps}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: 0,
                          paddingLeft: 4,
                          paddingRight: 4,
                          background: '#fff',
                          borderTopLeftRadius: idx === 0 ? 4 : 0,
                          borderBottomLeftRadius: idx === 0 ? 4 : 0,
                          borderTopRightRadius: 0,
                          borderBottomRightRadius: 0,
                          border: '1px solid #ccc',
                          borderRight: 'none',
                          cursor: 'grab',
                          userSelect: 'none'
                        }}
                        tabIndex={0}
                        aria-label="Drag to reorder"
                      >
                        <GripVertical size={18} />
                      </span>
                      <select
                        className="taggerOptions"
                        id={`taggerOption${item.id}`}
                        value={item.value}
                        onChange={e => handleSelectChange(idx, e.target.value)}
                        disabled={formatOrder[idx].value === 'artist' && artistDisabled}
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
                          background: '#fff',
                          boxSizing: 'border-box',
                          cursor: formatOrder[idx].value === 'artist' && artistDisabled ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {selectOptions[idx].map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
      <div style={{ width: '100%' }}>
        <textarea
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
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
            : `Copy ${inputValue.length} chars to clipboard`}
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
      {/* DEBUG BOX */}
      <div
        style={{
          marginTop: '0rem',
          width: '100%',
          background: '#f6f6f6',
          border: '1px solid #ccc',
          borderRadius: 6,
          padding: '1rem',
          fontFamily: 'monospace',
          fontSize: '1em',
          color: '#333',
          wordBreak: 'break-all'
        }}
      >
        <strong>Debug Info:</strong>
        <div>
          <div>
            <span style={{ fontWeight: 600 }}>URL:</span>{' '}
            <span>{debugInfo.url}</span>
          </div>
          <div>
            <span style={{ fontWeight: 600 }}>Files:</span>{' '}
            <span>
              {debugInfo.files && debugInfo.files.length > 0
                ? debugInfo.files.join(', ')
                : <span style={{ color: '#888' }}>(none)</span>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}