'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import FileDrop from '../FileDrop/FileDrop';
import styles from './waveform-visualizer.module.css';

// IndexedDB helpers for caching waveform data
const DB_NAME = 'waveform-cache';
const STORE_NAME = 'waveforms';
const DB_VERSION = 1;

function openWaveformDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedWaveform(key) {
  try {
    const db = await openWaveformDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function setCachedWaveform(key, data) {
  try {
    const db = await openWaveformDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Caching failure is non-fatal
  }
}

export default function WaveformVisualizer() {
  const [audioFile, setAudioFile] = useState(null);
  const [peaks, setPeaks] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingWaveform, setIsGeneratingWaveform] = useState(false);
  const [waveformProgress, setWaveformProgress] = useState(0);
  const [error, setError] = useState('');
  const [segments, setSegments] = useState([]);
  const [points, setPoints] = useState([]);
  const [isClient, setIsClient] = useState(false);

  const zoomviewContainerRef = useRef(null);
  const overviewContainerRef = useRef(null);
  const audioElementRef = useRef(null);
  const audioContextRef = useRef(null);
  const peaksRef = useRef(null);

  // Keep peaksRef in sync for use in non-stale callbacks
  useEffect(() => {
    peaksRef.current = peaks;
  }, [peaks]);

  // Ensure component only runs on client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Handle file selection
  const handleFilesSelected = (files) => {
    const file = files[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
      setError('');
      loadAudioFile(file);
    } else {
      setError('Please select a valid audio file.');
    }
  };

  // Generate a cache key from file metadata
  const getCacheKey = (file) => `waveform-${file.name}-${file.size}-${file.lastModified}`;

  // Load and process audio file
  const loadAudioFile = async (file) => {
    setIsLoading(true);
    setIsGeneratingWaveform(false);
    setWaveformProgress(0);
    setError('');

    try {
      // Create audio URL for peaks.js
      const audioUrl = URL.createObjectURL(file);

      // Wait for DOM elements to be ready
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });

      // Start waveform generation indicator
      setIsGeneratingWaveform(true);

      // Simulate progress for long files
      const progressInterval = setInterval(() => {
        setWaveformProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 10;
        });
      }, 200);

      // Initialize Peaks.js
      await initPeaks(audioUrl, file);

      // Clear progress interval and set to 100%
      clearInterval(progressInterval);
      setWaveformProgress(100);

      // Small delay to show 100% before hiding
      setTimeout(() => {
        setIsLoading(false);
        setIsGeneratingWaveform(false);
        setWaveformProgress(0);
      }, 500);

    } catch (err) {
      console.error('Error loading audio file:', err);
      setError('Error loading audio file. Please try a different file.');
      setIsLoading(false);
      setIsGeneratingWaveform(false);
      setWaveformProgress(0);
    }
  };

  // Initialize Peaks.js with performance optimizations
  const initPeaks = async (audioUrl, file) => {
    // Clean up existing peaks instance
    if (peaksRef.current) {
      peaksRef.current.destroy();
      setPeaks(null);
    }

    try {
      // Dynamically import Peaks.js only on client side
      const Peaks = (await import('peaks.js')).default;

      // Wait for DOM elements to be ready
      let retries = 0;
      const maxRetries = 20;

      while (retries < maxRetries) {
        if (zoomviewContainerRef.current &&
            overviewContainerRef.current &&
            audioElementRef.current) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }

      if (!zoomviewContainerRef.current || !overviewContainerRef.current || !audioElementRef.current) {
        throw new Error('DOM elements not ready after maximum retries');
      }

      // Set audio source
      audioElementRef.current.src = audioUrl;

      // Reuse AudioContext instead of creating a new one each time
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // Check for cached waveform data
      const cacheKey = getCacheKey(file);
      const cachedWaveform = await getCachedWaveform(cacheKey);

      // Zoomview formatter — full detail for zoomed-in view
      const formatZoomviewTime = (seconds) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
          return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };

      // Overview formatter — condensed labels to avoid clutter when showing full track
      const formatOverviewTime = (seconds) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
          // Show "1h", "1h30m", "2h" etc.
          return mins > 0 ? `${hrs}h${mins}m` : `${hrs}h`;
        }
        if (mins > 0 && secs === 0) {
          // Clean minute marks: "1m", "5m", "10m"
          return `${mins}m`;
        }
        if (mins > 0) {
          return `${mins}:${secs.toString().padStart(2, '0')}`;
        }
        // Under a minute: show seconds
        return `${secs}s`;
      };

      // Build options with explicit zoom levels for faster zoom transitions
      const options = {
        zoomview: {
          container: zoomviewContainerRef.current,
          formatAxisTime: formatZoomviewTime,
        },
        overview: {
          container: overviewContainerRef.current,
          formatAxisTime: formatOverviewTime,
          axisLabelColor: '#aaa',
        },
        mediaElement: audioElementRef.current,
        zoomLevels: [256, 512, 1024, 2048, 4096, 8192, 16384],
      };

      if (cachedWaveform) {
        // Use cached waveform data — skips expensive Web Audio decoding
        console.log('Using cached waveform data');
        options.dataUri = { arraybuffer: cachedWaveform };
      } else {
        // Compute from audio via Web Audio API (first load)
        options.webAudio = {
          audioContext: audioContextRef.current
        };
      }

      return new Promise((resolve, reject) => {
        Peaks.init(options, async (err, peaksInstance) => {
          if (err) {
            console.error('Error initializing Peaks.js:', err);
            // If cached data failed, retry without cache
            if (cachedWaveform) {
              console.log('Cached waveform failed, retrying with webAudio');
              options.webAudio = { audioContext: audioContextRef.current };
              delete options.dataUri;
              Peaks.init(options, (retryErr, retryInstance) => {
                if (retryErr) {
                  setError('Error initializing waveform. Please try a different file.');
                  reject(retryErr);
                  return;
                }
                setPeaks(retryInstance);
                onPeaksReady(retryInstance, file);
                resolve();
              });
              return;
            }
            setError('Error initializing waveform. Please try a different file.');
            reject(err);
            return;
          }

          setPeaks(peaksInstance);
          onPeaksReady(peaksInstance, file);

          // Cache the waveform data for future loads (only if we computed it fresh)
          if (!cachedWaveform) {
            try {
              const waveformData = peaksInstance.getWaveformData();
              if (waveformData) {
                const arrayBuffer = waveformData.toArrayBuffer();
                await setCachedWaveform(cacheKey, arrayBuffer);
                console.log('Waveform data cached for future loads');
              }
            } catch (cacheErr) {
              console.warn('Could not cache waveform data:', cacheErr);
            }
          }

          resolve();
        });
      });
    } catch (err) {
      console.error('Error loading Peaks.js:', err);
      setError('Error loading waveform library. Please refresh the page.');
    }
  };

  // Debounced state updaters to avoid excessive React re-renders during drag
  const segmentUpdateTimer = useRef(null);
  const pointUpdateTimer = useRef(null);

  const debouncedUpdateSegments = useCallback((peaksInstance) => {
    if (segmentUpdateTimer.current) clearTimeout(segmentUpdateTimer.current);
    segmentUpdateTimer.current = setTimeout(() => {
      const segmentsList = peaksInstance.segments.getSegments();
      setSegments([...segmentsList]);
    }, 100);
  }, []);

  const debouncedUpdatePoints = useCallback((peaksInstance) => {
    if (pointUpdateTimer.current) clearTimeout(pointUpdateTimer.current);
    pointUpdateTimer.current = setTimeout(() => {
      const pointsList = peaksInstance.points.getPoints();
      setPoints([...pointsList]);
    }, 100);
  }, []);

  // Handle peaks ready — use dragend instead of continuous updates during drag
  const onPeaksReady = (peaksInstance, file) => {
    console.log('Peaks.js is ready');

    // Update segments/points on add/remove (immediate, these are discrete actions)
    peaksInstance.on('segments.add', () => {
      debouncedUpdateSegments(peaksInstance);
    });

    peaksInstance.on('segments.remove', () => {
      debouncedUpdateSegments(peaksInstance);
    });

    peaksInstance.on('points.add', () => {
      debouncedUpdatePoints(peaksInstance);
    });

    peaksInstance.on('points.remove', () => {
      debouncedUpdatePoints(peaksInstance);
    });

    // Only update React state when drag ends, not during drag
    peaksInstance.on('segments.dragend', () => {
      debouncedUpdateSegments(peaksInstance);
    });

    peaksInstance.on('points.dragend', () => {
      debouncedUpdatePoints(peaksInstance);
    });
  };

  // Zoom controls
  const zoomIn = () => {
    if (peaksRef.current) {
      peaksRef.current.zoom.zoomIn();
    }
  };

  const zoomOut = () => {
    if (peaksRef.current) {
      peaksRef.current.zoom.zoomOut();
    }
  };

  // Add segment at current time
  const addSegment = () => {
    if (peaksRef.current) {
      const time = peaksRef.current.player.getCurrentTime();

      peaksRef.current.segments.add({
        startTime: time,
        endTime: time + 10,
        labelText: `Segment ${segments.length + 1}`,
        editable: true,
        color: '#ff6b6b'
      });
    }
  };

  // Add point at current time
  const addPoint = () => {
    if (peaksRef.current) {
      const time = peaksRef.current.player.getCurrentTime();

      peaksRef.current.points.add({
        time: time,
        labelText: `Point ${points.length + 1}`,
        editable: true,
        color: '#4ecdc4'
      });
    }
  };

  // Clear all markers
  const clearMarkers = () => {
    if (peaksRef.current) {
      peaksRef.current.segments.removeAll();
      peaksRef.current.points.removeAll();
      setSegments([]);
      setPoints([]);
    }
  };

  // Reset to load new file
  const resetVisualizer = () => {
    if (peaksRef.current) {
      peaksRef.current.destroy();
      setPeaks(null);
    }
    setAudioFile(null);
    setSegments([]);
    setPoints([]);
    setError('');
    setIsGeneratingWaveform(false);
    setWaveformProgress(0);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (peaksRef.current) {
        try {
          peaksRef.current.destroy();
        } catch (err) {
          console.warn('Error destroying peaks instance:', err);
        }
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      if (segmentUpdateTimer.current) clearTimeout(segmentUpdateTimer.current);
      if (pointUpdateTimer.current) clearTimeout(pointUpdateTimer.current);
    };
  }, []);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Show loading while component initializes on client
  if (!isClient) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>Loading waveform visualizer...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Peaks.js Waveform Visualizer</h1>
        <p>Professional waveform visualization with zoom, segments, and points</p>
      </div>

      {!audioFile && (
        <FileDrop
          onFilesSelected={handleFilesSelected}
          accept="audio/*"
          maxFiles={1}
        />
      )}

      {isLoading && (
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>Loading audio file...</p>
        </div>
      )}

      {isGeneratingWaveform && (
        <div className={styles.waveformLoading}>
          <div className={styles.waveformSpinner}></div>
          <p>Generating waveform data...</p>
          <div className={styles.progressContainer}>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${waveformProgress}%` }}
              ></div>
            </div>
            <div className={styles.progressText}>
              {Math.round(waveformProgress)}%
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <p>{error}</p>
        </div>
      )}

      {audioFile && (
        <>
          <div className={styles.audioInfo}>
            <p><strong>File:</strong> {audioFile.name}</p>
            <p><strong>Segments:</strong> {segments.length}</p>
            <p><strong>Points:</strong> {points.length}</p>
          </div>

          <div className={styles.waveformContainer}>
            {/* Zoom View Container */}
            <div
              className={styles.zoomviewContainer}
              ref={zoomviewContainerRef}
            >
              {isGeneratingWaveform && (
                <div className={styles.containerLoading}>
                  <div className={styles.containerSpinner}></div>
                  <p>Rendering waveform...</p>
                </div>
              )}
            </div>

            {/* Overview Container */}
            <div
              className={styles.overviewContainer}
              ref={overviewContainerRef}
            >
              {isGeneratingWaveform && (
                <div className={styles.containerLoading}>
                  <div className={styles.containerSpinner}></div>
                  <p>Rendering overview...</p>
                </div>
              )}
            </div>

            {/* Audio Element */}
            <audio
              ref={audioElementRef}
              controls
              className={styles.audioElement}
            >
              Your browser does not support the audio element.
            </audio>
          </div>

          <div className={styles.controls}>
            <button onClick={zoomIn} className={styles.controlButton}>
              Zoom In
            </button>
            <button onClick={zoomOut} className={styles.controlButton}>
              Zoom Out
            </button>
            <button onClick={addSegment} className={styles.controlButton}>
              Add Segment
            </button>
            <button onClick={addPoint} className={styles.controlButton}>
              Add Point
            </button>
            <button onClick={clearMarkers} className={styles.controlButton}>
              Clear All
            </button>
            <button onClick={resetVisualizer} className={styles.resetButton}>
              Load New File
            </button>
          </div>

          {/* Segments Table */}
          {segments.length > 0 && (
            <div className={styles.markersSection}>
              <h3>Segments</h3>
              <div className={styles.tableContainer}>
                <table className={styles.markersTable}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Start Time</th>
                      <th>End Time</th>
                      <th>Duration</th>
                      <th>Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map((segment) => (
                      <tr key={segment.id}>
                        <td>{segment.id}</td>
                        <td>{formatTime(segment.startTime)}</td>
                        <td>{formatTime(segment.endTime)}</td>
                        <td>{formatTime(segment.endTime - segment.startTime)}</td>
                        <td>{segment.labelText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Points Table */}
          {points.length > 0 && (
            <div className={styles.markersSection}>
              <h3>Points</h3>
              <div className={styles.tableContainer}>
                <table className={styles.markersTable}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Time</th>
                      <th>Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.id}>
                        <td>{point.id}</td>
                        <td>{formatTime(point.time)}</td>
                        <td>{point.labelText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
