'use client';

import { useState, useRef, useEffect } from 'react';
import FileDrop from '../FileDrop/FileDrop';
import styles from './waveform-visualizer.module.css';

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
          if (prev >= 90) return prev; // Don't go to 100% until actually done
          return prev + Math.random() * 10;
        });
      }, 200);
      
      // Initialize Peaks.js
      await initPeaks(audioUrl);
      
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

  // Initialize Peaks.js based on official documentation
  const initPeaks = async (audioUrl) => {
    // Clean up existing peaks instance
    if (peaks) {
      peaks.destroy();
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

      console.log('DOM elements ready:', {
        zoomview: zoomviewContainerRef.current,
        overview: overviewContainerRef.current,
        audio: audioElementRef.current
      });

      // Set audio source
      audioElementRef.current.src = audioUrl;

      // Initialize Peaks.js with correct configuration structure
      const options = {
        zoomview: {
          container: zoomviewContainerRef.current
        },
        overview: {
          container: overviewContainerRef.current
        },
        mediaElement: audioElementRef.current,
        webAudio: {
          audioContext: new (window.AudioContext || window.webkitAudioContext)()
        }
      };

      Peaks.init(options, (err, peaksInstance) => {
        if (err) {
          console.error('Error initializing Peaks.js:', err);
          setError('Error initializing waveform. Please try a different file.');
          return;
        }

        setPeaks(peaksInstance);
        onPeaksReady(peaksInstance);
      });
    } catch (err) {
      console.error('Error loading Peaks.js:', err);
      setError('Error loading waveform library. Please refresh the page.');
    }
  };

  // Handle peaks ready
  const onPeaksReady = (peaksInstance) => {
    console.log('Peaks.js is ready');
    
    // Add event listeners
    peaksInstance.on('segments.add', (segment) => {
      console.log('Segment added:', segment);
      updateSegments();
    });

    peaksInstance.on('segments.remove', (segment) => {
      console.log('Segment removed:', segment);
      updateSegments();
    });

    peaksInstance.on('points.add', (point) => {
      console.log('Point added:', point);
      updatePoints();
    });

    peaksInstance.on('points.remove', (point) => {
      console.log('Point removed:', point);
      updatePoints();
    });
  };

  // Update segments list
  const updateSegments = () => {
    if (peaks) {
      const segmentsList = peaks.segments.getSegments();
      setSegments(segmentsList);
    }
  };

  // Update points list
  const updatePoints = () => {
    if (peaks) {
      const pointsList = peaks.points.getPoints();
      setPoints(pointsList);
    }
  };

  // Zoom controls
  const zoomIn = () => {
    if (peaks) {
      peaks.zoom.zoomIn();
    }
  };

  const zoomOut = () => {
    if (peaks) {
      peaks.zoom.zoomOut();
    }
  };

  // Add segment at current time
  const addSegment = () => {
    if (peaks) {
      const time = peaks.player.getCurrentTime();
      
      peaks.segments.add({
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
    if (peaks) {
      const time = peaks.player.getCurrentTime();
      
      peaks.points.add({
        time: time,
        labelText: `Point ${points.length + 1}`,
        editable: true,
        color: '#4ecdc4'
      });
    }
  };

  // Clear all markers
  const clearMarkers = () => {
    if (peaks) {
      peaks.segments.removeAll();
      peaks.points.removeAll();
    }
  };

  // Reset to load new file
  const resetVisualizer = () => {
    if (peaks) {
      peaks.destroy();
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
      if (peaks) {
        try {
          peaks.destroy();
        } catch (err) {
          console.warn('Error destroying peaks instance:', err);
        }
      }
    };
  }, [peaks]);

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