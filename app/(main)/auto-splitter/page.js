"use client";
import React, { useState, useRef, useEffect } from "react";
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

function AutoSplitterTool() {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("Drop an audio file to begin");
  const [progress, setProgress] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [duration, setDuration] = useState(0);
  const [channelData, setChannelData] = useState(null);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [numberOfTracks, setNumberOfTracks] = useState(2);
  const [splitPoints, setSplitPoints] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [outputFormat, setOutputFormat] = useState("mp3");
  const [mp3Bitrate, setMp3Bitrate] = useState("128");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const [exportedTracks, setExportedTracks] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);

  const ffmpegRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const logOutputRef = useRef("");
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const playbackTimerRef = useRef(null);
  const cancelRef = useRef(false);

  const zoomRef = useRef(zoom);
  const viewStartRef = useRef(viewStart);
  const durationRef = useRef(duration);
  const splitPointsRef = useRef(splitPoints);
  const exportedTracksRef = useRef(exportedTracks);
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  zoomRef.current = zoom;
  viewStartRef.current = viewStart;
  durationRef.current = duration;
  splitPointsRef.current = splitPoints;
  exportedTracksRef.current = exportedTracks;
  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;

  useEffect(() => {
    setMounted(true);
    ffmpegRef.current = new FFmpeg();
  }, []);

  useEffect(() => {
    if (!audioFile) return;
    setIsLoadingWaveform(true);
    setSplitPoints([]);
    setZoom(1);
    setViewStart(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setTrimStart(0);
    exportedTracks.forEach((t) => URL.revokeObjectURL(t.url));
    setExportedTracks([]);

    const decodeAudio = async () => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await audioFile.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        setDuration(audioBuffer.duration);
        setTrimEnd(audioBuffer.duration);
        setChannelData(audioBuffer.getChannelData(0));
        setMessage(`Loaded: ${audioFile.name} (${formatTime(audioBuffer.duration)})`);
        audioContext.close();
      } catch (error) {
        console.error("Error decoding audio:", error);
        setMessage("Error decoding audio file");
      } finally {
        setIsLoadingWaveform(false);
      }
    };
    decodeAudio();
  }, [audioFile]);

  useEffect(() => {
    if (!audioFile || !audioRef.current) return;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(audioFile);
    audioUrlRef.current = url;
    audioRef.current.src = url;
    audioRef.current.load();
    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, [audioFile]);

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

  // ===== DRAW WAVEFORM =====
  useEffect(() => {
    if (!channelData || !canvasRef.current || !containerRef.current || !duration) return;
    drawWaveform();
    const handleResize = () => drawWaveform();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [channelData, splitPoints, duration, zoom, viewStart, trimStart, trimEnd]);

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !channelData || !duration) return;

    const width = container.offsetWidth;
    const height = 180;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const visibleDuration = duration / zoom;
    const visEnd = viewStart + visibleDuration;
    const timeToX = (t) => ((t - viewStart) / visibleDuration) * width;
    const effectiveTrimEnd = trimEnd > 0 ? trimEnd : duration;

    // Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#f8fafc");
    bgGrad.addColorStop(1, "#f1f5f9");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Alternating track sections (within trim range)
    const activeSplits = splitPoints.filter((p) => p > trimStart && p < effectiveTrimEnd);
    if (activeSplits.length > 0) {
      const allPts = [trimStart, ...activeSplits, effectiveTrimEnd];
      const colors = ["rgba(102,126,234,0.08)", "rgba(118,75,162,0.08)"];
      for (let i = 0; i < allPts.length - 1; i++) {
        const x1 = Math.max(0, timeToX(allPts[i]));
        const x2 = Math.min(width, timeToX(allPts[i + 1]));
        if (x2 > 0 && x1 < width) {
          ctx.fillStyle = colors[i % 2];
          ctx.fillRect(x1, 0, x2 - x1, height);
        }
      }
    }

    // Center line
    ctx.strokeStyle = "#cbd5e0";
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Waveform
    const totalSamples = channelData.length;
    const sampleRate = totalSamples / duration;
    const startSample = Math.max(0, Math.floor(viewStart * sampleRate));
    const endSample = Math.min(totalSamples, Math.ceil(visEnd * sampleRate));
    const visibleSamples = endSample - startSample;
    const samplesPerPixel = Math.max(1, Math.floor(visibleSamples / width));

    const posGrad = ctx.createLinearGradient(0, height / 2, 0, 0);
    posGrad.addColorStop(0, "#667eea");
    posGrad.addColorStop(1, "#764ba2");
    ctx.strokeStyle = posGrad;
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x++) {
      const si = startSample + x * samplesPerPixel;
      const ei = Math.min(si + samplesPerPixel, totalSamples);
      let max = 0;
      for (let i = si; i < ei; i++) {
        if (channelData[i] > max) max = channelData[i];
      }
      ctx.beginPath();
      ctx.moveTo(x, height / 2);
      ctx.lineTo(x, height / 2 - max * (height / 2) * 0.85);
      ctx.stroke();
    }

    const negGrad = ctx.createLinearGradient(0, height / 2, 0, height);
    negGrad.addColorStop(0, "#5a67d8");
    negGrad.addColorStop(1, "#4c51bf");
    ctx.strokeStyle = negGrad;
    for (let x = 0; x < width; x++) {
      const si = startSample + x * samplesPerPixel;
      const ei = Math.min(si + samplesPerPixel, totalSamples);
      let min = 0;
      for (let i = si; i < ei; i++) {
        if (channelData[i] < min) min = channelData[i];
      }
      ctx.beginPath();
      ctx.moveTo(x, height / 2);
      ctx.lineTo(x, height / 2 - min * (height / 2) * 0.85);
      ctx.stroke();
    }

    // Dim outside trim range
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    const tsX = timeToX(trimStart);
    const teX = timeToX(effectiveTrimEnd);
    if (tsX > 0) ctx.fillRect(0, 0, Math.min(tsX, width), height);
    if (teX < width) ctx.fillRect(Math.max(teX, 0), 0, width - Math.max(teX, 0), height);

    // Time markers
    ctx.strokeStyle = "#cbd5e0";
    ctx.lineWidth = 1;
    ctx.font = "9px Arial";
    ctx.fillStyle = "#718096";
    ctx.textAlign = "left";
    const interval = visibleDuration > 300 ? 60 : visibleDuration > 60 ? 10 : visibleDuration > 10 ? 5 : 1;
    const firstMarker = Math.ceil(viewStart / interval) * interval;
    for (let t = firstMarker; t < visEnd; t += interval) {
      const x = timeToX(t);
      if (x < 0 || x > width) continue;
      ctx.beginPath();
      ctx.moveTo(x, height / 2 - 4);
      ctx.lineTo(x, height / 2 + 4);
      ctx.stroke();
      ctx.fillText(formatTime(t), x + 2, height / 2 - 6);
    }

    // Split lines
    activeSplits.forEach((point, idx) => {
      const x = timeToX(point);
      if (x < -20 || x > width + 20) return;

      ctx.strokeStyle = "#e53e3e";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(229, 62, 62, 0.12)";
      ctx.fillRect(x - 4, 0, 8, height);

      ctx.fillStyle = "#e53e3e";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "center";
      ctx.fillText(formatTime(point), x, 12);

      ctx.beginPath();
      ctx.arc(x, height - 12, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#e53e3e";
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = "bold 9px Arial";
      ctx.fillText(`${idx + 1}`, x, height - 9);
    });

    // Track labels
    if (activeSplits.length > 0) {
      const allPts = [trimStart, ...activeSplits, effectiveTrimEnd];
      for (let i = 0; i < allPts.length - 1; i++) {
        const x1 = timeToX(allPts[i]);
        const x2 = timeToX(allPts[i + 1]);
        if (x2 < 0 || x1 > width) continue;
        const cx = (Math.max(0, x1) + Math.min(width, x2)) / 2;
        ctx.fillStyle = "#2d3748";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`Track ${i + 1}`, cx, height - 30);
        ctx.fillStyle = "#718096";
        ctx.font = "9px Arial";
        ctx.fillText(formatTime(allPts[i + 1] - allPts[i]), cx, height - 20);
      }
    }

    // Trim markers
    const drawTrimMarker = (t, label, color) => {
      const x = timeToX(t);
      if (x < -20 || x > width + 20) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Handle at top
      ctx.fillStyle = color;
      ctx.beginPath();
      if (label === "S") {
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 12, 0);
        ctx.lineTo(x + 12, 14);
        ctx.lineTo(x, 14);
      } else {
        ctx.moveTo(x, 0);
        ctx.lineTo(x - 12, 0);
        ctx.lineTo(x - 12, 14);
        ctx.lineTo(x, 14);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = "bold 9px Arial";
      ctx.textAlign = "center";
      ctx.fillText(label, label === "S" ? x + 6 : x - 6, 10);
    };
    drawTrimMarker(trimStart, "S", "#0bc5ea");
    drawTrimMarker(effectiveTrimEnd, "E", "#0bc5ea");

    // Border
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(0, 0, width, height);
  };

  // ===== WHEEL ZOOM =====
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e) => {
      e.preventDefault();
      const d = durationRef.current;
      if (!d) return;
      const z = zoomRef.current;
      const vs = viewStartRef.current;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const visDur = d / z;
      const mouseTime = vs + (mouseX / rect.width) * visDur;
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      const newZoom = Math.max(1, Math.min(200, z * factor));
      const newVisDur = d / newZoom;
      let newVS = mouseTime - (mouseX / rect.width) * newVisDur;
      newVS = Math.max(0, Math.min(d - newVisDur, newVS));
      setZoom(newZoom);
      setViewStart(newVS);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [channelData]);

  // ===== WAVEFORM MOUSE =====
  const handleWaveformMouseDown = (e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startClientX = e.clientX;
    const startRelX = e.clientX - rect.left;
    let moved = false;

    const d = durationRef.current;
    const z = zoomRef.current;
    const vs = viewStartRef.current;
    const visDur = d / z;
    const xToTime = (rx) => vs + (rx / rect.width) * visDur;
    const tToX = (t) => ((t - vs) / visDur) * rect.width;

    // Hit-test: trim markers first, then split points
    const ts = trimStartRef.current;
    const te = trimEndRef.current > 0 ? trimEndRef.current : d;
    let hitType = null; // 'trimStart' | 'trimEnd' | 'split'
    let hitIdx = -1;

    if (Math.abs(startRelX - tToX(ts)) < 10) {
      hitType = "trimStart";
    } else if (Math.abs(startRelX - tToX(te)) < 10) {
      hitType = "trimEnd";
    } else {
      const pts = splitPointsRef.current;
      for (let i = 0; i < pts.length; i++) {
        if (Math.abs(startRelX - tToX(pts[i])) < 10) {
          hitType = "split";
          hitIdx = i;
          break;
        }
      }
    }

    const startViewStart = vs;

    const onMove = (moveEvt) => {
      moved = true;
      const currentRect = container.getBoundingClientRect();
      const relX = moveEvt.clientX - currentRect.left;
      const cVS = viewStartRef.current;
      const cZ = zoomRef.current;
      const cD = durationRef.current;
      const cVisDur = cD / cZ;
      const t = cVS + (relX / currentRect.width) * cVisDur;

      if (hitType === "trimStart") {
        const cTE = trimEndRef.current > 0 ? trimEndRef.current : cD;
        setTrimStart(Math.max(0, Math.min(cTE - 0.1, t)));
        invalidateExports();
      } else if (hitType === "trimEnd") {
        const cTS = trimStartRef.current;
        setTrimEnd(Math.max(cTS + 0.1, Math.min(cD, t)));
        invalidateExports();
      } else if (hitType === "split") {
        const currentPts = [...splitPointsRef.current];
        const prevBound = hitIdx > 0 ? currentPts[hitIdx - 1] + 0.05 : 0.05;
        const nextBound = hitIdx < currentPts.length - 1 ? currentPts[hitIdx + 1] - 0.05 : cD - 0.05;
        currentPts[hitIdx] = Math.max(prevBound, Math.min(nextBound, t));
        setSplitPoints(currentPts);
        invalidateExports();
      } else if (z > 1) {
        const dx = moveEvt.clientX - startClientX;
        const pxPerSec = rect.width / visDur;
        const dt = -dx / pxPerSec;
        const maxVS = d - visDur;
        setViewStart(Math.max(0, Math.min(maxVS, startViewStart + dt)));
      }
    };

    const onUp = (upEvt) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      container.style.cursor = "";
      if (!moved && !hitType) {
        const currentRect = container.getBoundingClientRect();
        const relX = upEvt.clientX - currentRect.left;
        const cVS = viewStartRef.current;
        const cZ = zoomRef.current;
        const cD = durationRef.current;
        const seekTime = cVS + (relX / currentRect.width) * (cD / cZ);
        if (audioRef.current && seekTime >= 0 && seekTime <= cD) {
          audioRef.current.currentTime = seekTime;
          setCurrentTime(seekTime);
        }
      }
    };

    if (hitType === "trimStart" || hitType === "trimEnd") {
      container.style.cursor = "ew-resize";
    } else if (hitType === "split") {
      container.style.cursor = "ew-resize";
    } else if (z > 1) {
      container.style.cursor = "grabbing";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleWaveformMouseMove = (e) => {
    const container = containerRef.current;
    if (!container || !duration) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const visDur = duration / zoom;
    const tToX = (t) => ((t - viewStart) / visDur) * rect.width;

    const te = trimEnd > 0 ? trimEnd : duration;
    if (Math.abs(x - tToX(trimStart)) < 10 || Math.abs(x - tToX(te)) < 10) {
      container.style.cursor = "ew-resize";
      return;
    }
    for (const pt of splitPoints) {
      if (Math.abs(x - tToX(pt)) < 10) {
        container.style.cursor = "ew-resize";
        return;
      }
    }
    container.style.cursor = zoom > 1 ? "grab" : "crosshair";
  };

  const invalidateExports = () => {
    if (exportedTracksRef.current.length > 0) {
      exportedTracksRef.current.forEach((t) => URL.revokeObjectURL(t.url));
      setExportedTracks([]);
    }
  };

  // ===== SPLIT POINT MANAGEMENT =====
  const addSplitAtPlayhead = () => {
    if (!duration) return;
    const t = currentTime;
    if (t <= 0.05 || t >= duration - 0.05) return;
    // Don't add if too close to existing point
    for (const p of splitPoints) {
      if (Math.abs(p - t) < 0.1) return;
    }
    setSplitPoints([...splitPoints, t].sort((a, b) => a - b));
    invalidateExports();
  };

  const removeSplitPoint = (idx) => {
    const newPts = splitPoints.filter((_, i) => i !== idx);
    setSplitPoints(newPts);
    invalidateExports();
  };

  const clearSplitPoints = () => {
    setSplitPoints([]);
    invalidateExports();
  };

  // ===== ZOOM =====
  const zoomIn = () => {
    const newZoom = Math.min(200, zoom * 1.5);
    const visDur = duration / newZoom;
    const center = viewStart + (duration / zoom) / 2;
    setZoom(newZoom);
    setViewStart(Math.max(0, Math.min(duration - visDur, center - visDur / 2)));
  };
  const zoomOut = () => {
    const newZoom = Math.max(1, zoom / 1.5);
    const visDur = duration / newZoom;
    const center = viewStart + (duration / zoom) / 2;
    setZoom(newZoom);
    setViewStart(Math.max(0, Math.min(duration - visDur, center - visDur / 2)));
  };
  const resetZoom = () => { setZoom(1); setViewStart(0); };

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

      const points = selectBestSplitPoints(silenceRegions, numTracks, duration);
      setSplitPoints(points);
      const method = silenceRegions.length >= numTracks - 1 ? "silence-based" : "equal division";
      setMessage(`Found ${points.length} split point${points.length !== 1 ? "s" : ""} for ${numTracks} tracks (${method})`);
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

  // ===== EXPORT =====
  const getActiveSplits = () => {
    const te = trimEnd > 0 ? trimEnd : duration;
    return splitPoints.filter((p) => p > trimStart && p < te);
  };

  const getTrackName = (trackNumber) => {
    const baseName = audioFile?.name?.replace(/\.[^/.]+$/, "") || "audio";
    return `${baseName}_track${trackNumber}.${outputFormat}`;
  };

  const exportAllTracks = async () => {
    if (!audioFile) return;
    const active = getActiveSplits();
    const te = trimEnd > 0 ? trimEnd : duration;
    const allPts = [trimStart, ...active, te];
    if (allPts.length < 2) return;

    setIsExporting(true);
    cancelRef.current = false;
    exportedTracks.forEach((t) => URL.revokeObjectURL(t.url));
    setExportedTracks([]);

    try {
      if (!loaded) { setMessage("Loading FFmpeg.wasm (~31 MB)..."); await loadFFmpeg(); }
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile("input", await fetchFile(audioFile));

      const totalTracks = allPts.length - 1;
      const tracks = [];
      const mimeType = outputFormat === "flac" ? "audio/flac" : "audio/mpeg";
      const codecArgs = outputFormat === "flac" ? ["-c:a", "flac"] : ["-c:a", "libmp3lame", "-b:a", `${mp3Bitrate}k`];

      for (let i = 0; i < totalTracks; i++) {
        if (cancelRef.current) break;
        const trackNum = i + 1;
        const trackName = getTrackName(trackNum);
        const outputName = `track_${trackNum}.${outputFormat}`;
        setExportProgress({ current: trackNum, total: totalTracks, trackName });
        setMessage(`Exporting track ${trackNum}/${totalTracks}...`);

        await ffmpeg.exec(["-i", "input", "-ss", allPts[i].toFixed(4), "-to", allPts[i + 1].toFixed(4), ...codecArgs, "-y", outputName]);
        const data = await ffmpeg.readFile(outputName);
        const blob = new Blob([data.buffer], { type: mimeType });
        tracks.push({ trackNumber: trackNum, name: trackName, url: URL.createObjectURL(blob), size: blob.size });
        try { await ffmpeg.deleteFile(outputName); } catch {}
      }
      setExportedTracks(tracks);
      if (!cancelRef.current) setMessage(`Exported ${tracks.length} tracks as ${outputFormat === "flac" ? "FLAC" : `${mp3Bitrate}kbps MP3`}`);
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

  const downloadWaveformImage = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `${audioFile?.name || "audio"}_split_points.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const audio = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("audio/"));
    if (audio) setAudioFile(audio);
  };

  const handleFileInput = (e) => {
    if (e.target.files.length > 0) setAudioFile(e.target.files[0]);
  };

  if (!mounted) return null;

  const visibleDuration = duration / zoom;
  const playheadVisible = duration > 0 && currentTime >= viewStart && currentTime <= viewStart + visibleDuration;
  const playheadPct = playheadVisible ? ((currentTime - viewStart) / visibleDuration) * 100 : 0;
  const effectiveTrimEnd = trimEnd > 0 ? trimEnd : duration;
  const activeSplits = splitPoints.filter((p) => p > trimStart && p < effectiveTrimEnd);
  const allSegmentPts = [trimStart, ...activeSplits, effectiveTrimEnd];

  return (
    <section className={styles.section}>
      <p className={styles.desc}>
        Analyze audio to find optimal split points. Drag split lines to adjust, scroll to zoom, click to seek.
      </p>

      {/* Drop zone */}
      <div className={styles.dropZone} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
        <span>Drop audio file or click to browse</span>
        <input type="file" accept="audio/*" onChange={handleFileInput} className={styles.fileInput} />
      </div>

      {/* File info (single row) */}
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
              <span className={styles.zoomLvl}>{Math.round(zoom * 100)}%</span>
              <button onClick={zoomIn} className={styles.tbBtn} title="Zoom In">+</button>
              <button onClick={resetZoom} className={styles.tbBtn}>Reset</button>
            </div>
            <div className={styles.splitControls}>
              <button onClick={addSplitAtPlayhead} className={styles.tbBtn} title="Add split at playhead">+ Split</button>
              {splitPoints.length > 0 && (
                <button onClick={clearSplitPoints} className={styles.tbBtnDanger}>Clear Splits</button>
              )}
            </div>
            {splitPoints.length > 0 && (
              <button onClick={downloadWaveformImage} className={styles.tbBtnGreen}>Save Image</button>
            )}
          </div>

          <div ref={containerRef} className={styles.waveWrap} onMouseDown={handleWaveformMouseDown} onMouseMove={handleWaveformMouseMove}>
            {isLoadingWaveform ? (
              <div className={styles.waveLoading}><div className={styles.spinner}></div><span>Loading waveform...</span></div>
            ) : (
              <>
                <canvas ref={canvasRef} className={styles.waveCanvas} />
                {playheadVisible && (
                  <div className={styles.playhead} style={{ left: `${playheadPct}%` }}>
                    <div className={styles.playheadLine} />
                    <div className={styles.playheadHandle} />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Playback + trim row */}
          <div className={styles.playRow}>
            <button onClick={togglePlayPause} className={styles.playBtn} disabled={!duration}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <span className={styles.timeTxt}>{formatTime(currentTime)} / {formatTime(duration)}</span>
            <div className={styles.volCtrl}>
              <span className={styles.volIcon}>{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className={styles.volSlider} />
            </div>
            <div className={styles.trimInputs}>
              <label>Trim:</label>
              <input type="number" value={parseFloat(trimStart.toFixed(2))} onChange={(e) => { setTrimStart(Math.max(0, Math.min(effectiveTrimEnd - 0.1, parseFloat(e.target.value) || 0))); invalidateExports(); }} step="0.01" min="0" className={styles.trimIn} title="Trim start (seconds)" />
              <span>–</span>
              <input type="number" value={parseFloat(effectiveTrimEnd.toFixed(2))} onChange={(e) => { setTrimEnd(Math.max(trimStart + 0.1, Math.min(duration, parseFloat(e.target.value) || duration))); invalidateExports(); }} step="0.01" min="0" className={styles.trimIn} title="Trim end (seconds)" />
            </div>
          </div>

          {zoom > 1 && (
            <div className={styles.scrollBar}>
              <div className={styles.scrollThumb} style={{ left: `${(viewStart / duration) * 100}%`, width: `${(1 / zoom) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Settings + Find row */}
      {audioFile && (
        <div className={styles.findRow}>
          <label className={styles.findLabel}>Tracks:</label>
          <input type="number" value={numberOfTracks} onChange={(e) => { const v = e.target.value; setNumberOfTracks(v === "" ? "" : parseInt(v) || ""); }} min="2" max="100" step="1" className={styles.findInput} />
          <button onClick={findSplitPoints} className={styles.findBtn} disabled={isAnalyzing}>
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

      {/* Split timestamps with remove */}
      {splitPoints.length > 0 && (
        <div className={styles.splitsRow}>
          {splitPoints.map((point, i) => {
            const inRange = point > trimStart && point < effectiveTrimEnd;
            return (
              <span key={i} className={`${styles.splitTag} ${!inRange ? styles.splitTagDim : ""}`}>
                #{i + 1} {formatTime(point)}
                <button onClick={() => removeSplitPoint(i)} className={styles.removeBtn} title="Remove">×</button>
              </span>
            );
          })}
        </div>
      )}

      {/* Track segments table */}
      {activeSplits.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Track</th>
                <th>Start</th>
                <th>End</th>
                <th>Duration</th>
                {exportedTracks.length > 0 && <th></th>}
              </tr>
            </thead>
            <tbody>
              {allSegmentPts.slice(0, -1).map((start, i) => {
                const exported = exportedTracks.find((t) => t.trackNumber === i + 1);
                return (
                  <tr key={i}>
                    <td>Track {i + 1}</td>
                    <td>{formatTime(start)}</td>
                    <td>{formatTime(allSegmentPts[i + 1])}</td>
                    <td>{formatTime(allSegmentPts[i + 1] - start)}</td>
                    {exportedTracks.length > 0 && (
                      <td>
                        {exported ? (
                          <button onClick={() => downloadTrack(exported)} className={styles.dlBtn}>
                            ↓ {exported.size >= 1048576 ? `${(exported.size / 1048576).toFixed(1)}MB` : `${(exported.size / 1024).toFixed(0)}KB`}
                          </button>
                        ) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Export section */}
      {activeSplits.length > 0 && (
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

      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} preload="auto" />
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
