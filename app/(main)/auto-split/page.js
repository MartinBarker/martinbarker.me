"use client";
import React, { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import WaveformData from "waveform-data";
import styles from "./auto-split.module.css";

// Audio waveform visualization component using waveform-data library
function AudioWaveform({ audioFile, silenceDetections, duration, isLoading, onWaveformReady }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const audioContextRef = useRef(null);
  const [waveformData, setWaveformData] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, scrollStart: 0 });
  const [waveform, setWaveform] = useState(null);

  // Generate waveform data using waveform-data library
  useEffect(() => {
    if (!audioFile) return;

    const generateWaveform = async () => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        
        const arrayBuffer = await audioFile.arrayBuffer();
        
        // Use waveform-data library to generate waveform
        const options = {
          audio_context: audioContext,
          array_buffer: arrayBuffer,
          scale: 128, // Lower scale for better performance
          amplitude_scale: 1
        };

        console.log('Starting waveform generation...');
        
        try {
          await new Promise((resolve, reject) => {
            WaveformData.createFromAudio(options, (err, waveformData) => {
              if (err) {
                console.error('Error creating waveform:', err);
                reject(err);
              } else {
                console.log('Waveform generated successfully:', waveformData);
                setWaveform(waveformData);
                // Notify parent that waveform is ready
                if (onWaveformReady) {
                  onWaveformReady();
                }
                resolve(waveformData);
              }
            });
          });
        } catch (waveformError) {
          console.warn('Waveform-data library failed, using fallback method:', waveformError);
          
          // Fallback: Use simple Web Audio API method
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const channelData = audioBuffer.getChannelData(0);
          
          // Create a simple waveform representation
          const samplesPerPixel = Math.max(1, Math.floor(channelData.length / 1000)); // 1000 pixels max
          const waveformLength = Math.floor(channelData.length / samplesPerPixel);
          const minArray = new Array(waveformLength);
          const maxArray = new Array(waveformLength);
          
          for (let i = 0; i < waveformLength; i++) {
            let min = 0;
            let max = 0;
            
            for (let j = 0; j < samplesPerPixel; j++) {
              const sampleIndex = i * samplesPerPixel + j;
              if (sampleIndex < channelData.length) {
                const sample = channelData[sampleIndex];
                min = Math.min(min, sample);
                max = Math.max(max, sample);
              }
            }
            
            // Convert to 8-bit range (0-255)
            minArray[i] = Math.round((min + 1) * 127.5);
            maxArray[i] = Math.round((max + 1) * 127.5);
          }
          
          // Create a mock waveform object
          const mockWaveform = {
            length: waveformLength,
            channel: () => ({
              min_array: () => minArray,
              max_array: () => maxArray
            })
          };
          
          console.log('Fallback waveform generated:', mockWaveform);
          setWaveform(mockWaveform);
          
          if (onWaveformReady) {
            onWaveformReady();
          }
        }
        
      } catch (error) {
        console.error('Error generating waveform:', error);
        if (onWaveformReady) {
          onWaveformReady();
        }
      }
    };

    generateWaveform();
    
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [audioFile]);

  // Draw waveform on canvas
  useEffect(() => {
    if (!waveform || !canvasRef.current || !containerRef.current) return;

    const drawWaveform = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      
      if (!canvas || !container) return;
      
      const containerWidth = container.offsetWidth;
      const canvasHeight = 150;
      
      // Calculate canvas width based on zoom - limit to reasonable size
      const waveformLength = waveform.length;
      const maxCanvasWidth = 2000; // Maximum canvas width for performance
      const canvasWidth = Math.min(maxCanvasWidth, Math.max(containerWidth, containerWidth * zoom));
      
      // Set canvas size
      canvas.width = canvasWidth * window.devicePixelRatio;
      canvas.height = canvasHeight * window.devicePixelRatio;
      
      const ctx = canvas.getContext('2d');
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      
      // Set canvas display size
      canvas.style.width = canvasWidth + 'px';
      canvas.style.height = canvasHeight + 'px';
      
      // Clear canvas
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      
      // Draw background with gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
      gradient.addColorStop(0, '#f8fafc');
      gradient.addColorStop(1, '#f1f5f9');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      
      // Add subtle border
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, canvasWidth, canvasHeight);
      
        // Draw center line with subtle styling
        ctx.strokeStyle = '#cbd5e0';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(0, canvasHeight / 2);
        ctx.lineTo(canvasWidth, canvasHeight / 2);
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash
      
      try {
        // Get waveform channel data
        const channel = waveform.channel(0);
        const minArray = channel.min_array();
        const maxArray = channel.max_array();
        
        console.log('Drawing waveform with length:', waveformLength);
        console.log('Canvas width:', canvasWidth);
        console.log('Container width:', containerWidth);
        console.log('Samples per pixel:', Math.max(1, Math.floor(waveformLength / canvasWidth)));
        console.log('Min array length:', minArray.length);
        console.log('Max array length:', maxArray.length);
        
        // Scale function for waveform data
        const scaleY = (amplitude) => {
          const range = 256;
          const offset = 128;
          return canvasHeight / 2 - ((amplitude + offset) * canvasHeight / 2) / range;
        };
        
        // Draw waveform using waveform-data with proper sampling
        // Sample the waveform data to fit the canvas width
        const samplesPerPixel = Math.max(1, Math.floor(waveformLength / canvasWidth));
        
        console.log('Final canvas width:', canvasWidth);
        console.log('Samples per pixel:', samplesPerPixel);
        
        // Draw waveform as bars with improved styling
        ctx.lineWidth = 1;
        
        // Draw positive waveform (above center line) with gradient
        const positiveGradient = ctx.createLinearGradient(0, canvasHeight / 2, 0, 0);
        positiveGradient.addColorStop(0, '#667eea');
        positiveGradient.addColorStop(1, '#764ba2');
        ctx.strokeStyle = positiveGradient;
        
        for (let x = 0; x < canvasWidth; x++) {
          const sampleIndex = Math.floor(x * samplesPerPixel);
          if (sampleIndex < waveformLength) {
            const maxVal = maxArray[sampleIndex];
            const maxY = scaleY(maxVal);
            const centerY = canvasHeight / 2;
            
            if (maxY < centerY) {
              ctx.beginPath();
              ctx.moveTo(x, centerY);
              ctx.lineTo(x, maxY);
              ctx.stroke();
            }
          }
        }
        
        // Draw negative waveform (below center line) with gradient
        const negativeGradient = ctx.createLinearGradient(0, canvasHeight / 2, 0, canvasHeight);
        negativeGradient.addColorStop(0, '#5a67d8');
        negativeGradient.addColorStop(1, '#4c51bf');
        ctx.strokeStyle = negativeGradient;
        
        for (let x = 0; x < canvasWidth; x++) {
          const sampleIndex = Math.floor(x * samplesPerPixel);
          if (sampleIndex < waveformLength) {
            const minVal = minArray[sampleIndex];
            const minY = scaleY(minVal);
            const centerY = canvasHeight / 2;
            
            if (minY > centerY) {
              ctx.beginPath();
              ctx.moveTo(x, centerY);
              ctx.lineTo(x, minY);
              ctx.stroke();
            }
          }
        }
        
      } catch (error) {
        console.error('Error drawing waveform data:', error);
        
        // Fallback: draw a simple placeholder
        ctx.fillStyle = '#cbd5e0';
        ctx.fillRect(0, canvasHeight / 2 - 10, canvasWidth, 20);
        
        ctx.fillStyle = '#4a5568';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Waveform data error', canvasWidth / 2, canvasHeight / 2 + 5);
      }
      
      // Draw silence regions
      if (silenceDetections && silenceDetections.length > 0 && duration > 0) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
        silenceDetections.forEach(detection => {
          const startX = (detection.start / duration) * canvasWidth;
          const endX = (detection.end / duration) * canvasWidth;
          ctx.fillRect(startX, 0, endX - startX, canvasHeight);
        });
      }
      
      // Draw time markers every 10 seconds
      if (duration > 0) {
        ctx.strokeStyle = '#cbd5e0';
        ctx.lineWidth = 1;
        ctx.font = '10px Arial';
        ctx.fillStyle = '#718096';
        
        const markerInterval = 10; // seconds
        for (let time = markerInterval; time < duration; time += markerInterval) {
          const x = (time / duration) * canvasWidth;
          ctx.beginPath();
          ctx.moveTo(x, canvasHeight / 2 - 5);
          ctx.lineTo(x, canvasHeight / 2 + 5);
          ctx.stroke();
          
          ctx.fillText(`${time}s`, x + 2, canvasHeight / 2 - 8);
        }
      }
      
      setWaveformData({ 
        width: canvasWidth, 
        height: canvasHeight,
        waveformLength
      });
    };

    drawWaveform();
  }, [waveform, silenceDetections, duration, zoom]);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      scrollStart: scrollPosition
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !waveformData) return;
    
    const deltaX = e.clientX - dragStart.x;
    const containerWidth = containerRef.current?.offsetWidth || 0;
    const maxScroll = Math.max(0, waveformData.width - containerWidth);
    
    const newScrollPosition = Math.max(0, Math.min(maxScroll, dragStart.scrollStart - deltaX));
    setScrollPosition(newScrollPosition);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, zoom * zoomFactor));
    setZoom(newZoom);
  };

  const resetZoom = () => {
    setZoom(1);
    setScrollPosition(0);
  };

  if (!audioFile) return null;

  return (
    <div className={styles.waveformContainer}>
      <div className={styles.waveformHeader}>
        <h4>Audio Waveform</h4>
        <div className={styles.waveformControls}>
          <button onClick={() => setZoom(Math.max(0.1, zoom - 0.1))} className={styles.zoomBtn}>
            Zoom Out
          </button>
          <span className={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(Math.min(10, zoom + 0.1))} className={styles.zoomBtn}>
            Zoom In
          </button>
          <button onClick={resetZoom} className={styles.resetBtn}>
            Reset
          </button>
        </div>
      </div>
      
      <div 
        ref={containerRef}
        className={styles.waveformWrapper}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        {isLoading ? (
          <div className={styles.waveformLoading}>
            <div className={styles.loadingSpinner}></div>
            <p>Generating waveform data...</p>
            <small>This may take a moment for large files</small>
          </div>
        ) : (
          <canvas 
            ref={canvasRef} 
            className={styles.waveformCanvas}
            style={{ 
              transform: `translateX(-${scrollPosition}px)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease'
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />
        )}
      </div>
      
      {waveformData && (
        <div className={styles.waveformInfo}>
          <span>Duration: {duration.toFixed(2)}s</span>
          <span>Zoom: {Math.round(zoom * 100)}%</span>
          {silenceDetections.length > 0 && (
            <span>Silence periods: {silenceDetections.length}</span>
          )}
        </div>
      )}
    </div>
  );
}

function AutoSplitTool() {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [audioFile, setAudioFile] = useState(null);
  const [silenceDetections, setSilenceDetections] = useState([]);
  const [message, setMessage] = useState("Drop an audio file to begin");
  const [progress, setProgress] = useState(null);
  const [duration, setDuration] = useState(0);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  
  // Silence detection parameters
  const [silenceThreshold, setSilenceThreshold] = useState(-30); // dB
  const [silenceDuration, setSilenceDuration] = useState(1.0); // seconds
  const [minSilenceDuration, setMinSilenceDuration] = useState(0.5); // seconds
  
  const ffmpegRef = useRef(null);
  const dropZoneRef = useRef(null);

  useEffect(() => {
    setMounted(true);
    ffmpegRef.current = new FFmpeg();
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const audioFiles = files.filter(file => file.type.startsWith('audio/'));
    
    if (audioFiles.length > 0) {
      setIsLoadingWaveform(true);
      setAudioFile(audioFiles[0]);
      setMessage(`Processing audio: ${audioFiles[0].name}`);
      setSilenceDetections([]);
      
      // Get audio duration
      const audio = new Audio();
      audio.onloadedmetadata = () => {
        setDuration(audio.duration);
        setMessage(`Loaded: ${audioFiles[0].name} (${audio.duration.toFixed(2)}s)`);
        // Keep loading state true until waveform is generated
      };
      audio.src = URL.createObjectURL(audioFiles[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleFileInput = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0 && files[0].type.startsWith('audio/')) {
      setIsLoadingWaveform(true);
      setAudioFile(files[0]);
      setMessage(`Processing audio: ${files[0].name}`);
      setSilenceDetections([]);
      
      // Get audio duration
      const audio = new Audio();
      audio.onloadedmetadata = () => {
        setDuration(audio.duration);
        setMessage(`Loaded: ${files[0].name} (${audio.duration.toFixed(2)}s)`);
        // Keep loading state true until waveform is generated
      };
      audio.src = URL.createObjectURL(files[0]);
    }
  };

  const loadFFmpeg = async () => {
    setMessage("Loading FFmpeg.wasm...");
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    const ffmpeg = ffmpegRef.current;
    
    ffmpeg.on("log", ({ message }) => {
      console.log(message);
    });
    
    ffmpeg.on("progress", ({ progress }) => {
      setProgress(progress);
      console.log(`Progress: ${(progress * 100).toFixed(1)}%`);
    });
    
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    
    setLoaded(true);
    setMessage("FFmpeg.wasm loaded successfully");
  };

  const detectSilence = async () => {
    if (!loaded) {
      setMessage("Please load FFmpeg.wasm first");
      return;
    }
    
    if (!audioFile) {
      setMessage("Please select an audio file first");
      return;
    }
    
    setMessage("Detecting silence...");
    setProgress(null);
    
    const ffmpeg = ffmpegRef.current;
    
    try {
      // Write audio file to FFmpeg filesystem
      await ffmpeg.writeFile("input.wav", await fetchFile(audioFile));
      
      // Run silence detection command
      // Using silencedetect filter with configurable parameters
      const command = [
        "-i", "input.wav",
        "-af", `silencedetect=noise=${silenceThreshold}dB:d=${silenceDuration}:duration=${minSilenceDuration}`,
        "-f", "null",
        "-"
      ];
      
      // Capture FFmpeg output to parse silence detection results
      let silenceOutput = "";
      const originalLog = ffmpeg.on;
      ffmpeg.on = (event, callback) => {
        if (event === "log") {
          originalLog.call(ffmpeg, event, ({ message }) => {
            if (message.includes("silence_start") || message.includes("silence_end")) {
              silenceOutput += message + "\n";
            }
            callback({ message });
          });
        } else {
          originalLog.call(ffmpeg, event, callback);
        }
      };
      
      await ffmpeg.exec(command);
      
      // Parse silence detection results
      const detections = parseSilenceOutput(silenceOutput);
      setSilenceDetections(detections);
      
      setMessage(`Found ${detections.length} silence periods`);
      setProgress(null);
      
    } catch (error) {
      console.error("Silence detection error:", error);
      setMessage("Error detecting silence: " + error.message);
    }
  };

  const parseSilenceOutput = (output) => {
    const detections = [];
    const lines = output.split('\n');
    
    let currentSilence = null;
    
    for (const line of lines) {
      if (line.includes('silence_start')) {
        const match = line.match(/silence_start: ([\d.]+)/);
        if (match) {
          currentSilence = { start: parseFloat(match[1]), end: null };
        }
      } else if (line.includes('silence_end') && currentSilence) {
        const match = line.match(/silence_end: ([\d.]+)/);
        if (match) {
          currentSilence.end = parseFloat(match[1]);
          detections.push(currentSilence);
          currentSilence = null;
        }
      }
    }
    
    return detections;
  };

  if (!mounted) return null;

  return (
    <section className={styles.autoSplitSection}>
      <h2>Audio Auto-Split Tool</h2>
      
      <div className={styles.infoSection}>
        <p>
          <strong>Auto-Split Tool</strong> uses FFmpeg.wasm to detect silence in audio files 
          and visualize the results on a waveform. Adjust the parameters below to customize 
          silence detection sensitivity.
        </p>
      </div>

      {/* File Drop Zone */}
      <div 
        ref={dropZoneRef}
        className={styles.dropZone}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className={styles.dropZoneContent}>
          <p>Drop an audio file here or click to browse</p>
          <input
            type="file"
            accept="audio/*"
            onChange={handleFileInput}
            className={styles.fileInput}
          />
        </div>
      </div>

      {/* File Info */}
      {audioFile && (
        <div className={styles.fileInfo}>
          <h4>Loaded File</h4>
          <p><strong>Name:</strong> {audioFile.name}</p>
          <p><strong>Size:</strong> {(audioFile.size / 1024 / 1024).toFixed(2)} MB</p>
          <p><strong>Type:</strong> {audioFile.type}</p>
          {duration > 0 && <p><strong>Duration:</strong> {duration.toFixed(2)} seconds</p>}
        </div>
      )}

      {/* Waveform Visualization */}
      {audioFile && (
        <AudioWaveform 
          audioFile={audioFile} 
          silenceDetections={silenceDetections}
          duration={duration}
          isLoading={isLoadingWaveform}
          onWaveformReady={() => setIsLoadingWaveform(false)}
        />
      )}

      {/* Silence Detection Parameters */}
      <div className={styles.parametersSection}>
        <h4>Silence Detection Parameters</h4>
        <div className={styles.parameterGrid}>
          <div className={styles.parameterGroup}>
            <label>Noise Threshold (dB)</label>
            <input
              type="number"
              value={silenceThreshold}
              onChange={(e) => setSilenceThreshold(parseFloat(e.target.value))}
              min="-60"
              max="0"
              step="1"
            />
            <small>Lower values = more sensitive to silence</small>
          </div>
          
          <div className={styles.parameterGroup}>
            <label>Silence Duration (s)</label>
            <input
              type="number"
              value={silenceDuration}
              onChange={(e) => setSilenceDuration(parseFloat(e.target.value))}
              min="0.1"
              max="10"
              step="0.1"
            />
            <small>Minimum duration to consider as silence</small>
          </div>
          
          <div className={styles.parameterGroup}>
            <label>Minimum Silence Duration (s)</label>
            <input
              type="number"
              value={minSilenceDuration}
              onChange={(e) => setMinSilenceDuration(parseFloat(e.target.value))}
              min="0.1"
              max="5"
              step="0.1"
            />
            <small>Minimum duration to report as detected silence</small>
          </div>
        </div>
      </div>

      {/* Silence Detection Results */}
      {silenceDetections.length > 0 && (
        <div className={styles.resultsSection}>
          <h4>Silence Detection Results</h4>
          <div className={styles.resultsTable}>
            <table>
              <thead>
                <tr>
                  <th>Start (s)</th>
                  <th>End (s)</th>
                  <th>Duration (s)</th>
                </tr>
              </thead>
              <tbody>
                {silenceDetections.map((detection, index) => (
                  <tr key={index}>
                    <td>{detection.start.toFixed(2)}</td>
                    <td>{detection.end.toFixed(2)}</td>
                    <td>{(detection.end - detection.start).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className={styles.actionSection}>
        {!loaded ? (
          <button onClick={loadFFmpeg} className={styles.loadBtn}>
            Load FFmpeg.wasm (~31 MB)
          </button>
        ) : (
          <button 
            onClick={detectSilence} 
            className={styles.detectBtn}
            disabled={!audioFile}
          >
            Detect Silence
          </button>
        )}
        
        <p className={styles.message}>{message}</p>
        
        {progress !== null && (
          <div className={styles.progressBar}>
            <div 
              className={styles.progressFill} 
              style={{ width: `${(progress * 100)}%` }}
            ></div>
            <span className={styles.progressText}>
              {(progress * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

export default function AutoSplitPage() {
  return (
    <main className={styles.autoSplitMain}>
      <AutoSplitTool />
    </main>
  );
}
