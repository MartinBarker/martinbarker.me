"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import JSZip from "jszip";
import styles from "./auto-splitter.module.css";

// Format seconds as m:ss.ms
function formatTime(seconds) {
  if (seconds === null || seconds === undefined || seconds < 0) return "0:00.00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

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

// Track colors for segments
const TRACK_COLORS = [
  'rgba(102, 126, 234, 0.4)',
  'rgba(118, 75, 162, 0.4)',
  'rgba(56, 161, 105, 0.4)',
  'rgba(237, 137, 54, 0.4)',
  'rgba(229, 62, 62, 0.4)',
  'rgba(49, 151, 149, 0.4)',
  'rgba(128, 90, 213, 0.4)',
  'rgba(214, 69, 65, 0.4)',
];

function AutoSplitterTool() {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("Drop an audio file to begin");
  const [progress, setProgress] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [duration, setDuration] = useState(0);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [numberOfTracks, setNumberOfTracks] = useState(2);
  const [tracks, setTracks] = useState([]); // Array of {id, startTime, endTime, label}
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [outputFormat, setOutputFormat] = useState("mp3");
  const [mp3Bitrate, setMp3Bitrate] = useState("128");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const [exportedTracks, setExportedTracks] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [peaksReady, setPeaksReady] = useState(false);

  const ffmpegRef = useRef(null);
  const logOutputRef = useRef("");
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const playbackTimerRef = useRef(null);
  const cancelRef = useRef(false);
  const peaksInstanceRef = useRef(null);
  const audioContextRef = useRef(null);
  const zoomviewRef = useRef(null);
  const overviewRef = useRef(null);
  const tracksRef = useRef(tracks);
  const exportedTracksRef = useRef(exportedTracks);

  tracksRef.current = tracks;
  exportedTracksRef.current = exportedTracks;

  useEffect(() => {
    setMounted(true);
    ffmpegRef.current = new FFmpeg();
  }, []);

  // Initialize peaks.js when audio file changes
  useEffect(() => {
    if (!audioFile) return;
    setIsLoadingWaveform(true);
    setTracks([]);
    setCurrentTime(0);
    setIsPlaying(false);
    setPeaksReady(false);
    exportedTracks.forEach((t) => URL.revokeObjectURL(t.url));
    setExportedTracks([]);

    const initAudio = async () => {
      try {
        // Create audio URL
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
        const url = URL.createObjectURL(audioFile);
        audioUrlRef.current = url;

        // Wait for DOM
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        if (!audioRef.current || !zoomviewRef.current || !overviewRef.current) {
          setMessage("Error: DOM elements not ready");
          setIsLoadingWaveform(false);
          return;
        }

        audioRef.current.src = url;
        audioRef.current.load();

        // Wait for metadata to get duration
        await new Promise((resolve, reject) => {
          const onLoaded = () => {
            audioRef.current.removeEventListener('loadedmetadata', onLoaded);
            audioRef.current.removeEventListener('error', onError);
            resolve();
          };
          const onError = () => {
            audioRef.current.removeEventListener('loadedmetadata', onLoaded);
            audioRef.current.removeEventListener('error', onError);
            reject(new Error('Failed to load audio'));
          };
          audioRef.current.addEventListener('loadedmetadata', onLoaded);
          audioRef.current.addEventListener('error', onError);
        });

        const dur = audioRef.current.duration;
        setDuration(dur);

        // Initialize peaks.js
        await initPeaks(url, audioFile, dur);

        setMessage(`Loaded: ${audioFile.name} (${formatTime(dur)})`);
      } catch (error) {
        console.error("Error loading audio:", error);
        setMessage("Error loading audio file");
      } finally {
        setIsLoadingWaveform(false);
      }
    };

    initAudio();

    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, [audioFile]);

  // Initialize Peaks.js
  const initPeaks = async (audioUrl, file, dur) => {
    // Destroy existing instance
    if (peaksInstanceRef.current) {
      peaksInstanceRef.current.destroy();
      peaksInstanceRef.current = null;
    }

    const Peaks = (await import('peaks.js')).default;

    // Wait for containers
    let retries = 0;
    while (retries < 20) {
      if (zoomviewRef.current && overviewRef.current && audioRef.current) break;
      await new Promise(resolve => setTimeout(resolve, 100));
      retries++;
    }

    if (!zoomviewRef.current || !overviewRef.current || !audioRef.current) {
      throw new Error('DOM elements not ready');
    }

    // Reuse AudioContext
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    } else if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    // Check cache
    const cacheKey = `waveform-${file.name}-${file.size}-${file.lastModified}`;
    const cachedWaveform = await getCachedWaveform(cacheKey);

    // Adaptive time formatter for zoomview
    const formatZoomviewTime = (seconds) => {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Condensed labels for overview
    const formatOverviewTime = (seconds) => {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      if (hrs > 0) return mins > 0 ? `${hrs}h${mins}m` : `${hrs}h`;
      if (mins > 0 && secs === 0) return `${mins}m`;
      if (mins > 0) return `${mins}:${secs.toString().padStart(2, '0')}`;
      return `${secs}s`;
    };

    const options = {
      zoomview: {
        container: zoomviewRef.current,
        formatAxisTime: formatZoomviewTime,
        waveformColor: '#667eea',
      },
      overview: {
        container: overviewRef.current,
        formatAxisTime: formatOverviewTime,
        axisLabelColor: '#aaa',
        waveformColor: '#764ba2',
      },
      mediaElement: audioRef.current,
      zoomLevels: [256, 512, 1024, 2048, 4096, 8192, 16384],
    };

    if (cachedWaveform) {
      options.dataUri = { arraybuffer: cachedWaveform };
    } else {
      options.webAudio = { audioContext: audioContextRef.current };
    }

    return new Promise((resolve, reject) => {
      const tryInit = (opts) => {
        Peaks.init(opts, async (err, peaksInstance) => {
          if (err) {
            // Retry without cache if cached data failed
            if (cachedWaveform && !opts.webAudio) {
              console.log('Cached waveform failed, retrying with webAudio');
              const retryOpts = { ...opts, webAudio: { audioContext: audioContextRef.current } };
              delete retryOpts.dataUri;
              tryInit(retryOpts);
              return;
            }
            console.error('Error initializing Peaks.js:', err);
            setMessage('Error initializing waveform');
            reject(err);
            return;
          }

          peaksInstanceRef.current = peaksInstance;
          setPeaksReady(true);

          // Listen for segment drag events (debounced)
          let dragTimer = null;
          peaksInstance.on('segments.dragend', (event) => {
            if (dragTimer) clearTimeout(dragTimer);
            dragTimer = setTimeout(() => {
              syncTracksFromPeaks();
            }, 50);
          });

          // Cache waveform if computed fresh
          if (!cachedWaveform) {
            try {
              const waveformData = peaksInstance.getWaveformData();
              if (waveformData) {
                const arrayBuffer = waveformData.toArrayBuffer();
                await setCachedWaveform(cacheKey, arrayBuffer);
              }
            } catch (e) {
              console.warn('Could not cache waveform:', e);
            }
          }

          resolve();
        });
      };

      tryInit(options);
    });
  };

  // Sync tracks state from peaks.js segments
  const syncTracksFromPeaks = useCallback(() => {
    if (!peaksInstanceRef.current) return;
    const segments = peaksInstanceRef.current.segments.getSegments();
    const updatedTracks = segments
      .filter(s => s.id.startsWith('track-'))
      .sort((a, b) => a.startTime - b.startTime)
      .map((s, i) => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        label: `Track ${i + 1}`,
      }));
    setTracks(updatedTracks);
    invalidateExports();
  }, []);

  // Update peaks.js segments when tracks change programmatically
  const updatePeaksSegments = useCallback((newTracks) => {
    if (!peaksInstanceRef.current) return;
    peaksInstanceRef.current.segments.removeAll();
    newTracks.forEach((track, i) => {
      peaksInstanceRef.current.segments.add({
        id: track.id,
        startTime: track.startTime,
        endTime: track.endTime,
        labelText: track.label,
        editable: true,
        color: TRACK_COLORS[i % TRACK_COLORS.length],
      });
    });
  }, []);

  // Playback timer
  useEffect(() => {
    if (isPlaying) {
      playbackTimerRef.current = setInterval(() => {
        if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      }, 50);
    }
    return () => clearInterval(playbackTimerRef.current);
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const invalidateExports = () => {
    if (exportedTracksRef.current.length > 0) {
      exportedTracksRef.current.forEach((t) => URL.revokeObjectURL(t.url));
      setExportedTracks([]);
    }
  };

  // ===== ZOOM =====
  const zoomIn = () => {
    if (peaksInstanceRef.current) peaksInstanceRef.current.zoom.zoomIn();
  };
  const zoomOut = () => {
    if (peaksInstanceRef.current) peaksInstanceRef.current.zoom.zoomOut();
  };

  // ===== PLAYBACK =====
  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else { audioRef.current.play(); setIsPlaying(true); }
  };

  // ===== FFMPEG =====
  const loadFFmpeg = async () => {
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on("log", ({ message }) => { logOutputRef.current += message + "\n"; });
    ffmpeg.on("progress", ({ progress: p }) => { setProgress(p); });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    setLoaded(true);
  };

  const parseSilenceOutput = (output) => {
    const regions = [];
    const lines = output.split("\n");
    let currentStart = null;
    for (const line of lines) {
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      if (startMatch) currentStart = parseFloat(startMatch[1]);
      if (endMatch && currentStart !== null) {
        const end = parseFloat(endMatch[1]);
        regions.push({ start: currentStart, end, midpoint: (currentStart + end) / 2, silenceDuration: end - currentStart });
        currentStart = null;
      }
    }
    return regions;
  };

  const selectBestSplitPoints = (silenceRegions, numTracks, totalDuration) => {
    const numSplits = numTracks - 1;
    if (numSplits <= 0) return [];
    const idealPositions = Array.from({ length: numSplits }, (_, i) => (totalDuration * (i + 1)) / numTracks);
    if (silenceRegions.length === 0) return idealPositions;
    const candidates = silenceRegions.map((r) => r.midpoint).sort((a, b) => a - b);
    const selected = [];
    const usedIndices = new Set();
    const searchRadius = (totalDuration / numTracks) * 0.4;
    for (const ideal of idealPositions) {
      let bestIdx = -1, bestDist = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        if (usedIndices.has(i)) continue;
        const dist = Math.abs(candidates[i] - ideal);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestIdx !== -1 && bestDist < searchRadius) {
        selected.push(candidates[bestIdx]);
        usedIndices.add(bestIdx);
      } else {
        selected.push(ideal);
      }
    }
    return selected.sort((a, b) => a - b);
  };

  const findSplitPoints = async () => {
    if (!audioFile) { setMessage("Please select an audio file first"); return; }
    const numTracks = parseInt(numberOfTracks);
    if (!numTracks || numTracks < 2) { setMessage("Number of tracks must be at least 2"); return; }

    setIsAnalyzing(true);
    setProgress(null);
    cancelRef.current = false;
    invalidateExports();

    try {
      if (!loaded) { setMessage("Loading FFmpeg.wasm (~31 MB)..."); await loadFFmpeg(); }
      if (cancelRef.current) return;
      setMessage("Analyzing audio for optimal split points...");
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile("input", await fetchFile(audioFile));

      let silenceRegions = [];
      const thresholds = [-35, -30, -25, -20, -15];
      const minDurations = [0.5, 0.3, 0.2, 0.1];

      outer: for (const threshold of thresholds) {
        for (const minDur of minDurations) {
          if (cancelRef.current) break outer;
          logOutputRef.current = "";
          await ffmpeg.exec(["-i", "input", "-af", `silencedetect=noise=${threshold}dB:d=${minDur}`, "-f", "null", "-"]);
          if (cancelRef.current) break outer;
          silenceRegions = parseSilenceOutput(logOutputRef.current);
          if (silenceRegions.length >= numTracks - 1) break outer;
        }
      }

      if (cancelRef.current) { setMessage("Analysis cancelled"); return; }

      const splitPoints = selectBestSplitPoints(silenceRegions, numTracks, duration);

      // Create tracks from split points — each track is a segment with start/end
      const allBoundaries = [0, ...splitPoints, duration];
      const newTracks = [];
      for (let i = 0; i < allBoundaries.length - 1; i++) {
        newTracks.push({
          id: `track-${i}`,
          startTime: allBoundaries[i],
          endTime: allBoundaries[i + 1],
          label: `Track ${i + 1}`,
        });
      }

      setTracks(newTracks);
      updatePeaksSegments(newTracks);

      const method = silenceRegions.length >= numTracks - 1 ? "silence-based" : "equal division";
      setMessage(`Created ${newTracks.length} tracks (${method}). Drag segment edges to adjust.`);
    } catch (error) {
      if (!cancelRef.current) {
        console.error("Error:", error);
        setMessage("Error: " + error.message);
      }
    } finally {
      setIsAnalyzing(false);
      setProgress(null);
    }
  };

  const cancelAnalysis = () => {
    cancelRef.current = true;
    try { ffmpegRef.current.terminate(); } catch {}
    ffmpegRef.current = new FFmpeg();
    setLoaded(false);
    setIsAnalyzing(false);
    setProgress(null);
    setMessage("Analysis cancelled");
  };

  // ===== TRACK MANAGEMENT =====
  const addTrackAtPlayhead = () => {
    if (!duration || !peaksReady) return;
    const t = currentTime;
    if (t <= 0.05 || t >= duration - 0.05) return;

    // Find which track the playhead is in and split it
    const currentTracks = [...tracksRef.current];
    let splitIdx = -1;
    for (let i = 0; i < currentTracks.length; i++) {
      if (t > currentTracks[i].startTime + 0.1 && t < currentTracks[i].endTime - 0.1) {
        splitIdx = i;
        break;
      }
    }

    if (splitIdx >= 0) {
      // Split existing track into two
      const track = currentTracks[splitIdx];
      const newTracks = [...currentTracks];
      newTracks.splice(splitIdx, 1,
        { id: `track-${Date.now()}-a`, startTime: track.startTime, endTime: t, label: '' },
        { id: `track-${Date.now()}-b`, startTime: t, endTime: track.endTime, label: '' },
      );
      // Re-label
      newTracks.forEach((tr, i) => { tr.label = `Track ${i + 1}`; });
      setTracks(newTracks);
      updatePeaksSegments(newTracks);
      invalidateExports();
    } else if (currentTracks.length === 0) {
      // No tracks yet — create two tracks split at playhead
      const newTracks = [
        { id: `track-${Date.now()}-a`, startTime: 0, endTime: t, label: 'Track 1' },
        { id: `track-${Date.now()}-b`, startTime: t, endTime: duration, label: 'Track 2' },
      ];
      setTracks(newTracks);
      updatePeaksSegments(newTracks);
      invalidateExports();
    }
  };

  const removeTrack = (idx) => {
    const newTracks = tracks.filter((_, i) => i !== idx);
    newTracks.forEach((tr, i) => { tr.label = `Track ${i + 1}`; });
    setTracks(newTracks);
    updatePeaksSegments(newTracks);
    invalidateExports();
  };

  const clearTracks = () => {
    setTracks([]);
    if (peaksInstanceRef.current) peaksInstanceRef.current.segments.removeAll();
    invalidateExports();
  };

  // Remove gaps: snap each track's start to the previous track's end
  const removeGaps = () => {
    if (tracks.length < 2) return;
    const sorted = [...tracks].sort((a, b) => a.startTime - b.startTime);
    const newTracks = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const prev = newTracks[i - 1];
      const trackDuration = sorted[i].endTime - sorted[i].startTime;
      newTracks.push({
        ...sorted[i],
        startTime: prev.endTime,
        endTime: prev.endTime + trackDuration,
      });
    }
    newTracks.forEach((tr, i) => { tr.label = `Track ${i + 1}`; });
    setTracks(newTracks);
    updatePeaksSegments(newTracks);
    invalidateExports();
    setMessage("Gaps removed — tracks are now contiguous");
  };

  // Check if there are gaps between tracks
  const hasGaps = () => {
    if (tracks.length < 2) return false;
    const sorted = [...tracks].sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startTime - sorted[i - 1].endTime > 0.01) return true;
    }
    return false;
  };

  // ===== EXPORT =====
  const getTrackName = (trackNumber) => {
    const baseName = audioFile?.name?.replace(/\.[^/.]+$/, "") || "audio";
    return `${baseName}_track${trackNumber}.${outputFormat}`;
  };

  const exportAllTracks = async () => {
    if (!audioFile || tracks.length === 0) return;

    setIsExporting(true);
    cancelRef.current = false;
    exportedTracks.forEach((t) => URL.revokeObjectURL(t.url));
    setExportedTracks([]);

    try {
      if (!loaded) { setMessage("Loading FFmpeg.wasm (~31 MB)..."); await loadFFmpeg(); }
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile("input", await fetchFile(audioFile));

      const sortedTracks = [...tracks].sort((a, b) => a.startTime - b.startTime);
      const totalTracks = sortedTracks.length;
      const exported = [];
      const mimeType = outputFormat === "flac" ? "audio/flac" : "audio/mpeg";
      const codecArgs = outputFormat === "flac" ? ["-c:a", "flac"] : ["-c:a", "libmp3lame", "-b:a", `${mp3Bitrate}k`];

      for (let i = 0; i < totalTracks; i++) {
        if (cancelRef.current) break;
        const track = sortedTracks[i];
        const trackNum = i + 1;
        const trackName = getTrackName(trackNum);
        const outputName = `track_${trackNum}.${outputFormat}`;
        setExportProgress({ current: trackNum, total: totalTracks, trackName });
        setMessage(`Exporting track ${trackNum}/${totalTracks}...`);

        // Export each track's actual time range — gaps are automatically skipped
        await ffmpeg.exec(["-i", "input", "-ss", track.startTime.toFixed(4), "-to", track.endTime.toFixed(4), ...codecArgs, "-y", outputName]);
        const data = await ffmpeg.readFile(outputName);
        const blob = new Blob([data.buffer], { type: mimeType });
        exported.push({ trackNumber: trackNum, name: trackName, url: URL.createObjectURL(blob), size: blob.size });
        try { await ffmpeg.deleteFile(outputName); } catch {}
      }
      setExportedTracks(exported);
      if (!cancelRef.current) setMessage(`Exported ${exported.length} tracks as ${outputFormat === "flac" ? "FLAC" : `${mp3Bitrate}kbps MP3`}`);
    } catch (error) {
      if (!cancelRef.current) { console.error("Export error:", error); setMessage("Export error: " + error.message); }
    } finally {
      setIsExporting(false);
      setExportProgress(null);
      setProgress(null);
    }
  };

  const cancelExport = () => {
    cancelRef.current = true;
    try { ffmpegRef.current.terminate(); } catch {}
    ffmpegRef.current = new FFmpeg();
    setLoaded(false);
    setIsExporting(false);
    setExportProgress(null);
    setProgress(null);
    setMessage("Export cancelled");
  };

  const downloadTrack = (track) => {
    const link = document.createElement("a");
    link.href = track.url;
    link.download = track.name;
    link.click();
  };

  const downloadAllTracks = () => {
    exportedTracks.forEach((track, i) => setTimeout(() => downloadTrack(track), i * 300));
  };

  const downloadAsZip = async () => {
    if (exportedTracks.length === 0) return;
    setMessage("Creating ZIP...");
    try {
      const zip = new JSZip();
      for (const track of exportedTracks) {
        const response = await fetch(track.url);
        const blob = await response.blob();
        zip.file(track.name, blob);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.download = `${(audioFile?.name?.replace(/\.[^/.]+$/, "") || "audio")}_tracks.zip`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("ZIP downloaded");
    } catch (error) {
      console.error("ZIP error:", error);
      setMessage("ZIP error: " + error.message);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const audio = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("audio/"));
    if (audio) setAudioFile(audio);
  };

  const handleFileInput = (e) => {
    if (e.target.files.length > 0) setAudioFile(e.target.files[0]);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (peaksInstanceRef.current) {
        try { peaksInstanceRef.current.destroy(); } catch {}
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  if (!mounted) return null;

  const sortedTracks = [...tracks].sort((a, b) => a.startTime - b.startTime);

  return (
    <section className={styles.section}>
      <p className={styles.desc}>
        Analyze audio to find optimal split points. Drag track segment edges to adjust start/end independently. Gaps between tracks are removed on export.
      </p>

      {/* Drop zone */}
      <div className={styles.dropZone} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
        <span>Drop audio file or click to browse</span>
        <input type="file" accept="audio/*" onChange={handleFileInput} className={styles.fileInput} />
      </div>

      {/* File info */}
      {audioFile && (
        <div className={styles.fileRow}>
          <span><b>{audioFile.name}</b></span>
          <span>{(audioFile.size / 1024 / 1024).toFixed(2)} MB</span>
          <span>{audioFile.type}</span>
          {duration > 0 && <span>{formatTime(duration)}</span>}
        </div>
      )}

      {/* Waveform */}
      {audioFile && (
        <div className={styles.waveBlock}>
          <div className={styles.waveToolbar}>
            <div className={styles.zoomControls}>
              <button onClick={zoomOut} className={styles.tbBtn} title="Zoom Out">−</button>
              <button onClick={zoomIn} className={styles.tbBtn} title="Zoom In">+</button>
            </div>
            <div className={styles.splitControls}>
              <button onClick={addTrackAtPlayhead} className={styles.tbBtn} title="Split track at playhead" disabled={!peaksReady}>
                + Split at Playhead
              </button>
              {tracks.length > 0 && hasGaps() && (
                <button onClick={removeGaps} className={styles.tbBtn} title="Remove gaps between tracks">
                  Remove Gaps
                </button>
              )}
              {tracks.length > 0 && (
                <button onClick={clearTracks} className={styles.tbBtnDanger}>Clear Tracks</button>
              )}
            </div>
          </div>

          <div className={styles.waveWrap}>
            {isLoadingWaveform && (
              <div className={styles.waveLoading}>
                <div className={styles.spinner}></div>
                <span>Generating waveform...</span>
              </div>
            )}
            <div ref={zoomviewRef} className={styles.peaksZoomview} style={{ display: isLoadingWaveform ? 'none' : 'block' }} />
            <div ref={overviewRef} className={styles.peaksOverview} style={{ display: isLoadingWaveform ? 'none' : 'block' }} />
          </div>

          {/* Playback row */}
          <div className={styles.playRow}>
            <button onClick={togglePlayPause} className={styles.playBtn} disabled={!duration}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <span className={styles.timeTxt}>{formatTime(currentTime)} / {formatTime(duration)}</span>
            <div className={styles.volCtrl}>
              <span className={styles.volIcon}>{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className={styles.volSlider} />
            </div>
          </div>
        </div>
      )}

      {/* Settings + Find row */}
      {audioFile && (
        <div className={styles.findRow}>
          <label className={styles.findLabel}>Tracks:</label>
          <input type="number" value={numberOfTracks} onChange={(e) => { const v = e.target.value; setNumberOfTracks(v === "" ? "" : parseInt(v) || ""); }} min="2" max="100" step="1" className={styles.findInput} />
          <button onClick={findSplitPoints} className={styles.findBtn} disabled={isAnalyzing || !peaksReady}>
            {isAnalyzing ? "Analyzing..." : "Find Split Points"}
          </button>
          {isAnalyzing && <button onClick={cancelAnalysis} className={styles.cancelBtn}>Cancel</button>}
          <span className={styles.msgTxt}>{message}</span>
        </div>
      )}

      {!audioFile && <p className={styles.msgTxt} style={{ textAlign: "center" }}>{message}</p>}

      {progress !== null && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress * 100}%` }}></div>
          <span className={styles.progressText}>{(progress * 100).toFixed(1)}%</span>
        </div>
      )}

      {/* Track segments table */}
      {sortedTracks.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Track</th>
                <th>Start</th>
                <th>End</th>
                <th>Duration</th>
                <th>Gap After</th>
                {exportedTracks.length > 0 && <th></th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedTracks.map((track, i) => {
                const trackDur = track.endTime - track.startTime;
                const gapAfter = i < sortedTracks.length - 1
                  ? sortedTracks[i + 1].startTime - track.endTime
                  : 0;
                const exported = exportedTracks.find((t) => t.trackNumber === i + 1);
                return (
                  <tr key={track.id}>
                    <td style={{ color: TRACK_COLORS[i % TRACK_COLORS.length].replace('0.4', '1') }}>
                      <b>{track.label}</b>
                    </td>
                    <td>{formatTime(track.startTime)}</td>
                    <td>{formatTime(track.endTime)}</td>
                    <td>{formatTime(trackDur)}</td>
                    <td>
                      {gapAfter > 0.01 ? (
                        <span style={{ color: '#e53e3e', fontWeight: 600 }}>{formatTime(gapAfter)}</span>
                      ) : i < sortedTracks.length - 1 ? (
                        <span style={{ color: '#38a169' }}>none</span>
                      ) : '—'}
                    </td>
                    {exportedTracks.length > 0 && (
                      <td>
                        {exported ? (
                          <button onClick={() => downloadTrack(exported)} className={styles.dlBtn}>
                            ↓ {exported.size >= 1048576 ? `${(exported.size / 1048576).toFixed(1)}MB` : `${(exported.size / 1024).toFixed(0)}KB`}
                          </button>
                        ) : "—"}
                      </td>
                    )}
                    <td>
                      <button onClick={() => removeTrack(i)} className={styles.removeBtn} title="Remove track">×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Export section */}
      {tracks.length > 0 && (
        <div className={styles.exportRow}>
          <div className={styles.fmtGroup}>
            <select value={outputFormat} onChange={(e) => { setOutputFormat(e.target.value); invalidateExports(); }} className={styles.fmtSelect}>
              <option value="mp3">MP3</option>
              <option value="flac">FLAC</option>
            </select>
            {outputFormat === "mp3" && (
              <select value={mp3Bitrate} onChange={(e) => { setMp3Bitrate(e.target.value); invalidateExports(); }} className={styles.fmtSelect}>
                <option value="128">128kbps</option>
                <option value="192">192kbps</option>
                <option value="256">256kbps</option>
                <option value="320">320kbps</option>
              </select>
            )}
          </div>

          {hasGaps() && (
            <button onClick={removeGaps} className={styles.tbBtn} title="Remove gaps before export">
              Remove Gaps
            </button>
          )}

          <button onClick={exportAllTracks} className={styles.exportBtn} disabled={isExporting || isAnalyzing}>
            {isExporting ? "Exporting..." : `Export ${outputFormat.toUpperCase()}`}
          </button>
          {isExporting && <button onClick={cancelExport} className={styles.cancelBtn}>Cancel</button>}
          {exportedTracks.length > 0 && (
            <>
              <button onClick={downloadAllTracks} className={styles.dlAllBtn}>Download All</button>
              <button onClick={downloadAsZip} className={styles.zipBtn}>ZIP</button>
            </>
          )}
        </div>
      )}

      {exportProgress && (
        <div className={styles.exportProg}>
          <span>Track {exportProgress.current}/{exportProgress.total}: {exportProgress.trackName}</span>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}></div>
          </div>
        </div>
      )}

      {/* Exported files grid */}
      {exportedTracks.length > 0 && (
        <div className={styles.exportedGrid}>
          {exportedTracks.map((track) => (
            <div key={track.trackNumber} className={styles.exportedCard}>
              <div className={styles.cardInfo}>
                <b>Track {track.trackNumber}</b>
                <span className={styles.cardName}>{track.name}</span>
                <span className={styles.cardSize}>{track.size >= 1048576 ? `${(track.size / 1048576).toFixed(2)} MB` : `${(track.size / 1024).toFixed(0)} KB`}</span>
              </div>
              <button onClick={() => downloadTrack(track)} className={styles.dlBtn}>↓</button>
            </div>
          ))}
        </div>
      )}

      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} preload="auto" controls style={{ display: 'none' }} />
    </section>
  );
}

export default function AutoSplitterPage() {
  return (
    <main className={styles.main}>
      <AutoSplitterTool />
    </main>
  );
}
