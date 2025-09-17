'use client'
import React, { useState, useRef, useEffect, useContext } from 'react';
import styles from './waveform-visualizer.module.css';
import { ColorContext } from '../ColorContext';
import FileDrop from '../FileDrop/FileDrop';
import { Play, Pause, Volume2, Download } from 'lucide-react';

export default function WaveformVisualizer() {
  const { colors } = useContext(ColorContext);
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [waveformData, setWaveformData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  // Handle file selection
  const handleFilesSelected = (files) => {
    const file = files[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
      setError(null);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      loadWaveformData(file);
    } else {
      setError('Please select a valid audio file (mp3, wav, etc.)');
    }
  };

  // Load waveform data using the waveform-data library
  const loadWaveformData = async (file) => {
    setIsLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Generate waveform data
      const channelData = audioBuffer.getChannelData(0);
      const samplesPerPixel = Math.floor(channelData.length / 1000); // 1000 pixels width
      const waveform = [];
      
      for (let i = 0; i < 1000; i++) {
        const start = i * samplesPerPixel;
        const end = Math.min(start + samplesPerPixel, channelData.length);
        let sum = 0;
        let max = 0;
        
        for (let j = start; j < end; j++) {
          const sample = Math.abs(channelData[j]);
          sum += sample;
          max = Math.max(max, sample);
        }
        
        waveform.push({
          min: -max,
          max: max,
          avg: sum / (end - start)
        });
      }
      
      setWaveformData(waveform);
      setDuration(audioBuffer.duration);
    } catch (err) {
      console.error('Error loading waveform data:', err);
      setError('Error loading audio file. Please try a different file.');
    } finally {
      setIsLoading(false);
    }
  };

  // Draw waveform on canvas
  const drawWaveform = () => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;
    
    // Clear canvas
    ctx.fillStyle = colors.LightMuted || '#f0f0f0';
    ctx.fillRect(0, 0, width, height);
    
    // Draw waveform
    ctx.strokeStyle = colors.DarkVibrant || '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    waveformData.forEach((point, index) => {
      const x = (index / waveformData.length) * width;
      const y1 = centerY + (point.min * centerY);
      const y2 = centerY + (point.max * centerY);
      
      if (index === 0) {
        ctx.moveTo(x, y1);
      } else {
        ctx.lineTo(x, y1);
      }
    });
    
    // Draw the bottom half
    for (let i = waveformData.length - 1; i >= 0; i--) {
      const x = (i / waveformData.length) * width;
      const y = centerY + (waveformData[i].max * centerY);
      ctx.lineTo(x, y);
    }
    
    ctx.closePath();
    ctx.fillStyle = colors.Vibrant || '#007bff';
    ctx.fill();
    ctx.stroke();
    
    // Draw progress indicator
    if (duration > 0) {
      const progress = currentTime / duration;
      const progressX = progress * width;
      
      ctx.fillStyle = colors.DarkMuted || '#666';
      ctx.fillRect(0, 0, progressX, height);
    }
  };

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioUrl]);

  // Draw waveform when data changes
  useEffect(() => {
    drawWaveform();
  }, [waveformData, currentTime, colors]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      drawWaveform();
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [waveformData, currentTime, colors]);

  // Control functions
  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * duration;
    
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Waveform Visualizer</h1>
        <p className={styles.subtitle}>Drop an audio file to visualize its waveform</p>
      </div>

      {!audioFile ? (
        <div className={styles.uploadSection}>
          <FileDrop onFilesSelected={handleFilesSelected} />
          {error && <div className={styles.error}>{error}</div>}
        </div>
      ) : (
        <div className={styles.playerSection}>
          {isLoading && (
            <div className={styles.loading}>
              <div className={styles.spinner}></div>
              <p>Loading waveform...</p>
            </div>
          )}

          {waveformData && (
            <div className={styles.waveformContainer}>
              <canvas
                ref={canvasRef}
                className={styles.waveformCanvas}
                width={800}
                height={200}
                onClick={handleSeek}
              />
            </div>
          )}

          <div className={styles.controls}>
            <button
              className={styles.playButton}
              onClick={togglePlayPause}
              disabled={!audioUrl}
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>

            <div className={styles.timeDisplay}>
              <span>{formatTime(currentTime)}</span>
              <span>/</span>
              <span>{formatTime(duration)}</span>
            </div>

            <div className={styles.volumeControl}>
              <Volume2 size={20} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                onChange={handleVolumeChange}
                className={styles.volumeSlider}
              />
            </div>
          </div>

          <div className={styles.fileInfo}>
            <h3>Current File: {audioFile.name}</h3>
            <p>Duration: {formatTime(duration)}</p>
            <p>Size: {(audioFile.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>

          <button
            className={styles.resetButton}
            onClick={() => {
              setAudioFile(null);
              setAudioUrl(null);
              setWaveformData(null);
              setCurrentTime(0);
              setDuration(0);
              setIsPlaying(false);
              setError(null);
            }}
          >
            Load Different File
          </button>
        </div>
      )}

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          style={{ display: 'none' }}
        />
      )}
    </div>
  );
}
