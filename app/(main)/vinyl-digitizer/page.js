"use client";
import React, { useState, useRef, useEffect, useCallback, useContext } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import JSZip from "jszip";
import styles from "./vinyl-digitizer.module.css";
import YouTubeAuth from "../YouTubeAuth/YouTubeAuth";
import { ColorContext } from "../ColorContext";
import {
  extractTagsFromDiscogs,
  buildTagString,
  generateVideoTitleRecommendations,
  buildTimestampDescription,
  formatTimestamp,
  YT_LIMITS,
} from "../../utils/musicMetadata";

// ---- Helpers ----
function formatTime(s) {
  if (!s || s < 0) return "0:00.00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

function formatBytes(b) {
  if (!b) return "0 KB";
  if (b >= 1048576) return (b / 1048576).toFixed(2) + " MB";
  return (b / 1024).toFixed(0) + " KB";
}

// ---- Timeline colors ----
const AUDIO_COLORS = ["#667eea","#764ba2","#f093fb","#4facfe","#43e97b","#fa709a","#fee140","#30cfd0"];
const IMG_COLORS   = ["#f7971e","#12c2e9","#f64f59","#c471ed","#11998e","#ee0979","#ff6a00","#3f5efb"];

// ---- History (localStorage) ----
const HISTORY_KEY = "vinyl_digitizer_projects";
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}
function saveHistoryItem(item) {
  try {
    const h = loadHistory();
    const idx = h.findIndex(p => p.id === item.id);
    if (idx >= 0) h[idx] = item; else h.unshift(item);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50)));
  } catch {}
}
function deleteHistoryItem(id) {
  try {
    const h = loadHistory().filter(p => p.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {}
}

// ---- Discogs ----
function parseDiscogsId(url) {
  const m = url.match(/\/release\/(\d+)/);
  return m ? m[1] : null;
}
async function fetchDiscogsRelease(id, base, { attempt = 0, maxAttempts = 5, onRetry } = {}) {
  const url = `${base}/discogsFetch`;
  console.log(`[VINYL] Fetching Discogs release ${id} via ${url} (attempt ${attempt + 1})`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "release", id: String(id) }),
  });
  const data = await res.json().catch(() => null);
  console.log(`[VINYL] Discogs response (HTTP ${res.status}):`, data);
  if (res.status === 429 && attempt < maxAttempts - 1) {
    const delay = Math.min(5 * Math.pow(2, attempt), 120);
    console.warn(`[VINYL] Rate limited. Retrying in ${delay}s (attempt ${attempt + 2}/${maxAttempts})`);
    if (onRetry) onRetry(attempt + 1, delay);
    await new Promise(r => setTimeout(r, delay * 1000));
    return fetchDiscogsRelease(id, base, { attempt: attempt + 1, maxAttempts, onRetry });
  }
  if (!res.ok) {
    const errMsg = data?.error || data?.message || `HTTP ${res.status}`;
    const details = data?.details || "";
    throw new Error(`Discogs API error: ${errMsg}${details ? ` — ${details}` : ""}`);
  }
  return data;
}

const apiBaseURL = () => {
  if (process.env.NODE_ENV === "development") return "http://localhost:3030";
  // Use same origin to avoid CORS issues (martinbarker.me vs www.martinbarker.me)
  if (typeof window !== "undefined") return `${window.location.origin}/internal-api`;
  return "https://www.martinbarker.me/internal-api";
};

// ---- Main Component ----
export default function VinylDigitizerPage() {
  const { darkMode } = useContext(ColorContext);
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(1);

  // Audio source
  const [audioMode, setAudioMode] = useState("upload");
  const [audioFile, setAudioFile] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingLevel, setRecordingLevel] = useState(0);

  // Waveform / peaks.js
  const [channelData, setChannelData] = useState(null);
  const [duration, setDuration] = useState(0);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [waveformLoadStatus, setWaveformLoadStatus] = useState(""); // descriptive status text
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [tracks, setTracks] = useState([]); // [{id, startTime, endTime, name}]

  // Album info
  const [discogsUrl, setDiscogsUrl] = useState("");
  const [manualTrackCount, setManualTrackCount] = useState("");
  const [discogsData, setDiscogsData] = useState(null);
  const [isFetchingDiscogs, setIsFetchingDiscogs] = useState(false);
  const [discogsError, setDiscogsError] = useState("");
  const [trackNames, setTrackNames] = useState([]);
  const [projectName, setProjectName] = useState("My Album");
  const [discogsInputMode, setDiscogsInputMode] = useState("url");
  const [discogsSearchQuery, setDiscogsSearchQuery] = useState("");
  const [discogsSearchResults, setDiscogsSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [discogsSearchError, setDiscogsSearchError] = useState("");

  // Volume suggestion
  const [volumeSuggestion, setVolumeSuggestion] = useState(null); // { rmsDb, suggestedGain }
  const [silenceRegions, setSilenceRegions] = useState([]); // detected silence regions [{start,end,mid}]
  // Silence detection tuning parameters
  const [silThresholdDb, setSilThresholdDb] = useState(-35);
  const [silMinDur, setSilMinDur] = useState(0.3);
  const [silWindowMs, setSilWindowMs] = useState(40);

  // FFmpeg / export
  const [loaded, setLoaded] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeLog, setAnalyzeLog] = useState([]);
  const [showAnalyzeLog, setShowAnalyzeLog] = useState(false);
  const [detectAll, setDetectAll] = useState(false);
  const [manualSplitTime, setManualSplitTime] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const [exportedTracks, setExportedTracks] = useState([]);
  const [outputFormat, setOutputFormat] = useState("flac");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(null);

  // Preview playback
  const [previewingTrack, setPreviewingTrack] = useState(null);

  // Volume gain (dB) applied at export
  const [volumeDb, setVolumeDb] = useState(0);
  // RIAA equalization
  const [riaaEnabled, setRiaaEnabled] = useState(false);

  // Per-track export selection
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [filenameFormat, setFilenameFormat] = useState("%num%. %title%");

  // History
  const [projects, setProjects] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [currentProjectId] = useState(() => Date.now().toString());

  // Video render (Step 5)
  const [videoImages, setVideoImages] = useState([]);  // [{id, file, thumbUrl, previewUrl, stretchToFit, useBlurBg, paddingColor}]
  const [selectedVideoAudios, setSelectedVideoAudios] = useState(new Set());
  const [selectedVideoImages, setSelectedVideoImages] = useState(new Set());
  const [showImageModal, setShowImageModal] = useState(false);
  const [modalDragOver, setModalDragOver] = useState(false);
  const [isRenderingVideo, setIsRenderingVideo] = useState(false);
  const [videoRenderProgress, setVideoRenderProgress] = useState(null);
  const [videoRenderStartTime, setVideoRenderStartTime] = useState(null);
  const [videoRenderLogs, setVideoRenderLogs] = useState([]);
  const [showVideoLogs, setShowVideoLogs] = useState(false);
  const videoLogsEndRef = useRef(null);
  const [renderedVideoSrc, setRenderedVideoSrc] = useState(null);
  const [videoOutputName, setVideoOutputName] = useState("");
  const [videoWidth, setVideoWidth] = useState("1920");
  const [videoHeight, setVideoHeight] = useState("1080");
  const [videoBgColor, setVideoBgColor] = useState("#000000");
  const [ytUploadData, setYtUploadData] = useState({ title: "", description: "", privacyStatus: "private", tags: "" });
  const ytUploadDataRef = useRef(ytUploadData);
  const [ytUploading, setYtUploading] = useState(false);
  const [ytUploadProgress, setYtUploadProgress] = useState(null);
  const [ytUploadResult, setYtUploadResult] = useState(null);
  const [ytUploadError, setYtUploadError] = useState("");
  const [ytAuthState, setYtAuthState] = useState({ canAuth: false });
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [thumbnailPreview, setThumbnailPreview] = useState(null);
  const [embedArtFile, setEmbedArtFile] = useState(null); // album art to embed in FLAC exports
  const [embedArtPreview, setEmbedArtPreview] = useState(null);
  const embedArtInputRef = useRef(null);
  const [autoUploadYt, setAutoUploadYt] = useState(false);
  const autoUploadYtRef = useRef(false);
  // YouTube metadata formatting options
  const [ytTitleVariation, setYtTitleVariation] = useState(0);
  const [ytTimestampFormat, setYtTimestampFormat] = useState("auto"); // "auto", "M:SS", "H:MM:SS"
  const [ytTimestampSeparator, setYtTimestampSeparator] = useState(" ");
  const [ytIncludeTrackNums, setYtIncludeTrackNums] = useState(false);
  const [ytDescSuffix, setYtDescSuffix] = useState("\n\nDigitized with Vinyl Digitizer – https://martinbarker.me/vinyl-digitizer");
  const [ytTitleSuggestions, setYtTitleSuggestions] = useState([]);

  // Video timeline / ordering (Step 5)
  const [slideshowMode, setSlideshowMode] = useState("distribute"); // "distribute" | "loop" | "per-track" | "manual"
  const [loopInterval, setLoopInterval] = useState(10); // seconds per image when mode is "loop"
  const [manualImageTimings, setManualImageTimings] = useState({}); // {imgId: {startTime, endTime}}
  const [expandedImgPreviews, setExpandedImgPreviews] = useState(new Set());
  const [videoAudioOrder, setVideoAudioOrder] = useState([]); // ordered indices into exportedTracks
  const [imageLoadingStatus, setImageLoadingStatus] = useState(null); // {loaded, total, current}
  const [discogsArtStatus, setDiscogsArtStatus] = useState(null); // {loaded, total, current, images}

  // Refs
  const ffmpegRef = useRef(null);
  const zoomviewRef = useRef(null);
  const overviewRef = useRef(null);
  const peaksRef = useRef(null);
  const audioContextRef = useRef(null);
  const segmentTimerRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const animFrameRef = useRef(null);
  const logOutputRef = useRef("");
  const cancelRef = useRef(false);
  const videoFfmpegRef = useRef(null);
  const getTokensRef = useRef(null);
  const thumbnailInputRef = useRef(null);
  const modalFileInputRef = useRef(null);
  const directFileInputRef = useRef(null);
  const [directDropDragOver, setDirectDropDragOver] = useState(false);
  const [audioLoadingStatus, setAudioLoadingStatus] = useState(null); // {loaded, total, current}
  const [aspectDropdownOpen, setAspectDropdownOpen] = useState(false);
  const aspectDropdownRef = useRef(null);
  const audioDragRef = useRef(null);
  const imageDragRef = useRef(null);
  const playbackTimerRef = useRef(null);
  const previewCheckRef = useRef(null);

  // Reset entire workflow to fresh state
  const resetAll = () => {
    if (!window.confirm("Start over? This will clear all current work.")) return;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    if (peaksRef.current) { try { peaksRef.current.destroy(); } catch {} peaksRef.current = null; }
    exportedTracks.forEach(t => URL.revokeObjectURL(t.url));
    videoImages.forEach(img => { if (img.thumbUrl) URL.revokeObjectURL(img.thumbUrl); if (img.previewUrl) URL.revokeObjectURL(img.previewUrl); });
    if (renderedVideoSrc) URL.revokeObjectURL(renderedVideoSrc);
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
    setAudioFile(null); setChannelData(null); setDuration(0); setTracks([]); setCurrentTime(0); setIsPlaying(false);
    setDiscogsUrl(""); setDiscogsData(null); setDiscogsError(""); setTrackNames([]); setManualTrackCount(""); setProjectName("My Album");
    setExportedTracks([]); setSelectedTracks(new Set()); setMessage("");
    setVideoImages([]); setSelectedVideoImages(new Set()); setSelectedVideoAudios(new Set()); setRenderedVideoSrc(null);
    setYtUploadData({ title: "", description: "", privacyStatus: "private", tags: "" }); setYtTitleSuggestions([]);
    setYtUploadResult(null); setYtUploadError(""); setThumbnailFile(null); setThumbnailPreview(null);
    setRiaaEnabled(false); setVolumeDb(0); setStep(1);
    autoSplitDoneRef.current = false;
    lastYtDiscogsUrlRef.current = null;
  };

  // Reset just the current step
  const resetStep = (stepNum) => {
    if (stepNum === 1) {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      setAudioFile(null); setChannelData(null); setDuration(0); setMessage("");
      if (peaksRef.current) { try { peaksRef.current.destroy(); } catch {} peaksRef.current = null; }
    } else if (stepNum === 2) {
      setDiscogsUrl(""); setDiscogsData(null); setDiscogsError(""); setTrackNames([]); setManualTrackCount("");
    } else if (stepNum === 3) {
      setTracks([]); setSilenceRegions([]); autoSplitDoneRef.current = false;
      if (peaksRef.current) peaksRef.current.segments.removeAll();
    } else if (stepNum === 4) {
      exportedTracks.forEach(t => URL.revokeObjectURL(t.url)); setExportedTracks([]);
    } else if (stepNum === 5) {
      videoImages.forEach(img => { if (img.thumbUrl) URL.revokeObjectURL(img.thumbUrl); if (img.previewUrl) URL.revokeObjectURL(img.previewUrl); });
      setVideoImages([]); setSelectedVideoImages(new Set()); setSelectedVideoAudios(new Set());
      if (renderedVideoSrc) URL.revokeObjectURL(renderedVideoSrc); setRenderedVideoSrc(null);
    } else if (stepNum === 6) {
      setYtUploadData({ title: "", description: "", privacyStatus: "private", tags: "" }); setYtTitleSuggestions([]);
      setYtUploadResult(null); setYtUploadError(""); setThumbnailFile(null);
      if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview); setThumbnailPreview(null);
      lastYtDiscogsUrlRef.current = null;
    }
  };

  // Close aspect ratio dropdown on outside click
  useEffect(() => {
    if (!aspectDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (aspectDropdownRef.current && !aspectDropdownRef.current.contains(e.target)) setAspectDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [aspectDropdownOpen]);

  useEffect(() => {
    setMounted(true);
    ffmpegRef.current = new FFmpeg();
    setProjects(loadHistory());
  }, []);

  useEffect(() => { autoUploadYtRef.current = autoUploadYt; }, [autoUploadYt]);
  useEffect(() => { ytUploadDataRef.current = ytUploadData; }, [ytUploadData]);

  // Decode audio when file changes (for silence detection + volume analysis)
  useEffect(() => {
    if (!audioFile) return;
    setIsLoadingWaveform(true);
    setTracks([]);
    setCurrentTime(0);
    setIsPlaying(false);
    setExportedTracks([]);
    // Destroy existing peaks instance
    if (peaksRef.current) {
      peaksRef.current.destroy();
      peaksRef.current = null;
    }
    const decode = async () => {
      try {
        setWaveformLoadStatus("Reading audio file…");
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const buf = await audioFile.arrayBuffer();
        setWaveformLoadStatus("Decoding audio data…");
        const decoded = await ac.decodeAudioData(buf);
        setDuration(decoded.duration);
        setChannelData(decoded.getChannelData(0));
        setMessage(`Loaded: ${audioFile.name} (${formatTime(decoded.duration)})`);
        ac.close();
      } catch (err) {
        setMessage("Error decoding audio: " + err.message);
        setIsLoadingWaveform(false);
        setWaveformLoadStatus("");
      }
    };
    decode();
  }, [audioFile]);

  // Volume suggestion — compute RMS when audio loads
  useEffect(() => {
    if (!channelData || channelData.length === 0) { setVolumeSuggestion(null); return; }
    let sum = 0;
    for (let i = 0; i < channelData.length; i++) sum += channelData[i] * channelData[i];
    const rms = Math.sqrt(sum / channelData.length);
    if (rms === 0) { setVolumeSuggestion(null); return; }
    const rmsDb = 20 * Math.log10(rms);
    const targetDb = -18; // -18 dBFS RMS is a good target for vinyl
    const suggestedGain = Math.max(-20, Math.min(20, Math.round((targetDb - rmsDb) * 2) / 2));
    setVolumeSuggestion({ rmsDb: Math.round(rmsDb * 10) / 10, suggestedGain });
  }, [channelData]);

  // Audio element src
  useEffect(() => {
    if (!audioFile || !audioRef.current) return;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(audioFile);
    audioUrlRef.current = url;
    audioRef.current.src = url;
    audioRef.current.load();
    return () => { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); };
  }, [audioFile]);

  // Playback ticker
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

  // Auto-select all exported tracks when entering step 5 and sync order
  useEffect(() => {
    if (step === 5 && exportedTracks.length > 0) {
      setSelectedVideoAudios(prev => {
        // Select any new tracks that aren't already in the set
        const next = new Set(prev);
        exportedTracks.forEach((_, i) => next.add(i));
        return next.size !== prev.size ? next : prev;
      });
      setVideoAudioOrder(prev => {
        if (prev.length !== exportedTracks.length) return exportedTracks.map((_, i) => i);
        return prev;
      });
    }
  }, [step, exportedTracks]);

  // ---- Computed ----
  const trackCount = tracks.length;

  // Sync track names when track count changes
  useEffect(() => {
    setTrackNames(prev => Array.from({ length: trackCount }, (_, i) => {
      if (tracks[i]?.name && tracks[i].name !== `Track ${i + 1}`) return tracks[i].name;
      if (prev[i]) return prev[i];
      if (discogsData?.tracklist?.[i]) return discogsData.tracklist[i].title;
      return `Track ${i + 1}`;
    }));
  }, [trackCount, discogsData, tracks]);

  // Sync selectedTracks (id-based) when tracks change
  const trackIds = tracks.map(t => t.id).join(',');
  useEffect(() => {
    setSelectedTracks(new Set(tracks.map(t => t.id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIds]);

  // Auto-run split detection when first entering Step 3
  const autoSplitDoneRef = useRef(false);
  // Reset when audio changes or when leaving step 3
  useEffect(() => { autoSplitDoneRef.current = false; }, [audioFile]);
  useEffect(() => { if (step < 3) autoSplitDoneRef.current = false; }, [step]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [step]);
  useEffect(() => {
    if (step === 3 && channelData && duration > 0 && !autoSplitDoneRef.current && !isLoadingWaveform) {
      autoSplitDoneRef.current = true;
      // Small delay to ensure peaks.js instance is fully ready after waveform load completes
      const timer = setTimeout(() => detectSilence(), 100);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, channelData, duration, isLoadingWaveform]);

  // ---- peaks.js initialization ----
  const initPeaksInstance = useCallback(async (currentTracks) => {
    if (!audioRef.current || !zoomviewRef.current || !overviewRef.current) return;

    // Destroy existing instance
    if (peaksRef.current) {
      peaksRef.current.destroy();
      peaksRef.current = null;
    }

    try {
      const Peaks = (await import('peaks.js')).default;

      // Reuse AudioContext
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const options = {
        zoomview: {
          container: zoomviewRef.current,
        },
        overview: {
          container: overviewRef.current,
        },
        mediaElement: audioRef.current,
        webAudio: {
          audioContext: audioContextRef.current,
        },
        zoomLevels: [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536],
        segmentOptions: {
          overlay: true,
          markers: true,
          overlayColor: '#667eea',
          overlayOpacity: 0.12,
          overlayBorderColor: '#667eea',
          overlayBorderWidth: 1,
          overlayCornerRadius: 0,
          overlayOffset: 0,
          overlayLabelAlign: 'center',
          overlayLabelVerticalAlign: 'top',
          overlayLabelPadding: 6,
          overlayLabelColor: 'rgba(255, 255, 255, 0.9)',
          overlayFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
          overlayFontSize: 12,
          overlayFontStyle: 'bold',
        },
      };

      return new Promise((resolve, reject) => {
        Peaks.init(options, (err, peaksInstance) => {
          if (err) {
            console.error('peaks.js init error:', err);
            // Retry without webAudio if we get "illegal path" or similar errors
            if (String(err).includes('illegal') || String(err.message || '').includes('illegal') || String(err).includes('not-allowed')) {
              console.log('Retrying peaks.js init without webAudio...');
              const fallbackOptions = { ...options };
              delete fallbackOptions.webAudio;
              Peaks.init(fallbackOptions, (retryErr, retryInstance) => {
                if (retryErr) { reject(retryErr); return; }
                peaksRef.current = retryInstance;
                try {
                  const levels = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
                  retryInstance.zoom.setZoom(levels.length - 1);
                } catch {}
                if (currentTracks && currentTracks.length > 0) {
                  currentTracks.forEach((track, i) => {
                    retryInstance.segments.add({
                      id: track.id, startTime: track.startTime, endTime: track.endTime,
                      labelText: `${i + 1}. ${track.name}`, editable: true,
                      color: AUDIO_COLORS[i % AUDIO_COLORS.length],
                    });
                  });
                }
                retryInstance.on('segments.dragend', ({ segment }) => {
                  if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
                  segmentTimerRef.current = setTimeout(() => {
                    const segs = retryInstance.segments.getSegments().sort((a, b) => a.startTime - b.startTime);
                    const stripNum = (label) => { const m = (label || '').match(/^\d+\.\s*(.*)$/); return m ? m[1] : (label || 'Track'); };
                    setTracks(segs.map(s => ({ id: s.id, startTime: s.startTime, endTime: s.endTime, name: stripNum(s.labelText) })));
                    setExportedTracks([]);
                  }, 50);
                });
                resolve();
              });
              return;
            }
            reject(err);
            return;
          }
          peaksRef.current = peaksInstance;

          // Zoom all the way out by default
          try {
            const levels = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
            peaksInstance.zoom.setZoom(levels.length - 1);
          } catch {}

          // Add existing tracks as segments
          if (currentTracks && currentTracks.length > 0) {
            currentTracks.forEach((track, i) => {
              peaksInstance.segments.add({
                id: track.id,
                startTime: track.startTime,
                endTime: track.endTime,
                labelText: `${i + 1}. ${track.name}`,
                editable: true,
                color: AUDIO_COLORS[i % AUDIO_COLORS.length],
              });
            });
          }

          // Segment drag handler — sync peaks.js segments to React state
          peaksInstance.on('segments.dragend', ({ segment }) => {
            if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
            segmentTimerRef.current = setTimeout(() => {
              const segs = peaksInstance.segments.getSegments()
                .sort((a, b) => a.startTime - b.startTime);
              const draggedIdx = segs.findIndex(s => s.id === segment.id);

              // Only clamp the dragged segment against its neighbors
              if (draggedIdx >= 0) {
                const s = segs[draggedIdx];
                // Clamp against previous segment's end
                if (draggedIdx > 0 && s.startTime < segs[draggedIdx - 1].endTime) {
                  s.update({ startTime: segs[draggedIdx - 1].endTime });
                }
                // Clamp against next segment's start
                if (draggedIdx < segs.length - 1 && s.endTime > segs[draggedIdx + 1].startTime) {
                  s.update({ endTime: segs[draggedIdx + 1].startTime });
                }
                // Clamp to audio bounds
                if (s.startTime < 0) s.update({ startTime: 0 });
              }

              // Strip track number prefix from labelText to get clean name
              const stripNum = (label) => {
                const m = (label || '').match(/^\d+\.\s*(.*)$/);
                return m ? m[1] : (label || 'Track');
              };

              setTracks(segs.map(s => ({
                id: s.id,
                startTime: s.startTime,
                endTime: s.endTime,
                name: stripNum(s.labelText),
              })));
              setExportedTracks([]);
            }, 50);
          });

          resolve();
        });
      });
    } catch (err) {
      console.error('Error loading peaks.js:', err);
      setMessage('Error loading waveform library');
    }
  }, []);

  // Initialize peaks.js when entering Step 3 with audio loaded
  useEffect(() => {
    if (step !== 3 || !audioFile || !audioRef.current) return;
    if (peaksRef.current) {
      // Already initialized — just resize to handle display:none→block transition
      try { peaksRef.current.views.getView('zoomview')?.fitToContainer(); } catch {}
      try { peaksRef.current.views.getView('overview')?.fitToContainer(); } catch {}
      return;
    }

    let cancelled = false;
    const init = async () => {
      setIsLoadingWaveform(true);
      setWaveformLoadStatus("Preparing waveform display…");

      // Wait for DOM refs to be ready
      let retries = 0;
      while (retries < 20) {
        if (zoomviewRef.current && overviewRef.current) break;
        await new Promise(r => setTimeout(r, 100));
        retries++;
      }
      if (!zoomviewRef.current || !overviewRef.current || cancelled) {
        setIsLoadingWaveform(false);
        setWaveformLoadStatus("");
        return;
      }

      // Wait for audio element to have its src set (audio src useEffect may not have fired yet)
      setWaveformLoadStatus("Waiting for audio element…");
      while (!audioRef.current.src || audioRef.current.src === window.location.href) {
        await new Promise(r => setTimeout(r, 50));
        if (cancelled) { setIsLoadingWaveform(false); setWaveformLoadStatus(""); return; }
      }
      // Brief extra delay to ensure audio is ready
      await new Promise(r => setTimeout(r, 200));

      setWaveformLoadStatus("Rendering waveform…");
      try {
        await initPeaksInstance(tracks);
      } catch (err) {
        setMessage('Error initializing waveform: ' + err.message);
      }
      if (!cancelled) {
        setIsLoadingWaveform(false);
        setWaveformLoadStatus("");
      }
    };

    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, audioFile]);

  // Cleanup peaks.js on unmount
  useEffect(() => {
    return () => {
      if (peaksRef.current) {
        try { peaksRef.current.destroy(); } catch {}
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try { audioContextRef.current.close(); } catch {}
      }
      if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
    };
  }, []);

  // Zoom controls for peaks.js
  const zoomIn = () => { if (peaksRef.current) peaksRef.current.zoom.zoomIn(); };
  const zoomOut = () => { if (peaksRef.current) peaksRef.current.zoom.zoomOut(); };

  // Keyboard shortcuts for waveform editor (spacebar=play, comma=zoom out, period=zoom in)
  useEffect(() => {
    const handleKey = (e) => {
      if (step !== 3) return;
      // Ignore if user is typing in an input/textarea/select
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "," || e.key === "<") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "." || e.key === ">") {
        e.preventDefault();
        zoomIn();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step]);

  // Scroll wheel zoom on waveform container
  const handleWaveWheel = useCallback((e) => {
    if (!peaksRef.current) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else if (e.deltaY > 0) zoomOut();
  }, []);

  // Attach wheel listener to zoomview (needs {passive: false} to preventDefault)
  useEffect(() => {
    const el = zoomviewRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWaveWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWaveWheel);
  }, [handleWaveWheel]);

  // ---- Track manipulation ----
  const generateTrackId = () => `track-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const splitTrackAtTime = (time) => {
    const trackIdx = tracks.findIndex(t => time > t.startTime + 0.05 && time < t.endTime - 0.05);
    if (trackIdx === -1) return false;
    const track = tracks[trackIdx];
    const id2 = generateTrackId();
    const track1 = { ...track, endTime: time };
    const track2 = { id: id2, startTime: time, endTime: track.endTime, name: `Track ${tracks.length + 1}` };
    const newTracks = [...tracks];
    newTracks[trackIdx] = track1;
    newTracks.splice(trackIdx + 1, 0, track2);
    setTracks(newTracks);
    if (peaksRef.current) {
      const seg = peaksRef.current.segments.getSegment(track.id);
      if (seg) seg.update({ endTime: time });
      peaksRef.current.segments.add({
        id: id2, startTime: time, endTime: track.endTime,
        labelText: `${trackIdx + 2}. ${track2.name}`, editable: true,
        color: AUDIO_COLORS[(trackIdx + 1) % AUDIO_COLORS.length],
      });
    }
    setExportedTracks([]);
    return true;
  };

  const removeTrack = (trackId) => {
    const newTracks = tracks.filter(t => t.id !== trackId);
    setTracks(newTracks);
    if (peaksRef.current) {
      try { peaksRef.current.segments.removeById(trackId); } catch {}
    }
    setExportedTracks([]);
  };

  const updateTrackTime = (trackId, field, value) => {
    const idx = tracks.findIndex(t => t.id === trackId);
    if (idx === -1) return;
    const track = tracks[idx];
    const updated = { ...track, [field]: value };
    if (field === 'startTime') {
      const prevEnd = idx > 0 ? tracks[idx - 1].endTime : 0;
      updated.startTime = Math.max(prevEnd, Math.min(updated.endTime - 0.05, value));
    } else {
      const nextStart = idx < tracks.length - 1 ? tracks[idx + 1].startTime : duration;
      updated.endTime = Math.max(updated.startTime + 0.05, Math.min(nextStart, value));
    }
    const newTracks = [...tracks];
    newTracks[idx] = updated;
    setTracks(newTracks);
    if (peaksRef.current) {
      const seg = peaksRef.current.segments.getSegment(trackId);
      if (seg) seg.update({ startTime: updated.startTime, endTime: updated.endTime });
    }
    setExportedTracks([]);
  };

  const updateTrackName = (trackIdx, name) => {
    const newTracks = [...tracks];
    newTracks[trackIdx] = { ...newTracks[trackIdx], name };
    setTracks(newTracks);
    if (peaksRef.current) {
      const seg = peaksRef.current.segments.getSegment(newTracks[trackIdx].id);
      if (seg) seg.update({ labelText: `${trackIdx + 1}. ${name}` });
    }
    // Also sync trackNames
    setTrackNames(prev => { const n = [...prev]; n[trackIdx] = name; return n; });
  };

  // ---- Recording ----
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext(); audioCtxRef.current = ac;
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser(); analyser.fftSize = 256;
      src.connect(analyser); analyserRef.current = analyser;
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        setAudioFile(new File([blob], `recording-${Date.now()}.webm`, { type: "audio/webm" }));
        stream.getTracks().forEach(t => t.stop());
        if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
        cancelAnimationFrame(animFrameRef.current);
      };
      mr.start(100); setIsRecording(true); setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 0.1), 100);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const anim = () => { analyser.getByteFrequencyData(buf); setRecordingLevel(buf.reduce((a, b) => a + b, 0) / buf.length / 255); animFrameRef.current = requestAnimationFrame(anim); };
      animFrameRef.current = requestAnimationFrame(anim);
    } catch (err) { setMessage("Microphone access error: " + err.message); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop(); clearInterval(recordingTimerRef.current);
      setIsRecording(false); setRecordingLevel(0); cancelAnimationFrame(animFrameRef.current);
    }
  };

  // ---- Upload ----
  const handleDrop = e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const audioF = files.find(f => f.type.startsWith("audio/"));
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (audioF) setAudioFile(audioF);
    if (imageFiles.length > 0) addImagesToVideo(imageFiles);
  };
  const handleFileInput = e => { if (e.target.files.length > 0) setAudioFile(e.target.files[0]); };

  // ---- Discogs ----
  const fetchDiscogs = async () => {
    setDiscogsError("");
    const id = parseDiscogsId(discogsUrl);
    if (!id) { setDiscogsError("Could not parse release ID. Use: https://www.discogs.com/release/XXXXX"); return; }
    setIsFetchingDiscogs(true);
    try {
      const data = await fetchDiscogsRelease(id, apiBaseURL(), {
        onRetry: (attempt, delay) => setDiscogsError(`Rate limited. Retrying in ${delay}s (attempt ${attempt + 1})…`),
      });
      setDiscogsError("");
      setDiscogsData(data);
      setProjectName(data.title || "My Album");
      setManualTrackCount(String(data.tracklist.length));
      setTrackNames(data.tracklist.map(t => t.title));
    } catch (err) { setDiscogsError(err.message); }
    finally { setIsFetchingDiscogs(false); }
  };

  const searchDiscogs = async () => {
    if (!discogsSearchQuery.trim()) return;
    setIsSearching(true); setDiscogsSearchError(""); setDiscogsSearchResults([]);
    try {
      const url = `${apiBaseURL()}/discogsFetch`;
      console.log(`[VINYL] Searching Discogs: "${discogsSearchQuery}" via ${url}`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "search", query: discogsSearchQuery }),
      });
      const data = await res.json().catch(() => null);
      console.log(`[VINYL] Search response (HTTP ${res.status}):`, data);
      if (!res.ok) throw new Error(data?.error || `Search error: ${res.status}`);
      setDiscogsSearchResults(data.results || []);
      if (!(data.results?.length)) setDiscogsSearchError("No results found.");
    } catch (err) { setDiscogsSearchError(err.message); }
    finally { setIsSearching(false); }
  };

  const selectSearchResult = async (result) => {
    setDiscogsSearchError(""); setIsFetchingDiscogs(true);
    try {
      const data = await fetchDiscogsRelease(result.id, apiBaseURL(), {
        onRetry: (attempt, delay) => setDiscogsSearchError(`Rate limited. Retrying in ${delay}s (attempt ${attempt + 1})…`),
      });
      setDiscogsSearchError("");
      setDiscogsData(data);
      setProjectName(data.title || "My Album");
      setManualTrackCount(String(data.tracklist.length));
      setTrackNames(data.tracklist.map(t => t.title));
      setDiscogsUrl(`https://www.discogs.com/release/${result.id}`);
      setDiscogsSearchResults([]);
    } catch (err) { setDiscogsSearchError(err.message); }
    finally { setIsFetchingDiscogs(false); }
  };

  // ---- FFmpeg ----
  const loadFFmpeg = async () => {
    const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    const ff = ffmpegRef.current;
    ff.on("log", ({ message: msg }) => { logOutputRef.current += msg + "\n"; });
    ff.on("progress", ({ progress: p }) => setProgress(p));
    await ff.load({ coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"), wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm") });
    setLoaded(true);
  };

  const parseSilence = out => {
    const regions = []; let cur = null;
    for (const line of out.split("\n")) {
      const sm = line.match(/silence_start:\s*([\d.]+)/), em = line.match(/silence_end:\s*([\d.]+)/);
      if (sm) cur = parseFloat(sm[1]);
      if (em && cur !== null) { const end = parseFloat(em[1]); regions.push({ start: cur, end, mid: (cur + end) / 2 }); cur = null; }
    }
    return regions;
  };

  const selectSplitPoints = (regions, numTracks, totalDuration, rangeStart = 0, rangeEnd = null) => {
    const end = rangeEnd ?? totalDuration;
    const numSplits = numTracks - 1; if (numSplits <= 0) return [];
    const rangeDur = end - rangeStart;
    // Ideal points evenly spaced within the active trim range
    const ideal = Array.from({ length: numSplits }, (_, i) => rangeStart + (rangeDur * (i + 1)) / numTracks);
    // Filter candidates to within trim range with at least 0.5s margin from edges
    const candidates = regions.map(r => r.mid)
      .filter(m => m > rangeStart + 0.5 && m < end - 0.5)
      .sort((a, b) => a - b);
    if (!candidates.length) return ideal;
    const radius = (rangeDur / numTracks) * 0.4;
    const used = new Set();
    return ideal.map(ip => {
      let bi = -1, bd = Infinity;
      candidates.forEach((c, i) => { if (!used.has(i)) { const d = Math.abs(c - ip); if (d < bd) { bd = d; bi = i; } } });
      if (bi !== -1 && bd < radius) { used.add(bi); return candidates[bi]; }
      return ip;
    }).sort((a, b) => a - b);
  };

  // Pure-JS silence detection — instant, no FFmpeg loading required
  // Rename existing tracks using Discogs tracklist / trackNames without changing positions
  const applyTrackNames = () => {
    if (tracks.length === 0) return;
    const updated = tracks.map((track, i) => {
      const name = trackNames[i] || discogsData?.tracklist?.[i]?.title || track.name;
      return { ...track, name };
    });
    setTracks(updated);
    if (peaksRef.current) {
      updated.forEach((track, i) => {
        const seg = peaksRef.current.segments.getSegment(track.id);
        if (seg) seg.update({ labelText: `${i + 1}. ${track.name}` });
      });
    }
    setMessage(`✓ Updated ${updated.length} track name(s)`);
  };

  const detectSilence = () => {
    if (!channelData || channelData.length === 0) { setMessage("Load audio first"); return; }
    // If tracks already exist, just update names without re-splitting
    if (tracks.length > 0) { applyTrackNames(); return; }
    const n = parseInt(manualTrackCount) || discogsData?.tracklist?.length;
    if (!detectAll && (!n || n < 2)) { setMessage("Set number of tracks (at least 2), or enable \"Find all silences\""); return; }
    setIsAnalyzing(true); cancelRef.current = false; setExportedTracks([]);
    setAnalyzeLog([]); setShowAnalyzeLog(true);
    const log = (msg) => setAnalyzeLog(prev => [...prev, msg]);
    const tsStart = 0, tsEnd = duration;
    log(`Audio: ${formatTime(duration)} · Range: ${formatTime(tsStart)} → ${formatTime(tsEnd)}`);
    log(`Target: ${detectAll ? "all silences" : `${n - 1} split(s) for ${n} tracks`}`);
    // Use requestAnimationFrame so the UI updates before the scan starts
    requestAnimationFrame(() => {
      try {
        const sr = channelData.length / duration;
        const startSample = Math.floor(tsStart * sr);
        const endSample = Math.floor(tsEnd * sr);
        const data = channelData.subarray(startSample, endSample);
        const windowSamples = Math.max(1, Math.floor((silWindowMs / 1000) * sr));
        const thrAmp = Math.pow(10, silThresholdDb / 20);
        const minSilSamples = Math.floor(silMinDur * sr);
        const target = detectAll ? 1 : n - 1;
        const regions = [];
        let silStart = -1;
        for (let i = 0; i < data.length; i += windowSamples) {
          if (cancelRef.current) break;
          const end = Math.min(i + windowSamples, data.length);
          let rms = 0;
          for (let j = i; j < end; j++) rms += data[j] * data[j];
          rms = Math.sqrt(rms / (end - i));
          if (rms <= thrAmp) {
            if (silStart < 0) silStart = i;
          } else if (silStart >= 0) {
            if (i - silStart >= minSilSamples) {
              const s = tsStart + silStart / sr, e = tsStart + i / sr;
              regions.push({ start: s, end: e, mid: (s + e) / 2 });
            }
            silStart = -1;
          }
        }
        if (silStart >= 0 && data.length - silStart >= minSilSamples) {
          const s = tsStart + silStart / sr;
          regions.push({ start: s, end: tsEnd, mid: (s + tsEnd) / 2 });
        }
        log(`${silThresholdDb}dB / ${silMinDur}s / ${silWindowMs}ms → ${regions.length} silence region(s)`);

        if (cancelRef.current) { setMessage("Analysis cancelled"); return; }
        const bestRegions = regions;
        setSilenceRegions(bestRegions);
        let pts;
        if (detectAll) {
          pts = bestRegions.map(r => r.mid).filter(m => m > tsStart + 0.1 && m < tsEnd - 0.1).sort((a, b) => a - b);
          log(`Placing ${pts.length} split(s) at silence midpoints`);
        } else {
          pts = selectSplitPoints(bestRegions, n, duration, tsStart, tsEnd);
          const method = bestRegions.length >= n - 1 ? "silence detection" : "equal division";
          log(`Placed ${pts.length} split(s) via ${method}`);
        }
        // Convert split points to tracks with independent start/end
        const allPts = [tsStart, ...pts, tsEnd];
        const newTracks = [];
        for (let i = 0; i < allPts.length - 1; i++) {
          newTracks.push({
            id: generateTrackId(),
            startTime: allPts[i],
            endTime: allPts[i + 1],
            name: trackNames[i] || `Track ${i + 1}`,
          });
        }
        setTracks(newTracks);
        // Add segments to peaks.js
        if (peaksRef.current) {
          peaksRef.current.segments.removeAll();
          newTracks.forEach((track, i) => {
            peaksRef.current.segments.add({
              id: track.id,
              startTime: track.startTime,
              endTime: track.endTime,
              labelText: `${i + 1}. ${track.name}`,
              editable: true,
              color: AUDIO_COLORS[i % AUDIO_COLORS.length],
            });
          });
        }
        const method = detectAll ? "all silences" : bestRegions.length >= n - 1 ? "silence detection" : "equal division";
        setMessage(`✓ ${pts.length} split point(s) via ${method}`);
      } catch (err) {
        if (!cancelRef.current) { setMessage("Error: " + err.message); log("Error: " + err.message); }
      } finally {
        setIsAnalyzing(false);
      }
    });
  };

  const parseManualTime = str => {
    str = (str || "").trim();
    const mmss = str.match(/^(\d+):(\d+(?:\.\d+)?)$/);
    if (mmss) return parseInt(mmss[1]) * 60 + parseFloat(mmss[2]);
    const sec = parseFloat(str);
    return isNaN(sec) ? null : sec;
  };

  const addManualSplit = () => {
    const t = parseManualTime(manualSplitTime);
    if (t === null || t <= 0.05 || t >= duration - 0.05) {
      setMessage("Invalid time — use seconds (e.g. 45.5) or M:SS (e.g. 1:23)"); return;
    }
    if (tracks.length === 0) {
      // No tracks yet — create two from the full audio
      const newTracks = [
        { id: generateTrackId(), startTime: 0, endTime: t, name: trackNames[0] || 'Track 1' },
        { id: generateTrackId(), startTime: t, endTime: duration, name: trackNames[1] || 'Track 2' },
      ];
      setTracks(newTracks);
      if (peaksRef.current) {
        peaksRef.current.segments.removeAll();
        newTracks.forEach((track, i) => {
          peaksRef.current.segments.add({
            id: track.id, startTime: track.startTime, endTime: track.endTime,
            labelText: `${i + 1}. ${track.name}`, editable: true,
            color: AUDIO_COLORS[i % AUDIO_COLORS.length],
          });
        });
      }
    } else {
      if (!splitTrackAtTime(t)) {
        setMessage("No track found at that time to split"); return;
      }
    }
    setManualSplitTime(""); setExportedTracks([]);
  };

  // ---- Export ----
  const metaArgs = i => {
    if (!discogsData) return [];
    const title = trackNames[i] || discogsData.tracklist?.[i]?.title || `Track ${i + 1}`;
    const artist = discogsData.artists?.map(a => a.name).join(", ") || "";
    const album = discogsData.title || "", year = discogsData.year ? String(discogsData.year) : "";
    return ["-metadata", `title=${title}`, "-metadata", `artist=${artist}`, "-metadata", `album=${album}`, "-metadata", `date=${year}`, "-metadata", `track=${i + 1}/${trackNames.length}`, "-metadata", `genre=${discogsData.genres?.join(", ") || ""}`, "-metadata", `comment=Digitized with Vinyl Digitizer`];
  };

  const FILENAME_TOKENS = [
    { token: "%num%", desc: "Track number (01, 02…)" },
    { token: "%title%", desc: "Track title" },
    { token: "%artist%", desc: "Artist name" },
    { token: "%album%", desc: "Album title" },
    { token: "%year%", desc: "Release year" },
    { token: "%genre%", desc: "First genre" },
    { token: "%pos%", desc: "Discogs position (A1, B2…)" },
    { token: "%side%", desc: "Vinyl side letter (A, B…)" },
    { token: "%track_num%", desc: "Track number within side (1, 2…)" },
  ];

  const getFilename = i => {
    const rawPos = discogsData?.tracklist?.[i]?.position || "";
    const sideMatch = rawPos.match(/^([A-Za-z]+)/);
    const trackNumMatch = rawPos.match(/(\d+)$/);
    // Allow Unicode word characters (letters from any script), digits, spaces, dots, dashes
    const safe = s => (s || "").replace(/[\/\\<>:"|?*\x00-\x1f]/g, "").trim();
    const tokens = {
      "%num%": String(i + 1).padStart(2, "0"),
      "%title%": safe(trackNames[i] || `Track ${i + 1}`),
      "%artist%": safe(discogsData?.artists?.map(a => a.name).join(", ") || ""),
      "%album%": safe(discogsData?.title || ""),
      "%year%": String(discogsData?.year || ""),
      "%genre%": safe(discogsData?.genres?.[0] || ""),
      "%pos%": rawPos || String(i + 1).padStart(2, "0"),
      "%side%": sideMatch ? sideMatch[1].toUpperCase() : "",
      "%track_num%": trackNumMatch ? trackNumMatch[1] : String(i + 1),
    };
    let result = filenameFormat;
    for (const [t, v] of Object.entries(tokens)) result = result.split(t).join(v);
    // Only strip filesystem-unsafe characters, preserve Unicode
    result = result.replace(/[\/\\<>:"|?*\x00-\x1f]/g, "").trim().replace(/\s{2,}/g, " ");
    return `${result || `track ${String(i+1).padStart(2,"0")}`}.${outputFormat}`;
  };

  const exportTracks = async () => {
    if (!audioFile || tracks.length === 0) return;
    const tracksToExport = tracks.filter(t => selectedTracks.has(t.id));
    if (tracksToExport.length === 0) { setMessage("No tracks selected for export"); return; }
    setIsExporting(true); cancelRef.current = false;
    exportedTracks.forEach(t => URL.revokeObjectURL(t.url)); setExportedTracks([]);
    try {
      if (!loaded) { setMessage("Loading FFmpeg.wasm…"); await loadFFmpeg(); }
      const ff = ffmpegRef.current;
      await ff.writeFile("input", await fetchFile(audioFile));
      // Write album art image if embedding in FLAC
      const hasEmbedArt = outputFormat === "flac" && embedArtFile;
      if (hasEmbedArt) {
        await ff.writeFile("cover.jpg", await fetchFile(embedArtFile));
      }
      const total = tracksToExport.length;
      const mime = outputFormat === "flac" ? "audio/flac" : "audio/wav";
      const codec = outputFormat === "flac" ? ["-c:a", "flac"] : ["-c:a", "pcm_s16le"];
      // Build audio filter chain: RIAA EQ + volume
      const afParts = [];
      if (riaaEnabled) {
        // RIAA inverse equalization curve for vinyl playback
        // Bass boost below 500Hz, treble cut above 2122Hz per RIAA standard
        afParts.push("highshelf=f=2122:g=-13.5:t=s,lowshelf=f=500:g=16.5:t=s,highshelf=f=50:g=17:t=s");
      }
      if (volumeDb !== 0) afParts.push(`volume=${volumeDb}dB`);
      const volFilter = afParts.length > 0 ? ["-af", afParts.join(",")] : [];
      const exported = [];
      for (let idx = 0; idx < tracksToExport.length; idx++) {
        const track = tracksToExport[idx];
        const i = tracks.indexOf(track);
        if (cancelRef.current) break;
        const fn = getFilename(i), out = `track_${i}.${outputFormat}`;
        setExportProgress({ current: idx + 1, total, name: fn });
        setMessage(`Exporting ${idx + 1}/${total}: ${fn}`);
        const artArgs = hasEmbedArt ? ["-i", "cover.jpg", "-map", "0:a", "-map", "1:v", "-c:v", "mjpeg", "-disposition:v", "attached_pic"] : [];
        await ff.exec(["-i", "input", ...artArgs, "-ss", track.startTime.toFixed(4), "-to", track.endTime.toFixed(4), ...volFilter, ...codec, ...metaArgs(i), "-y", out]);
        const data = await ff.readFile(out);
        const blob = new Blob([data.buffer], { type: mime });
        exported.push({ index: i, name: fn, url: URL.createObjectURL(blob), size: blob.size, start: track.startTime, end: track.endTime, title: trackNames[i] || track.name });
        try { await ff.deleteFile(out); } catch {}
      }
      if (hasEmbedArt) { try { await ff.deleteFile("cover.jpg"); } catch {} }
      setExportedTracks(exported);
      if (!cancelRef.current) { setMessage(`Exported ${exported.length} tracks`); saveProject(exported); }
    } catch (err) { if (!cancelRef.current) setMessage("Export error: " + err.message); }
    finally { setIsExporting(false); setExportProgress(null); setProgress(null); }
  };

  const cancelExport = () => {
    cancelRef.current = true;
    try { ffmpegRef.current.terminate(); } catch {}
    ffmpegRef.current = new FFmpeg(); setLoaded(false);
    setIsExporting(false); setExportProgress(null); setProgress(null); setMessage("Export cancelled");
  };

  const downloadTrack = t => { const a = document.createElement("a"); a.href = t.url; a.download = t.name; a.click(); };
  const downloadAll = () => exportedTracks.forEach((t, i) => setTimeout(() => downloadTrack(t), i * 300));
  const downloadZip = async () => {
    setMessage("Building ZIP…");
    try {
      const zip = new JSZip();
      for (const t of exportedTracks) zip.file(t.name, await (await fetch(t.url)).blob());
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(projectName || "album").replace(/[^a-zA-Z0-9 _\-]/g, "").trim()}_tracks.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMessage("ZIP downloaded");
    } catch (err) { setMessage("ZIP error: " + err.message); }
  };

  const toggleTrackSelect = id => setSelectedTracks(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAllTracks = () => setSelectedTracks(new Set(tracks.map(t => t.id)));
  const deselectAllTracks = () => setSelectedTracks(new Set());

  // Safe play helper — avoids "play() interrupted by pause()" AbortError
  const safePlay = () => {
    if (!audioRef.current) return;
    const p = audioRef.current.play();
    if (p && p.catch) p.catch(() => {});
  };

  // ---- Track Preview ----
  const previewTrack = i => {
    if (!audioRef.current || !duration || i >= tracks.length) return;
    const track = tracks[i];
    clearInterval(previewCheckRef.current);
    setPreviewingTrack(i);
    audioRef.current.currentTime = track.startTime;
    safePlay(); setIsPlaying(true); setCurrentTime(track.startTime);
    const stopAt = track.endTime;
    previewCheckRef.current = setInterval(() => {
      if (!audioRef.current || audioRef.current.currentTime >= stopAt) {
        audioRef.current?.pause(); setIsPlaying(false); setPreviewingTrack(null);
        clearInterval(previewCheckRef.current);
      }
    }, 50);
  };

  const stopPreview = () => {
    clearInterval(previewCheckRef.current);
    audioRef.current?.pause(); setIsPlaying(false); setPreviewingTrack(null);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) { stopPreview(); }
    else { safePlay(); setIsPlaying(true); }
  };

  // ---- Project History ----
  const saveProject = (expTracks = exportedTracks) => {
    const item = {
      id: currentProjectId, name: projectName, date: new Date().toISOString(),
      audioFileName: audioFile?.name || "recording", duration,
      tracks, trackNames,
      discogsUrl, discogsData: discogsData ? { title: discogsData.title, year: discogsData.year, artists: discogsData.artists, genres: discogsData.genres, tracklist: discogsData.tracklist } : null,
      outputFormat, trackCount: trackNames.length,
    };
    saveHistoryItem(item); setProjects(loadHistory());
  };

  const loadProject = p => {
    setProjectName(p.name);
    // Handle legacy format (splitPoints → tracks conversion)
    if (p.tracks && Array.isArray(p.tracks) && p.tracks.length > 0 && p.tracks[0].id) {
      setTracks(p.tracks);
    } else if (p.splitPoints) {
      const ts = p.trimStart || 0;
      const te = p.trimEnd || p.duration || 0;
      const pts = (p.splitPoints || []).filter(pt => pt > ts && pt < te).sort((a, b) => a - b);
      const allPts = [ts, ...pts, te];
      const converted = [];
      for (let i = 0; i < allPts.length - 1; i++) {
        converted.push({
          id: generateTrackId(),
          startTime: allPts[i],
          endTime: allPts[i + 1],
          name: p.trackNames?.[i] || `Track ${i + 1}`,
        });
      }
      setTracks(converted);
    }
    setTrackNames(p.trackNames || []); setDiscogsUrl(p.discogsUrl || "");
    setDiscogsData(p.discogsData || null); setOutputFormat(p.outputFormat || "flac");
    setManualTrackCount(String(p.trackCount || ""));
    setShowHistory(false); setStep(1); setMessage(`Loaded "${p.name}". Re-select the audio file to continue.`);
  };

  const removeProject = id => { deleteHistoryItem(id); setProjects(loadHistory()); };
  const clearAllHistory = () => {
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    setProjects([]);
  };

  // ---- Video Image Helpers ----
  const createThumbnail = (file, maxSize = 160) => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          resolve(blob ? URL.createObjectURL(blob) : URL.createObjectURL(file));
        }, 'image/jpeg', 0.7);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(URL.createObjectURL(file));
      };
      img.src = url;
    });
  };

  const addImagesToVideo = async (files) => {
    const imageFiles = Array.from(files || []).filter(f => f?.type?.startsWith("image/"));
    if (!imageFiles.length) return;
    setImageLoadingStatus({ loaded: 0, total: imageFiles.length, current: imageFiles[0].name });
    for (let i = 0; i < imageFiles.length; i++) {
      const f = imageFiles[i];
      setImageLoadingStatus({ loaded: i, total: imageFiles.length, current: f.name });
      const id = `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      const thumbUrl = await createThumbnail(f);
      const previewUrl = URL.createObjectURL(f);
      setVideoImages(prev => [...prev, { id, file: f, thumbUrl, previewUrl, stretchToFit: false, useBlurBg: false, paddingColor: "#000000" }]);
      setSelectedVideoImages(prev => { const next = new Set(prev); next.add(id); return next; });
    }
    setImageLoadingStatus(null);
  };

  // Add audio files directly as "exported tracks" for video render (bypass steps 1-4)
  const addDirectAudioFiles = async (files) => {
    const audioFiles = Array.from(files || []).filter(f => f?.type?.startsWith("audio/"));
    if (!audioFiles.length) return;
    setAudioLoadingStatus({ loaded: 0, total: audioFiles.length, current: audioFiles[0].name });
    for (let i = 0; i < audioFiles.length; i++) {
      const f = audioFiles[i];
      setAudioLoadingStatus({ loaded: i, total: audioFiles.length, current: f.name });
      const url = URL.createObjectURL(f);
      let dur = 0;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const buf = await f.slice().arrayBuffer();
        const decoded = await ctx.decodeAudioData(buf);
        dur = decoded.duration;
        ctx.close();
      } catch { /* fallback */ }
      const title = f.name.replace(/\.[^.]+$/, "");
      // Add each track immediately so it appears in the table as it loads
      setExportedTracks(prev => [...prev, { title, name: f.name, start: 0, end: dur, url, file: f }]);
    }
    setAudioLoadingStatus(null);
  };

  // Handle drop of mixed audio + image files in step 5
  const handleDirectFileDrop = async (files) => {
    const allFiles = Array.from(files || []);
    const audioFiles = allFiles.filter(f => f.type.startsWith("audio/"));
    const imageFiles = allFiles.filter(f => f.type.startsWith("image/"));
    if (audioFiles.length > 0) await addDirectAudioFiles(audioFiles);
    if (imageFiles.length > 0) await addImagesToVideo(imageFiles);
  };

  const toggleVideoImage = (id) => {
    setSelectedVideoImages(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const updateVideoImage = (id, key, value) => {
    setVideoImages(prev => prev.map(img => img.id === id ? { ...img, [key]: value } : img));
  };

  const removeVideoImage = (id) => {
    setVideoImages(prev => {
      const target = prev.find(i => i.id === id);
      if (target?.thumbUrl) URL.revokeObjectURL(target.thumbUrl);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(i => i.id !== id);
    });
    setSelectedVideoImages(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const toggleVideoAudio = (idx) => {
    setSelectedVideoAudios(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const getOrderedAudios = () => {
    const order = videoAudioOrder.length === exportedTracks.length ? videoAudioOrder : exportedTracks.map((_, i) => i);
    return order.filter(i => selectedVideoAudios.has(i)).map(i => exportedTracks[i]).filter(Boolean);
  };

  const getEffectiveImageTimings = () => {
    const orderedAudios = getOrderedAudios();
    const totalDur = orderedAudios.reduce((s, t) => s + (t.end - t.start), 0);
    const selectedImgs = videoImages.filter(img => selectedVideoImages.has(img.id));
    if (selectedImgs.length === 0 || totalDur === 0) return [];

    if (slideshowMode === "distribute") {
      // Distribute images evenly across the total duration
      const dur = totalDur / selectedImgs.length;
      return selectedImgs.map((img, i) => ({ id: img.id, startTime: i * dur, endTime: (i + 1) * dur }));
    }

    if (slideshowMode === "loop") {
      // Loop images every N seconds, repeating as needed to fill the duration
      const interval = Math.max(1, loopInterval);
      const timings = [];
      let t = 0;
      let idx = 0;
      while (t < totalDur) {
        const end = Math.min(t + interval, totalDur);
        const img = selectedImgs[idx % selectedImgs.length];
        timings.push({ id: img.id, startTime: t, endTime: end });
        t = end;
        idx++;
      }
      return timings;
    }

    if (slideshowMode === "per-track") {
      // Sync image transitions with audio track transitions
      const timings = [];
      let cumTime = 0;
      orderedAudios.forEach((audio, i) => {
        const dur = audio.end - audio.start;
        const img = selectedImgs[i % selectedImgs.length];
        timings.push({ id: img.id, startTime: cumTime, endTime: cumTime + dur });
        cumTime += dur;
      });
      return timings;
    }

    // "manual" — user-defined start/end times with fallback to even distribution
    const dur = totalDur / selectedImgs.length;
    return selectedImgs.map((img, i) => ({
      id: img.id,
      startTime: manualImageTimings[img.id]?.startTime ?? i * dur,
      endTime: manualImageTimings[img.id]?.endTime ?? (i + 1) * dur,
    }));
  };

  // Drag-and-drop reorder for audio table
  const handleAudioDragStart = (orderIdx) => { audioDragRef.current = orderIdx; };
  const handleAudioDragOver = (e, orderIdx) => {
    e.preventDefault();
    if (audioDragRef.current === null || audioDragRef.current === orderIdx) return;
    const order = [...(videoAudioOrder.length === exportedTracks.length ? videoAudioOrder : exportedTracks.map((_, i) => i))];
    const [moved] = order.splice(audioDragRef.current, 1);
    order.splice(orderIdx, 0, moved);
    audioDragRef.current = orderIdx;
    setVideoAudioOrder(order);
  };
  const handleAudioDragEnd = () => { audioDragRef.current = null; };

  // Drag-and-drop reorder for images table
  const handleImageDragStart = (imgIdx) => { imageDragRef.current = imgIdx; };
  const handleImageDragOver = (e, imgIdx) => {
    e.preventDefault();
    if (imageDragRef.current === null || imageDragRef.current === imgIdx) return;
    const imgs = [...videoImages];
    const [moved] = imgs.splice(imageDragRef.current, 1);
    imgs.splice(imgIdx, 0, moved);
    imageDragRef.current = imgIdx;
    setVideoImages(imgs);
  };
  const handleImageDragEnd = () => { imageDragRef.current = null; };

  const toggleImgPreview = (id) => {
    setExpandedImgPreviews(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const fetchDiscogsImage = async () => {
    const images = discogsData?.images;
    if (!images?.length) { setMessage("No Discogs images available"); return; }
    const total = images.length;
    setDiscogsArtStatus({ loaded: 0, total, current: "Starting…", images: [] });
    const fetchedFiles = [];
    for (let i = 0; i < total; i++) {
      const url = images[i].uri || images[i].uri150;
      if (!url) continue;
      const label = `Image ${i + 1}/${total}`;
      setDiscogsArtStatus(prev => ({ ...prev, loaded: i, current: `Fetching ${label}…` }));
      try {
        const proxyUrl = `${apiBaseURL()}/discogs/image-proxy?url=${encodeURIComponent(url)}`;
        const blob = await fetch(proxyUrl).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); });
        const ext = (blob.type || "image/jpeg").split("/")[1] || "jpg";
        const file = new File([blob], `discogs-art-${i + 1}.${ext}`, { type: blob.type || "image/jpeg" });
        fetchedFiles.push(file);
      } catch (err) {
        setDiscogsArtStatus(prev => ({ ...prev, current: `Failed ${label}: ${err.message}` }));
      }
    }
    setDiscogsArtStatus(prev => ({ ...prev, loaded: total, current: `Adding ${fetchedFiles.length} image(s)…` }));
    if (fetchedFiles.length > 0) {
      await addImagesToVideo(fetchedFiles);
      setMessage(`${fetchedFiles.length} Discogs image(s) added`);
    } else {
      setMessage("Could not fetch any Discogs images (CORS?). Upload manually.");
    }
    setDiscogsArtStatus(null);
  };

  // ---- Video Resolution helpers ----
  const VIDEO_PRESETS = [
    { group: "Landscape (16:9)", presets: [
      { label: "4K", w: 3840, h: 2160, icon: "landscape" },
      { label: "1440p", w: 2560, h: 1440, icon: "landscape" },
      { label: "1080p", w: 1920, h: 1080, icon: "landscape" },
      { label: "720p", w: 1280, h: 720, icon: "landscape" },
      { label: "480p", w: 854, h: 480, icon: "landscape" },
      { label: "360p", w: 640, h: 360, icon: "landscape" },
      { label: "240p", w: 426, h: 240, icon: "landscape" },
    ]},
    { group: "Portrait (9:16)", presets: [
      { label: "1080p", w: 1080, h: 1920, icon: "portrait" },
      { label: "720p", w: 720, h: 1280, icon: "portrait" },
    ]},
    { group: "Square (1:1)", presets: [
      { label: "1080p", w: 1080, h: 1080, icon: "square" },
      { label: "720p", w: 720, h: 720, icon: "square" },
    ]},
  ];

  const applyImageResolution = (img) => {
    const url = URL.createObjectURL(img.file);
    const image = new Image();
    image.onload = () => {
      setVideoWidth(String(image.naturalWidth));
      setVideoHeight(String(image.naturalHeight));
      URL.revokeObjectURL(url);
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  };

  // YouTube API upload limit: 256 GB (practically limited by our server's 2GB multer limit)
  const YT_UPLOAD_LIMIT_MB = 2048; // server multer limit
  const YT_MAX_DURATION_SEC = 12 * 60 * 60; // 12 hours

  const estimateVideoSize = () => {
    const w = parseInt(videoWidth) || 1920, h = parseInt(videoHeight) || 1080;
    const audios = exportedTracks.filter((_, i) => selectedVideoAudios.has(i));
    const totalDur = audios.reduce((s, t) => s + (t.end - t.start), 0);
    if (totalDur <= 0) return null;
    // Rough estimate: CRF 18 stillimage ≈ 0.05-0.15 bits/pixel/frame at 2fps + AAC 320k audio
    const pixelsPerFrame = w * h;
    const bitsPerPixelPerFrame = 0.1; // conservative for stillimage
    const videoBitsPerSec = pixelsPerFrame * bitsPerPixelPerFrame * 2; // 2fps
    const audioBitsPerSec = 320 * 1000; // 320kbps AAC
    const totalBits = (videoBitsPerSec + audioBitsPerSec) * totalDur;
    const totalMB = totalBits / (8 * 1024 * 1024);
    return { totalMB, totalDur, overLimit: totalMB > YT_UPLOAD_LIMIT_MB, nearLimit: totalMB > YT_UPLOAD_LIMIT_MB * 0.8, overDuration: totalDur > YT_MAX_DURATION_SEC };
  };

  const formatEta = () => {
    if (!videoRenderStartTime || !videoRenderProgress || videoRenderProgress <= 0.01) return null;
    const elapsed = (Date.now() - videoRenderStartTime) / 1000;
    const total = elapsed / videoRenderProgress;
    const remaining = Math.max(0, total - elapsed);
    if (remaining < 2) return "almost done";
    if (remaining < 60) return `~${Math.round(remaining)}s remaining`;
    return `~${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s remaining`;
  };

  // ---- Video Render ----
  const renderAlbumVideo = async () => {
    const selectedAudioList = getOrderedAudios();
    const selectedImageList = videoImages.filter(img => selectedVideoImages.has(img.id));
    const effectiveTimings = getEffectiveImageTimings();
    if (selectedImageList.length === 0 || selectedAudioList.length === 0) return;
    setIsRenderingVideo(true); setVideoRenderProgress(0);
    setVideoRenderStartTime(Date.now());
    setVideoRenderLogs(["Starting FFmpeg…"]);
    setShowVideoLogs(true);
    const appendVideoLog = (line) => setVideoRenderLogs(prev => { const next = [...prev, line]; return next.length > 300 ? next.slice(-300) : next; });
    const name = (videoOutputName || projectName || "album").replace(/[^a-zA-Z0-9 _\-]/g, "").trim().replace(/\s+/g, "_") || "album";
    const totalDur = selectedAudioList.reduce((s, t) => s + (t.end - t.start), 0);
    try {
      const ffV = new FFmpeg();
      videoFfmpegRef.current = ffV;
      ffV.on("log", ({ message: msg }) => {
        appendVideoLog(msg);
        // Parse time= from FFmpeg log for accurate 0–1 progress (progress event overshoots)
        const m = msg.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (m && totalDur > 0) {
          const elapsed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          setVideoRenderProgress(Math.min(1, elapsed / totalDur));
        }
      });
      const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
      await ffV.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });

      appendVideoLog(`Writing ${selectedAudioList.length} audio + ${selectedImageList.length} image file(s)…`);

      // Write audio files — use sanitized names for ffmpeg VFS
      const audioVfsNames = [];
      for (let i = 0; i < selectedAudioList.length; i++) {
        const t = selectedAudioList[i];
        const ext = (t.name || t.file?.name || "audio").split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "wav";
        const vfsName = `audio${i}.${ext}`;
        audioVfsNames.push(vfsName);
        const blob = t.file ? t.file : await (await fetch(t.url)).blob();
        await ffV.writeFile(vfsName, await fetchFile(blob));
      }

      // Write image files
      for (let i = 0; i < selectedImageList.length; i++) {
        const ext = selectedImageList[i].file.name.split(".").pop() || "jpg";
        await ffV.writeFile(`img${i}.${ext}`, await fetchFile(selectedImageList[i].file));
      }

      const w = parseInt(videoWidth) || 1920, h = parseInt(videoHeight) || 1080;
      const n = selectedAudioList.length;
      const args = ["-y"];

      // Audio inputs
      for (const vfsName of audioVfsNames) args.push("-i", vfsName);

      // Image inputs (at 2fps)
      for (let i = 0; i < selectedImageList.length; i++) {
        const ext = selectedImageList[i].file.name.split(".").pop() || "jpg";
        args.push("-r", "2", "-i", `img${i}.${ext}`);
      }

      // Filter complex
      let fc = "";
      if (n > 1) {
        fc += selectedAudioList.map((_, i) => `[${i}:a]`).join("") + `concat=n=${n}:v=0:a=1[a];`;
      } else {
        fc += `[0:a]acopy[a];`;
      }

      for (let i = 0; i < selectedImageList.length; i++) {
        const imgIdx = n + i;
        const imgDuration = effectiveTimings[i] ? effectiveTimings[i].endTime - effectiveTimings[i].startTime : totalDur / selectedImageList.length;
        const loop = Math.max(1, Math.round(imgDuration * 2));
        const img = selectedImageList[i];
        const bgHex = (img.paddingColor || videoBgColor).replace("#", "0x");
        if (img.useBlurBg) {
          fc += `[${imgIdx}:v]scale=w=${w}:h=${h}:force_original_aspect_ratio=increase,boxblur=20:20,crop=${w}:${h}:(iw-${w})/2:(ih-${h})/2,setsar=1[bg${i}];`;
          fc += `[${imgIdx}:v]scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease,setsar=1,loop=${loop}:${loop}[fg${i}];`;
          fc += `[bg${i}][fg${i}]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1,loop=${loop}:${loop}[v${i}];`;
        } else {
          const scale = img.stretchToFit ? `scale=w=${w}:h=${h}` : `scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease`;
          const pad = img.stretchToFit ? "" : `,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${bgHex}`;
          fc += `[${imgIdx}:v]${scale}${pad},setsar=1,loop=${loop}:${loop}[v${i}];`;
        }
      }
      appendVideoLog(`Running FFmpeg (${w}×${h}, ${Math.ceil(totalDur)}s)…`);
      fc += selectedImageList.map((_, i) => `[v${i}]`).join("") + `concat=n=${selectedImageList.length}:v=1:a=0,pad=ceil(iw/2)*2:ceil(ih/2)*2[v]`;

      await ffV.exec([
        ...args,
        "-filter_complex", fc,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-tune", "stillimage", "-crf", "18",
        "-c:a", "aac", "-b:a", "320k",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-t", String(Math.ceil(totalDur)),
        `${name}.mp4`
      ]);

      const data = await ffV.readFile(`${name}.mp4`);
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      if (renderedVideoSrc) URL.revokeObjectURL(renderedVideoSrc);
      const renderedUrl = URL.createObjectURL(blob);
      setRenderedVideoSrc(renderedUrl);

      // Pre-fill YouTube metadata using shared utilities
      const titleSuggestions = generateVideoTitleRecommendations(discogsData, ytTitleVariation);
      setYtTitleSuggestions(titleSuggestions);
      const autoTitle = titleSuggestions[0] || name;

      const trackTimestamps = selectedAudioList.map((t, i) => ({
        title: t.title,
        startOffset: i === 0 ? 0 : selectedAudioList.slice(0, i).reduce((s, x) => s + (x.end - x.start), 0),
      }));
      const autoDesc = buildTimestampDescription(trackTimestamps, {
        timestampFormat: ytTimestampFormat,
        separator: ytTimestampSeparator,
        includeTrackNumbers: ytIncludeTrackNums,
        suffix: ytDescSuffix,
      });

      const extractedTags = extractTagsFromDiscogs(discogsData);
      const defaultFilters = { artists: { enabled: true, sliderValue: 100 }, album: { enabled: true, sliderValue: 100 }, tracklist: { enabled: true, sliderValue: 100 }, combinations: { enabled: true, sliderValue: 100 }, credits: { enabled: false, sliderValue: 100 }, filenames: { enabled: false, sliderValue: 100 } };
      const autoTags = buildTagString(extractedTags, defaultFilters);

      setYtUploadData(prev => ({
        ...prev,
        title: prev.title || autoTitle.slice(0, YT_LIMITS.title),
        description: prev.description || autoDesc.slice(0, YT_LIMITS.description),
        tags: prev.tags || autoTags.slice(0, YT_LIMITS.tags),
      }));
      appendVideoLog("✓ Done!");
      setMessage("Video rendered!");

      // Auto-upload to YouTube if checkbox was checked
      if (autoUploadYtRef.current) {
        appendVideoLog("Starting YouTube upload…");
        setTimeout(() => uploadToYouTube(renderedUrl), 500);
      }
    } catch (err) {
      setVideoRenderLogs(prev => [...prev, `ERROR: ${err.message}`]);
      setMessage("Video render error: " + err.message);
    }
    finally { setIsRenderingVideo(false); setVideoRenderProgress(null); setVideoRenderStartTime(null); }
  };

  // ---- YouTube Upload ----
  const uploadToYouTube = async (videoUrlOverride) => {
    const videoUrl = videoUrlOverride || renderedVideoSrc;
    if (!videoUrl || ytUploading) return;
    setYtUploading(true); setYtUploadProgress(0); setYtUploadError(""); setYtUploadResult(null);
    try {
      const tokens = await getTokensRef.current?.getTokens();
      if (!tokens) { setYtUploadError("Not signed in to YouTube."); setYtUploading(false); return; }
      const currentYtData = ytUploadDataRef.current;
      const name = (videoOutputName || projectName || "album").replace(/[^a-zA-Z0-9 _\-]/g, "").trim().replace(/\s+/g, "_");
      const videoBlob = await fetch(videoUrl).then(r => r.blob());
      const fd = new FormData();
      fd.append("video", videoBlob, `${currentYtData.title || name}.mp4`);
      fd.append("title", currentYtData.title || name);
      fd.append("description", currentYtData.description || "");
      fd.append("privacyStatus", currentYtData.privacyStatus || "private");
      fd.append("tags", currentYtData.tags || "");
      fd.append("tokens", JSON.stringify(tokens));
      if (thumbnailFile) fd.append("thumbnail", thumbnailFile, thumbnailFile.name);
      const fileSizeMB = (videoBlob.size / (1024 * 1024)).toFixed(1);
      const maxSizeMB = 2048; // 2 GB server limit
      if (videoBlob.size > maxSizeMB * 1024 * 1024) {
        setYtUploadError(`Video file is ${fileSizeMB} MB — exceeds the ${maxSizeMB} MB upload limit. Try a lower resolution or shorter duration.`);
        setYtUploading(false);
        return;
      }
      await new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${apiBaseURL()}/youtube/uploadVideo`);
        xhr.withCredentials = true;
        xhr.upload.onprogress = e => { if (e.lengthComputable) setYtUploadProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) setYtUploadResult(data);
            else {
              let errMsg = data.error || `Upload failed (${xhr.status})`;
              if (xhr.status === 413) errMsg = `File too large (${fileSizeMB} MB). Maximum upload size is ${maxSizeMB} MB. Try a lower resolution.`;
              else if (/invalid.*title|empty.*title/i.test(errMsg)) errMsg += " — Try shortening the title (max 100 characters).";
              else if (/description/i.test(errMsg)) errMsg += " — Try shortening the description (max 5,000 characters).";
              else if (/tag/i.test(errMsg)) errMsg += " — Try reducing tags (max 500 characters total, each tag max 30 chars).";
              setYtUploadError(errMsg);
            }
          } catch { setYtUploadError(`Failed to parse server response (HTTP ${xhr.status})`); }
          resolve();
        };
        xhr.onerror = () => { setYtUploadError(`Network error uploading ${fileSizeMB} MB video. Check your connection and try again.`); resolve(); };
        xhr.send(fd);
      });
    } catch (err) { setYtUploadError(err.message || "Upload failed"); }
    finally { setYtUploading(false); setYtUploadProgress(null); }
  };

  // Regenerate YouTube metadata when format options change
  const regenerateYtMetadata = useCallback(() => {
    const order = videoAudioOrder.length === exportedTracks.length ? videoAudioOrder : exportedTracks.map((_, i) => i);
    const audioList = order.filter(i => selectedVideoAudios.has(i)).map(i => exportedTracks[i]).filter(Boolean);
    if (!audioList.length) return;

    const trackTimestamps = audioList.map((t, i) => ({
      title: t.title,
      startOffset: i === 0 ? 0 : audioList.slice(0, i).reduce((s, x) => s + (x.end - x.start), 0),
    }));
    const desc = buildTimestampDescription(trackTimestamps, {
      timestampFormat: ytTimestampFormat,
      separator: ytTimestampSeparator,
      includeTrackNumbers: ytIncludeTrackNums,
      suffix: ytDescSuffix,
    });
    setYtUploadData(prev => ({ ...prev, description: desc.slice(0, YT_LIMITS.description) }));
  }, [ytTimestampFormat, ytTimestampSeparator, ytIncludeTrackNums, ytDescSuffix, exportedTracks, selectedVideoAudios, videoAudioOrder]);

  const regenerateYtTitle = (variation) => {
    const suggestions = generateVideoTitleRecommendations(discogsData, variation);
    setYtTitleSuggestions(suggestions);
    if (suggestions[0]) setYtUploadData(prev => ({ ...prev, title: suggestions[0].slice(0, YT_LIMITS.title) }));
  };

  const regenerateYtTags = () => {
    const extracted = extractTagsFromDiscogs(discogsData);
    const filters = { artists: { enabled: true, sliderValue: 100 }, album: { enabled: true, sliderValue: 100 }, tracklist: { enabled: true, sliderValue: 100 }, combinations: { enabled: true, sliderValue: 100 }, credits: { enabled: false, sliderValue: 100 }, filenames: { enabled: false, sliderValue: 100 } };
    const tags = buildTagString(extracted, filters);
    setYtUploadData(prev => ({ ...prev, tags: tags.slice(0, YT_LIMITS.tags) }));
  };

  // Track last discogs URL used to generate YouTube metadata
  const lastYtDiscogsUrlRef = useRef(null);

  // Pre-fill YouTube metadata when entering Step 6 or when discogs data changes
  useEffect(() => {
    if (step !== 6) return;
    const discogsChanged = discogsData && discogsUrl && lastYtDiscogsUrlRef.current !== discogsUrl;
    const needsTitle = !ytUploadData.title || discogsChanged;
    const needsDesc = !ytUploadData.description || discogsChanged;
    const needsTags = !ytUploadData.tags || discogsChanged;

    if (discogsChanged) lastYtDiscogsUrlRef.current = discogsUrl;

    if (needsTitle && discogsData) {
      const suggestions = generateVideoTitleRecommendations(discogsData, ytTitleVariation);
      setYtTitleSuggestions(suggestions);
      if (suggestions[0]) {
        setYtUploadData(prev => ({ ...prev, title: suggestions[0].slice(0, YT_LIMITS.title) }));
      }
    }
    if (needsDesc) {
      const audioList = getOrderedAudios();
      if (audioList.length > 0) {
        const trackTimestamps = audioList.map((t, i) => ({
          title: t.title,
          startOffset: i === 0 ? 0 : audioList.slice(0, i).reduce((s, x) => s + (x.end - x.start), 0),
        }));
        const desc = buildTimestampDescription(trackTimestamps, {
          timestampFormat: ytTimestampFormat,
          separator: ytTimestampSeparator,
          includeTrackNumbers: ytIncludeTrackNums,
          suffix: ytDescSuffix,
        });
        setYtUploadData(prev => ({ ...prev, description: desc.slice(0, YT_LIMITS.description) }));
      }
    }
    if (needsTags && discogsData) regenerateYtTags();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, discogsData]);

  // ---- Derived ----
  const canGoStep2 = !!audioFile;
  const canGoStep3 = !!audioFile && (parseInt(manualTrackCount) > 0 || (discogsData?.tracklist?.length > 0));
  const canExport = tracks.length > 0 && !!audioFile;

  if (!mounted) return null;

  return (
    <div className={styles.page} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className={styles.vinylIcon}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
            </svg>
            <h1 className={styles.title}>Vinyl Digitizer</h1>
          </div>
          <p className={styles.subtitle}>Record or upload vinyl audio → detect tracks → export with Discogs metadata</p>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.projectNameWrap}>
            <label className={styles.projectNameLabel}>Project Title</label>
            <input className={styles.projectNameInput} value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Project name…" />
          </div>
          <button className={styles.historyBtn} onClick={() => setShowHistory(v => !v)}>
            📚 History {projects.length > 0 && <span className={styles.historyBadge}>{projects.length}</span>}
          </button>
        </div>
      </div>

      {/* Steps — sticky when rendering/uploading */}
      <div className={`${styles.stepBarWrap} ${(isRenderingVideo || ytUploading) ? styles.stepBarSticky : ""}`}>
        <div className={styles.stepBar}>
          {["Audio Source", "Album Info", "Waveform & Markers", "Audio Export", "Video Render", "YouTube Upload"].map((label, i) => (
            <div key={i} className={`${styles.stepItem} ${step === i + 1 ? styles.stepActive : ""} ${step > i + 1 ? styles.stepDone : ""}`}
              onClick={() => setStep(i + 1)}
              style={{ cursor: "pointer" }}
            >
              <div className={styles.stepCircle}>{step > i + 1 ? "✓" : i + 1}</div>
              <span className={styles.stepLabel}>{label}</span>
              {i === 4 && isRenderingVideo && (
                <span className={styles.stepProgress}>{videoRenderProgress !== null ? ` ${(videoRenderProgress * 100).toFixed(0)}%` : " …"}</span>
              )}
              {i < 5 && <div className={styles.stepLine} />}
            </div>
          ))}
        </div>
        {(isRenderingVideo || ytUploading) && (
          <div className={styles.renderingWarningBanner}>
            ⚠️ WARNING: {isRenderingVideo ? `Video is rendering${videoRenderProgress !== null ? ` (${(videoRenderProgress * 100).toFixed(0)}%)` : ""}` : `Video is uploading${ytUploadProgress !== null ? ` (${ytUploadProgress}%)` : ""}`} — do not navigate away from this page!
          </div>
        )}
        {ytUploadError && !ytUploading && (
          <div className={styles.renderingWarningBanner} style={{animation:"none"}}>
            Upload Error: {ytUploadError}
          </div>
        )}
      </div>

      <div className={styles.body}>
        <div className={`${styles.main} ${showHistory ? styles.mainShifted : ""}`}>

          {/* ---- STEP 1 ---- */}
          {step === 1 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Step 1: Audio Source</h2>
              <div className={styles.tabRow}>
                <button className={`${styles.tab} ${audioMode === "upload" ? styles.tabActive : ""}`} onClick={() => setAudioMode("upload")}>Upload File</button>
                <button className={`${styles.tab} ${audioMode === "record" ? styles.tabActive : ""}`} onClick={() => setAudioMode("record")}>Record Live</button>
              </div>

              {audioMode === "upload" ? (
                <div>
                  <div className={styles.dropZone} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
                    <div className={styles.dropIcon}>🎵</div>
                    <p className={styles.dropText}>Drop audio file here or click to browse</p>
                    <p className={styles.dropHint}>WAV · FLAC · MP3 · AIFF · OGG · WebM</p>
                    <input type="file" accept="audio/*" onChange={handleFileInput} className={styles.fileInput} />
                  </div>
                </div>
              ) : (
                <div className={styles.recordPanel}>
                  <div className={styles.vuOuter}><div className={styles.vuInner} style={{ width: `${recordingLevel * 100}%`, background: recordingLevel > 0.8 ? "#fc8181" : recordingLevel > 0.5 ? "#f6e05e" : "#68d391" }} /></div>
                  <div className={styles.recordControls}>
                    {!isRecording ? (
                      <button className={styles.recordBtn} onClick={startRecording}><span className={styles.recDot} />Start Recording</button>
                    ) : (
                      <>
                        <span className={styles.recLive}><span className={styles.recDotLive} />REC</span>
                        <span className={styles.recTime}>{formatTime(recordingTime)}</span>
                        <button className={styles.stopBtn} onClick={stopRecording}>⏹ Stop</button>
                      </>
                    )}
                  </div>
                  {isRecording && <p className={styles.recHint}>Recording using AudioWorklet pipeline via MediaRecorder API</p>}
                </div>
              )}

              {audioFile && !isRecording && (
                <div className={styles.fileInfo}>
                  <span>✅ {audioFile.name}</span>
                  <span>{formatBytes(audioFile.size)}</span>
                  {duration > 0 && <span>⏱ {formatTime(duration)}</span>}
                  {channelData && <span className={styles.fileInfoReady}>Ready</span>}
                </div>
              )}
              {message && <p className={styles.msg}>{message}</p>}

              {/* YouTube sign-in (optional, for upload later) */}
              <div style={{ marginTop: 16, padding: '12px 16px', border: `1px solid ${darkMode ? '#444' : '#e2e8f0'}`, borderRadius: 8, background: darkMode ? '#252538' : '#f8f9fa' }}>
                <p style={{ margin: '0 0 8px 0', fontSize: 13, color: darkMode ? '#ffffff' : '#000000' }}>
                  Sign in now if you want to upload to YouTube later.
                </p>
                <YouTubeAuth compact={true} returnUrl="/vinyl-digitizer" darkMode={darkMode} getTokensRef={getTokensRef} onAuthStateChange={setYtAuthState} />
              </div>

              <div className={styles.stepNav}>
                <button className={styles.nextBtn} disabled={!canGoStep2} onClick={() => setStep(2)}>Next: Album Info →</button>
                {canGoStep2 && <button className={styles.skipBtn} onClick={() => setStep(5)}>Skip to Video Render →→</button>}
                {canGoStep2 && <button className={styles.skipBtn} onClick={() => setStep(6)}>Skip to YouTube Upload →→</button>}
                {audioFile && <button className={styles.skipBtn} onClick={() => resetStep(1)}>Clear Audio</button>}
                <button className={styles.skipBtn} onClick={resetAll}>Start Over</button>
              </div>
            </div>
          )}

          {/* ---- STEP 2 ---- */}
          {step === 2 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Step 2: Album Info</h2>
              <div className={styles.discogsRow}>
                <div className={styles.discogsModeRow}>
                  <button className={`${styles.tab} ${discogsInputMode === "url" ? styles.tabActive : ""}`} onClick={() => setDiscogsInputMode("url")}>By URL</button>
                  <button className={`${styles.tab} ${discogsInputMode === "search" ? styles.tabActive : ""}`} onClick={() => setDiscogsInputMode("search")}>Search</button>
                </div>
                {discogsInputMode === "url" ? (
                  <>
                    <label className={styles.label}>Discogs Release URL <span className={styles.labelHint}>(optional — for metadata)</span></label>
                    <div className={styles.inputWithBtn}>
                      <input type="url" className={styles.input} placeholder="https://www.discogs.com/release/12345" value={discogsUrl} onChange={e => setDiscogsUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchDiscogs()} />
                      <button className={styles.fetchBtn} onClick={fetchDiscogs} disabled={isFetchingDiscogs || !discogsUrl}>{isFetchingDiscogs ? "…" : "Fetch"}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className={styles.label}>Search Discogs <span className={styles.labelHint}>(artist, album, year…)</span></label>
                    <div className={styles.inputWithBtn}>
                      <input type="text" className={styles.input} placeholder="e.g. Pink Floyd Dark Side of the Moon" value={discogsSearchQuery} onChange={e => setDiscogsSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && searchDiscogs()} />
                      <button className={styles.fetchBtn} onClick={searchDiscogs} disabled={isSearching || !discogsSearchQuery}>{isSearching ? "…" : "Search"}</button>
                    </div>
                    {discogsSearchResults.length > 0 && (
                      <div className={styles.searchResults}>
                        {discogsSearchResults.map(r => (
                          <div key={r.id} className={styles.searchResultItem} onClick={() => selectSearchResult(r)}>
                            {r.cover_image && r.cover_image !== "https://st.discogs.com/8a57a599c3a6b4bd0e3d1b8a4b98fef48d977b07/images/b-placeholder-r.jpg" && (
                              <img src={r.thumb || r.cover_image} alt="" className={styles.searchThumb} />
                            )}
                            <div className={styles.searchResultInfo}>
                              <span className={styles.searchResultTitle}>{r.title}</span>
                              <span className={styles.searchResultMeta}>{r.year}{r.label?.length ? ` · ${r.label[0]}` : ""}{r.country ? ` · ${r.country}` : ""}</span>
                            </div>
                            {isFetchingDiscogs && <span className={styles.searchLoading}>…</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {(discogsError || discogsSearchError) && <p className={styles.errorMsg}>{discogsError || discogsSearchError}</p>}
              </div>

              {discogsData && (
                <div className={styles.discogsCard}>
                  <div className={styles.discogsTop}>
                    {discogsData.images?.[0]
                      ? <img src={discogsData.images[0].uri150} alt="art" className={styles.albumArt} />
                      : <div className={styles.noArtBox} title="This release has no images on Discogs">No images<br/>on this release</div>
                    }
                    <div className={styles.discogsInfo}>
                      <h3 className={styles.albumTitle}>{discogsData.title}</h3>
                      <p>{discogsData.artists?.map(a => a.name).join(", ")}</p>
                      <p className={styles.discogsMetaLine}>{discogsData.year} {discogsData.genres?.length ? `· ${discogsData.genres.join(", ")}` : ""}</p>
                      <p className={styles.discogsMetaLine}>{discogsData.labels?.map(l => l.name).join(", ")}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tracklist editor — works with or without Discogs */}
              <div className={styles.tracklistEditor}>
                {!discogsData && <p className={styles.orLine}>No Discogs data — enter tracks manually</p>}
                <div className={styles.tracklistHeader}>
                  <h4 className={styles.tracklistTitle}>Tracklist</h4>
                  <div className={styles.trackCountRow}>
                    <label className={styles.trackCountLabel}>Tracks:</label>
                    <input type="number" className={styles.inputSmall} min="1" max="100" value={manualTrackCount || (discogsData?.tracklist?.length ?? "")} onChange={e => {
                      const val = e.target.value;
                      setManualTrackCount(val);
                      const n = parseInt(val);
                      if (n > 0) {
                        setTrackNames(prev => Array.from({ length: n }, (_, i) => prev[i] ?? discogsData?.tracklist?.[i]?.title ?? `Track ${i + 1}`));
                        if (discogsData) {
                          setDiscogsData(prev => ({
                            ...prev,
                            tracklist: Array.from({ length: n }, (_, i) => prev.tracklist[i] || { position: `${i + 1}`, title: `Track ${i + 1}`, duration: "" })
                          }));
                        }
                      }
                    }} />
                    <button className={styles.trackAddBtn} onClick={() => {
                      const count = parseInt(manualTrackCount) || discogsData?.tracklist?.length || 0;
                      const newCount = count + 1;
                      setManualTrackCount(String(newCount));
                      setTrackNames(prev => [...Array.from({ length: count }, (_, i) => prev[i] ?? `Track ${i + 1}`), `Track ${newCount}`]);
                      if (discogsData) {
                        setDiscogsData(prev => ({
                          ...prev,
                          tracklist: [...(prev.tracklist || []), { position: `${newCount}`, title: `Track ${newCount}`, duration: "" }]
                        }));
                      }
                    }}>+ Add Track</button>
                  </div>
                </div>
                {(() => {
                  const count = parseInt(manualTrackCount) || discogsData?.tracklist?.length || 0;
                  if (count <= 0) return null;
                  return (
                    <div className={styles.tracklist}>
                      {Array.from({ length: count }, (_, i) => {
                        const discogsTrack = discogsData?.tracklist?.[i];
                        return (
                          <div key={i} className={styles.trackRow}>
                            <span className={styles.trackPos}>{discogsTrack?.position || i + 1}</span>
                            <input className={styles.trackNameInput} value={trackNames[i] ?? discogsTrack?.title ?? `Track ${i + 1}`} onChange={e => { const n = [...trackNames]; n[i] = e.target.value; setTrackNames(n); }} />
                            {discogsTrack?.duration && <span className={styles.trackDur}>{discogsTrack.duration}</span>}
                            {count > 1 && (
                              <button className={styles.trackRemoveBtn} title="Remove track" onClick={() => {
                                const newCount = count - 1;
                                setManualTrackCount(String(newCount));
                                setTrackNames(prev => { const n = [...prev]; n.splice(i, 1); return n; });
                                if (discogsData) {
                                  setDiscogsData(prev => {
                                    const tl = [...(prev.tracklist || [])];
                                    tl.splice(i, 1);
                                    return { ...prev, tracklist: tl };
                                  });
                                }
                              }}>×</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              <div className={styles.stepNav}>
                <button className={styles.backBtn} onClick={() => setStep(1)}>← Back</button>
                <button className={styles.nextBtn} disabled={!canGoStep3} onClick={() => setStep(3)}>Next: Waveform Editor →</button>
                {canGoStep2 && <button className={styles.skipBtn} onClick={() => setStep(5)}>Skip to Video Render →→</button>}
                {canGoStep2 && <button className={styles.skipBtn} onClick={() => setStep(6)}>Skip to YouTube Upload →→</button>}
                <button className={styles.skipBtn} onClick={() => resetStep(2)}>Clear Album Info</button>
                <button className={styles.skipBtn} onClick={resetAll}>Start Over</button>
              </div>
            </div>
          )}

          {/* ---- STEP 3 ---- (always mounted to preserve waveform) */}
          <div className={styles.card} style={{ display: step === 3 ? undefined : "none" }}>
              <h2 className={styles.cardTitle}>Step 3: Waveform &amp; Markers</h2>

              {/* Toolbar */}
              <div className={styles.waveToolbar}>
                <div className={styles.tbGroup}>
                  <button className={styles.playBtnSmall} onClick={togglePlay} disabled={!duration}>{isPlaying ? "⏸" : "▶"}</button>
                  <span className={styles.timeLabel}>{formatTime(currentTime)} / {formatTime(duration)}</span>
                </div>
                <div className={styles.tbSep} />
                <div className={styles.tbGroup}>
                  <span className={styles.tbGroupLabel}>Zoom</span>
                  <button className={styles.tbBtn} title="Zoom out" onClick={zoomOut}>−</button>
                  <button className={styles.tbBtn} title="Zoom in" onClick={zoomIn}>+</button>
                </div>
                <div className={styles.tbSep} />
                <div className={styles.tbGroup}>
                  <span className={styles.tbGroupLabel}>Vol</span>
                  <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(parseFloat(e.target.value))} className={styles.volSlider} title="Playback volume" />
                </div>
              </div>

              {/* peaks.js Waveform */}
              <div className={styles.waveContainer}>
                {isLoadingWaveform && (
                  <div className={styles.waveLoading}><div className={styles.spinner} /><span>{waveformLoadStatus || "Loading waveform…"}</span></div>
                )}
                <div ref={zoomviewRef} className={styles.zoomview} />
                <div ref={overviewRef} className={styles.overview} />
              </div>

              {/* Auto Split */}
              <div className={styles.autoSplitPanel}>
                <div className={styles.autoSplitRow}>
                  <div className={styles.autoSplitLeft}>
                    <button
                      className={`${styles.autoSplitBtn} ${isAnalyzing ? styles.autoSplitRunning : tracks.length === 0 && !isLoadingWaveform ? styles.autoSplitPulse : ""}`}
                      onClick={detectSilence}
                      disabled={isAnalyzing || !audioFile || isLoadingWaveform}
                    >
                      {isAnalyzing ? (
                        <><span className={styles.spinnerInline} /> Analyzing…</>
                      ) : tracks.length > 0 ? (
                        <>⚡ Update track names</>
                      ) : (
                        <>⚡ Auto-split &amp; name tracks</>
                      )}
                    </button>
                    {isAnalyzing && (
                      <button className={styles.cancelBtn} onClick={() => { cancelRef.current = true; setIsAnalyzing(false); setMessage("Cancelled"); }}>Cancel</button>
                    )}
                  </div>
                  <div className={styles.autoSplitOptions}>
                    <label className={styles.autoSplitCheckLabel}>
                      <input type="checkbox" checked={detectAll} onChange={e => { setDetectAll(e.target.checked); autoSplitDoneRef.current = false; }} />
                      Find all silences
                      <span className={styles.autoSplitCheckHint}>(ignore track count — add/remove manually)</span>
                    </label>
                  </div>
                  <span className={styles.autoSplitHint}>
                    {detectAll
                      ? "Will place a split at every detected silence"
                      : <>Target: <strong>{parseInt(manualTrackCount) || discogsData?.tracklist?.length || "?"}</strong> tracks</>}
                    {tracks.length > 0 && <> · <span className={styles.autoSplitDone}>✓ {tracks.length} tracks</span></>}
                  </span>
                </div>
                <div className={styles.silenceParams}>
                  <label className={styles.silenceParamLabel}>
                    Threshold
                    <input type="number" className={styles.silenceParamInput} value={silThresholdDb} onChange={e => setSilThresholdDb(parseFloat(e.target.value) || -35)} min="-60" max="0" step="1" />
                    <span className={styles.silenceParamUnit}>dB</span>
                  </label>
                  <label className={styles.silenceParamLabel}>
                    Min silence
                    <input type="number" className={styles.silenceParamInput} value={silMinDur} onChange={e => setSilMinDur(parseFloat(e.target.value) || 0.3)} min="0.05" max="5" step="0.05" />
                    <span className={styles.silenceParamUnit}>sec</span>
                  </label>
                  <label className={styles.silenceParamLabel}>
                    Window
                    <input type="number" className={styles.silenceParamInput} value={silWindowMs} onChange={e => setSilWindowMs(parseInt(e.target.value) || 40)} min="10" max="200" step="10" />
                    <span className={styles.silenceParamUnit}>ms</span>
                  </label>
                  <span className={styles.silenceParamHint}>Lower threshold = quieter silence. Increase min silence for fewer splits.</span>
                </div>

                {message && <div className={styles.msgInline}>{message}</div>}
              </div>
              {progress !== null && <div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progress * 100}%` }} /><span className={styles.progressTxt}>{(progress * 100).toFixed(0)}%</span></div>}

              {/* Volume control */}
              <div className={styles.volumeCard}>
                <div className={styles.volumeRow}>
                  <span className={styles.volumeLabel}>Export Volume:</span>
                  <input type="range" className={styles.gainSlider} min="-20" max="20" step="0.5" value={volumeDb} onChange={e => setVolumeDb(parseFloat(e.target.value))} />
                  <input type="number" className={styles.gainInput} min="-20" max="20" step="0.5" value={volumeDb} onChange={e => setVolumeDb(Math.max(-20, Math.min(20, parseFloat(e.target.value) || 0)))} />
                  <span className={styles.gainUnit}>dB</span>
                  {volumeDb !== 0 && <button className={styles.gainReset} onClick={() => setVolumeDb(0)}>Reset</button>}
                </div>
                {volumeSuggestion && (
                  <div className={`${styles.volumeSuggestion} ${volumeSuggestion.suggestedGain > 0 ? styles.volSuggestUp : volumeSuggestion.suggestedGain < 0 ? styles.volSuggestDown : styles.volSuggestOk}`}>
                    {volumeSuggestion.suggestedGain > 0
                      ? `⬆ Audio is quiet (${volumeSuggestion.rmsDb} dBFS RMS). Suggested: +${volumeSuggestion.suggestedGain} dB`
                      : volumeSuggestion.suggestedGain < 0
                      ? `⬇ Audio is loud (${volumeSuggestion.rmsDb} dBFS RMS). Suggested: ${volumeSuggestion.suggestedGain} dB`
                      : `✓ Volume looks good (${volumeSuggestion.rmsDb} dBFS RMS)`}
                    {volumeSuggestion.suggestedGain !== 0 && volumeSuggestion.suggestedGain !== volumeDb && (
                      <button className={styles.volSuggestApply} onClick={() => setVolumeDb(volumeSuggestion.suggestedGain)}>
                        Apply {volumeSuggestion.suggestedGain > 0 ? "+" : ""}{volumeSuggestion.suggestedGain} dB
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Add track button */}
              <button
                className={styles.addTrackBtn}
                onClick={() => {
                  const t = audioRef.current?.currentTime || 0;
                  const id = generateTrackId();
                  const newTrack = {
                    id,
                    startTime: t,
                    endTime: Math.min(t + 10, duration),
                    name: `Track ${tracks.length + 1}`,
                  };
                  const newTracks = [...tracks, newTrack].sort((a, b) => a.startTime - b.startTime);
                  setTracks(newTracks);
                  if (peaksRef.current) {
                    const idx = newTracks.indexOf(newTrack);
                    peaksRef.current.segments.add({
                      id, startTime: newTrack.startTime, endTime: newTrack.endTime,
                      labelText: `${idx + 1}. ${newTrack.name}`, editable: true,
                      color: AUDIO_COLORS[idx % AUDIO_COLORS.length],
                    });
                  }
                  setExportedTracks([]);
                }}
                title="Add a new track at the current playback position"
                style={{ marginTop: 8 }}
              >+ Add Track</button>

              {/* Track list preview */}
              {tracks.length > 0 && (
                <div className={styles.tracklistPreview}>
                  <h3 className={styles.sectionTitle}>Tracklist ({tracks.length} tracks · {formatTime(tracks.reduce((s, t) => s + (t.endTime - t.startTime), 0))} total)</h3>
                  <table className={styles.tracklistTable}>
                    <thead>
                      <tr><th>#</th><th>Name</th><th>Start</th><th>End</th><th>Duration</th></tr>
                    </thead>
                    <tbody>
                      {tracks.map((track, i) => (
                        <tr key={track.id} className={styles.tracklistRow} onClick={() => {
                          if (audioRef.current) { audioRef.current.currentTime = track.startTime; setCurrentTime(track.startTime); }
                        }}>
                          <td>{i + 1}</td>
                          <td>{trackNames[i] || track.name}</td>
                          <td className={styles.tracklistMono}>{formatTime(track.startTime)}</td>
                          <td className={styles.tracklistMono}>{formatTime(track.endTime)}</td>
                          <td className={styles.tracklistMono}>{formatTime(track.endTime - track.startTime)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className={styles.stepNav}>
                <button className={styles.backBtn} onClick={() => setStep(2)}>← Back</button>
                <button className={styles.nextBtn} disabled={!canExport} onClick={() => setStep(4)}>Next: Audio Export →</button>
                <button className={styles.skipBtn} onClick={() => {
                  if (tracks.length === 0 && duration > 0) {
                    const id = `track-full-${Date.now()}`;
                    setTracks([{ id, startTime: 0, endTime: duration, name: trackNames[0] || projectName || "Full Recording" }]);
                    setSelectedTracks(new Set([id]));
                  }
                  setStep(4);
                }}>Skip (Export Full File) →→</button>
                <button className={styles.skipBtn} onClick={() => resetStep(3)}>Clear Markers</button>
                <button className={styles.skipBtn} onClick={resetAll}>Start Over</button>
              </div>
          </div>

          {/* ---- STEP 4 ---- */}
          {step === 4 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Step 4: Audio Export</h2>

              {/* Format */}
              <div className={styles.formatRow}>
                <label className={styles.label}>Export format:</label>
                <button className={`${styles.fmtBtn} ${outputFormat === "flac" ? styles.fmtActive : ""}`} onClick={() => { setOutputFormat("flac"); setExportedTracks([]); }}>
                  FLAC {discogsData && <span className={styles.metaBadge}>+ Discogs metadata</span>}
                </button>
                <button className={`${styles.fmtBtn} ${outputFormat === "wav" ? styles.fmtActive : ""}`} onClick={() => { setOutputFormat("wav"); setExportedTracks([]); }}>WAV</button>
                <label className={styles.tbCheckLabel} style={{marginLeft:16}} title="Apply RIAA inverse equalization for vinyl recorded without a phono preamp">
                  <input type="checkbox" checked={riaaEnabled} onChange={e => setRiaaEnabled(e.target.checked)} />
                  RIAA EQ
                </label>
                {riaaEnabled && <span className={styles.metaBadge}>RIAA curve applied</span>}
              </div>

              {/* Album art embedding (FLAC only) */}
              {outputFormat === "flac" && (
                <div className={styles.fmtSection}>
                  <h3 className={styles.sectionTitle}>Album Art</h3>
                  <div className={styles.embedArtRow}>
                    {embedArtPreview ? (
                      <img src={embedArtPreview} alt="Album art" className={styles.embedArtThumb} />
                    ) : (
                      <div className={styles.embedArtEmpty}>No art</div>
                    )}
                    <div className={styles.embedArtBtns}>
                      <input ref={embedArtInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (embedArtPreview) URL.revokeObjectURL(embedArtPreview);
                        setEmbedArtFile(file);
                        setEmbedArtPreview(URL.createObjectURL(file));
                        setExportedTracks([]);
                      }} />
                      <button className={styles.selectBtn} onClick={() => embedArtInputRef.current?.click()}>Upload Image</button>
                      {discogsData?.images?.[0] && !embedArtFile && (
                        <button className={styles.selectBtn} onClick={async () => {
                          try {
                            setMessage("Fetching Discogs album art…");
                            const imgUrl = `${apiBaseURL()}/discogs/image-proxy?url=${encodeURIComponent(discogsData.images[0].uri)}`;
                            const res = await fetch(imgUrl);
                            if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
                            const blob = await res.blob();
                            const file = new File([blob], "cover.jpg", { type: blob.type || "image/jpeg" });
                            if (embedArtPreview) URL.revokeObjectURL(embedArtPreview);
                            setEmbedArtFile(file);
                            setEmbedArtPreview(URL.createObjectURL(file));
                            setExportedTracks([]);
                            setMessage("Album art loaded from Discogs");
                          } catch (err) { setMessage("Failed to fetch album art: " + err.message); }
                        }}>Use Discogs Art</button>
                      )}
                      {embedArtFile && (
                        <button className={styles.selectBtn} style={{ color: "#e53e3e" }} onClick={() => {
                          if (embedArtPreview) URL.revokeObjectURL(embedArtPreview);
                          setEmbedArtFile(null);
                          setEmbedArtPreview(null);
                          setExportedTracks([]);
                        }}>Remove</button>
                      )}
                    </div>
                    {embedArtFile && <span className={styles.embedArtName}>{embedArtFile.name}</span>}
                  </div>
                </div>
              )}

              {/* Filename format */}
              <div className={styles.fmtSection}>
                <h3 className={styles.sectionTitle}>Filename Format</h3>
                <div className={styles.fmtRow}>
                  <input
                    type="text" className={styles.fmtInput}
                    value={filenameFormat}
                    onChange={e => { setFilenameFormat(e.target.value); setExportedTracks([]); }}
                    placeholder="%num%. %title%"
                  />
                  <button className={styles.selectBtn} onClick={() => setFilenameFormat("%num%. %title%")}>Reset</button>
                </div>
                <div className={styles.tokenList}>
                  {FILENAME_TOKENS.map(({ token, desc }) => (
                    <span key={token} className={styles.tokenChip} title={desc}
                      onClick={() => { setFilenameFormat(prev => prev + token); setExportedTracks([]); }}>
                      {token}
                    </span>
                  ))}
                </div>
                <p className={styles.fmtHint}>Click a token to insert it. Example: <code className={styles.fmtCode}>{getFilename(0)}</code></p>
              </div>

              {/* Preview table */}
              <div className={styles.previewSection}>
                <h3 className={styles.sectionTitle}>File Preview ({tracks.length} tracks · {selectedTracks.size} selected)</h3>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.chkCol}>
                          <div className={styles.chkHeader}>
                            <input type="checkbox" className={styles.trackChk}
                              checked={selectedTracks.size === tracks.length && tracks.length > 0}
                              onChange={e => e.target.checked ? selectAllTracks() : deselectAllTracks()}
                            />
                            <div className={styles.chkHeaderBtns}>
                              <button className={styles.chkHeaderBtn} onClick={selectAllTracks} title="Select all">All</button>
                              <button className={styles.chkHeaderBtn} onClick={deselectAllTracks} title="Deselect all">None</button>
                            </div>
                          </div>
                        </th>
                        <th>#</th><th>Filename</th><th>Title</th>
                        {discogsData && <th>Artist</th>}
                        {discogsData && <th>Album</th>}
                        <th>Duration</th><th>Download</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tracks.map((track, i) => {
                        const exp = exportedTracks.find(t => t.index === i);
                        return (
                          <tr key={track.id}
                            className={`${styles.clickableRow} ${!selectedTracks.has(track.id) ? styles.rowDimmed : ""}`}
                            onClick={e => { if (e.target.tagName !== "BUTTON" && e.target.tagName !== "A") toggleTrackSelect(track.id); }}
                          >
                            <td className={styles.chkCol} onClick={e => e.stopPropagation()}>
                              <input type="checkbox" className={styles.trackChk} checked={selectedTracks.has(track.id)} onChange={() => toggleTrackSelect(track.id)} />
                            </td>
                            <td>{i + 1}</td>
                            <td className={styles.filenameCell}>{getFilename(i)}</td>
                            <td>{trackNames[i] || track.name}</td>
                            {discogsData && <td>{discogsData.artists?.map(a => a.name).join(", ")}</td>}
                            {discogsData && <td>{discogsData.title}</td>}
                            <td>{formatTime(track.endTime - track.startTime)}</td>
                            <td onClick={e => e.stopPropagation()}>{exp ? <button className={styles.dlBtn} onClick={() => downloadTrack(exp)}>↓ {formatBytes(exp.size)}</button> : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Export controls */}
              <div className={styles.exportRow}>
                <button className={styles.exportBtn} onClick={exportTracks} disabled={isExporting || !canExport || selectedTracks.size === 0}>
                  {isExporting ? "Exporting…" : `Export ${outputFormat.toUpperCase()} (${selectedTracks.size}/${tracks.length})`}
                </button>
                {isExporting && <button className={styles.cancelBtn} onClick={cancelExport}>Cancel</button>}
                {exportedTracks.length > 0 && (
                  <>
                    <button className={styles.dlAllBtn} onClick={downloadAll}>Download All</button>
                    <button className={styles.zipBtn} onClick={downloadZip}>Download as ZIP</button>
                    <button className={styles.saveHistBtn} onClick={() => saveProject()}>💾 Save to History</button>
                  </>
                )}
              </div>

              {/* Progress */}
              {(progress !== null || exportProgress) && (
                <div className={styles.exportProg}>
                  {exportProgress && <p className={styles.exportProgLabel}>{exportProgress.name} ({exportProgress.current}/{exportProgress.total})</p>}
                  {progress !== null && <div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progress * 100}%` }} /></div>}
                </div>
              )}
              {message && <p className={styles.msg}>{message}</p>}

              {/* Exported grid */}
              {exportedTracks.length > 0 && (
                <div className={styles.exportGrid}>
                  {exportedTracks.map(t => (
                    <div key={t.index} className={styles.exportCard}>
                      <div className={styles.exportCardMeta}>
                        <span className={styles.exportNum}>{String(t.index + 1).padStart(2, "0")}</span>
                        <div className={styles.exportCardInfo}>
                          <b className={styles.exportTitle}>{t.title}</b>
                          <span className={styles.exportFile}>{t.name}</span>
                          <span className={styles.exportDetails}>{formatBytes(t.size)} · {formatTime(t.end - t.start)}</span>
                        </div>
                      </div>
                      <button className={styles.dlBtnCard} onClick={() => downloadTrack(t)}>↓</button>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.stepNav}>
                <button className={styles.backBtn} onClick={() => setStep(3)}>← Back to Editor</button>
                <button className={styles.nextBtn} onClick={() => setStep(5)} disabled={exportedTracks.length === 0}>Continue to Video Render →</button>
                <button className={styles.skipBtn} onClick={() => setStep(6)}>Skip to YouTube Upload →→</button>
                {exportedTracks.length > 0 && <button className={styles.skipBtn} onClick={() => resetStep(4)}>Clear Exports</button>}
                <button className={styles.skipBtn} onClick={resetAll}>Start Over</button>
              </div>
            </div>
          )}

          {/* ---- STEP 5 ---- */}
          {step === 5 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Step 5: Video Render</h2>

              {/* Direct file drop zone for audio + image files */}
              <div className={styles.videoSection}>
                <div
                  className={`${styles.directDropZone} ${directDropDragOver ? styles.directDropZoneActive : ""}`}
                  onDragOver={e => { e.preventDefault(); setDirectDropDragOver(true); }}
                  onDragLeave={() => setDirectDropDragOver(false)}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); setDirectDropDragOver(false); handleDirectFileDrop(e.dataTransfer.files); }}
                  onClick={() => directFileInputRef.current?.click()}
                >
                  <p className={styles.directDropTitle}>Drop audio and image files here</p>
                  <p className={styles.directDropHint}>or click to browse — add files directly to render a video</p>
                  <input ref={directFileInputRef} type="file" accept="audio/*,image/*" multiple style={{ display: "none" }}
                    onChange={e => { handleDirectFileDrop(e.target.files); e.target.value = ""; }} />
                </div>
                {/* Audio loading progress */}
                {audioLoadingStatus && (
                  <div className={styles.fileLoadingBar}>
                    <span className={styles.fileLoadingSpinner} style={{borderTopColor:"#667eea"}} />
                    <span className={styles.fileLoadingName}>Loading audio: {audioLoadingStatus.current}</span>
                    <div className={styles.progressBar}>
                      <div className={styles.progressFill} style={{width:`${(audioLoadingStatus.loaded / audioLoadingStatus.total) * 100}%`, background:"#667eea"}} />
                    </div>
                    <span className={styles.fileLoadingCount}>{audioLoadingStatus.loaded}/{audioLoadingStatus.total}</span>
                  </div>
                )}
                {/* Image loading progress */}
                {imageLoadingStatus && (
                  <div className={styles.fileLoadingBar}>
                    <span className={styles.fileLoadingSpinner} style={{borderTopColor:"#48bb78"}} />
                    <span className={styles.fileLoadingName}>Loading image: {imageLoadingStatus.current}</span>
                    <div className={styles.progressBar}>
                      <div className={styles.progressFill} style={{width:`${(imageLoadingStatus.loaded / imageLoadingStatus.total) * 100}%`, background:"#48bb78"}} />
                    </div>
                    <span className={styles.fileLoadingCount}>{imageLoadingStatus.loaded}/{imageLoadingStatus.total}</span>
                  </div>
                )}
              </div>

              {/* Audio Tracks to include */}
              <div className={styles.videoSection}>
                <h3 className={styles.sectionTitle}>Audio Tracks ({selectedVideoAudios.size}/{exportedTracks.length} selected)</h3>
                {exportedTracks.length === 0 && !audioLoadingStatus ? (
                  <p className={styles.hintText}>No audio tracks yet. Drop audio files above or go back to Export.</p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th style={{width:28}}></th>
                          <th className={styles.chkCol}>
                            <div className={styles.chkHeader}>
                              <input type="checkbox"
                                checked={selectedVideoAudios.size === exportedTracks.length && exportedTracks.length > 0}
                                onChange={e => setSelectedVideoAudios(e.target.checked ? new Set(exportedTracks.map((_, i) => i)) : new Set())}
                              />
                            </div>
                          </th>
                          <th>#</th><th>Title</th><th>Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(videoAudioOrder.length === exportedTracks.length ? videoAudioOrder : exportedTracks.map((_, i) => i)).map((trackIdx, orderIdx) => {
                          const t = exportedTracks[trackIdx];
                          return (
                            <tr key={trackIdx}
                              draggable
                              onDragStart={() => handleAudioDragStart(orderIdx)}
                              onDragOver={e => handleAudioDragOver(e, orderIdx)}
                              onDragEnd={handleAudioDragEnd}
                              className={`${styles.clickableRow} ${styles.draggableRow} ${!selectedVideoAudios.has(trackIdx) ? styles.rowDimmed : ""}`}
                              onClick={e => { if (e.target.tagName !== "INPUT") toggleVideoAudio(trackIdx); }}
                            >
                              <td className={styles.dragHandle} onClick={e => e.stopPropagation()}>⠿</td>
                              <td className={styles.chkCol} onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={selectedVideoAudios.has(trackIdx)} onChange={() => toggleVideoAudio(trackIdx)} />
                              </td>
                              <td>{orderIdx + 1}</td>
                              <td>{t.title}</td>
                              <td>{formatTime(t.end - t.start)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Images */}
              <div className={styles.videoSection}>
                <h3 className={styles.sectionTitle}>Images ({selectedVideoImages.size}/{videoImages.length} selected)</h3>
                <div className={styles.videoImgActions}>
                  <button className={styles.fetchBtn} onClick={() => setShowImageModal(true)}>+ Add Image</button>
                  {discogsData?.images?.length > 0 && (
                    <button className={styles.fetchBtn} onClick={fetchDiscogsImage} disabled={!!discogsArtStatus}>
                      {discogsArtStatus ? "Fetching…" : `Use Discogs Art (${discogsData.images.length})`}
                    </button>
                  )}
                  <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <label className={styles.videoCheckLabel} style={{display:"flex",alignItems:"center",gap:4}}>
                      Slideshow:
                      <select className={styles.inputSmall} value={slideshowMode} onChange={e => setSlideshowMode(e.target.value)} style={{minWidth:140}}>
                        <option value="distribute">Distribute evenly</option>
                        <option value="loop">Loop / repeat</option>
                        <option value="per-track">Sync with tracks</option>
                        <option value="manual">Manual timing</option>
                      </select>
                    </label>
                    {slideshowMode === "loop" && (
                      <label className={styles.videoCheckLabel} style={{display:"flex",alignItems:"center",gap:4}}>
                        Every
                        <input type="number" className={styles.inputSmall} value={loopInterval} onChange={e => setLoopInterval(Math.max(1, parseInt(e.target.value) || 1))} min="1" max="600" style={{width:60}} />
                        sec
                      </label>
                    )}
                  </div>
                </div>
                {/* Discogs art fetch progress */}
                {discogsArtStatus && (
                  <div className={styles.imageStatusBar}>
                    <span className={styles.spinnerInline} /> {discogsArtStatus.current}
                    <div className={styles.progressBar} style={{marginTop:6}}>
                      <div className={styles.progressFill} style={{width:`${(discogsArtStatus.loaded / discogsArtStatus.total) * 100}%`, background:"#667eea"}} />
                    </div>
                    <span className={styles.imageStatusCount}>{discogsArtStatus.loaded}/{discogsArtStatus.total}</span>
                  </div>
                )}
                {/* Image loading progress */}
                {imageLoadingStatus && (
                  <div className={styles.imageStatusBar}>
                    <span className={styles.fileLoadingSpinner} style={{borderTopColor:"#48bb78"}} /> Loading: {imageLoadingStatus.current}
                    <div className={styles.progressBar} style={{marginTop:6}}>
                      <div className={styles.progressFill} style={{width:`${(imageLoadingStatus.loaded / imageLoadingStatus.total) * 100}%`, background:"#48bb78"}} />
                    </div>
                    <span className={styles.imageStatusCount}>{imageLoadingStatus.loaded}/{imageLoadingStatus.total}</span>
                  </div>
                )}
                {videoImages.length > 0 && (
                  <div className={styles.tableWrap} style={{ marginTop: 12 }}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th style={{width:28}}></th>
                          <th className={styles.chkCol}>
                            <input type="checkbox"
                              checked={selectedVideoImages.size === videoImages.length && videoImages.length > 0}
                              onChange={e => setSelectedVideoImages(e.target.checked ? new Set(videoImages.map(i => i.id)) : new Set())}
                            />
                          </th>
                          <th>#</th><th>Preview</th><th>Name</th>
                          <th>
                            <div className={styles.colHeaderCheck}>
                              Blur Bg
                              <input type="checkbox"
                                checked={videoImages.length > 0 && videoImages.every(img => img.useBlurBg)}
                                onChange={e => setVideoImages(prev => prev.map(img => ({ ...img, useBlurBg: e.target.checked })))}
                              />
                            </div>
                          </th>
                          <th>
                            <div className={styles.colHeaderCheck}>
                              Stretch
                              <input type="checkbox"
                                checked={videoImages.length > 0 && videoImages.every(img => img.stretchToFit)}
                                onChange={e => setVideoImages(prev => prev.map(img => ({ ...img, stretchToFit: e.target.checked })))}
                              />
                            </div>
                          </th>
                          <th>
                            <div className={styles.colHeaderCheck}>
                              Padding
                              <input type="color" className={styles.colorPickerMini}
                                value={videoImages[0]?.paddingColor || "#000000"}
                                onChange={e => setVideoImages(prev => prev.map(img => ({ ...img, paddingColor: e.target.value })))}
                                title="Set padding color for all images"
                              />
                            </div>
                          </th>
                          {slideshowMode === "manual" && <th>Start (s)</th>}
                          {slideshowMode === "manual" && <th>End (s)</th>}
                          <th></th><th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {videoImages.map((img, i) => {
                          const timing = getEffectiveImageTimings().find(t => t.id === img.id);
                          return (
                            <React.Fragment key={img.id}>
                              <tr
                                draggable
                                onDragStart={() => handleImageDragStart(i)}
                                onDragOver={e => handleImageDragOver(e, i)}
                                onDragEnd={handleImageDragEnd}
                                className={`${styles.clickableRow} ${styles.draggableRow} ${!selectedVideoImages.has(img.id) ? styles.rowDimmed : ""}`}
                                onClick={e => { if (e.target.tagName !== "INPUT" && e.target.tagName !== "SPAN" && e.target.tagName !== "BUTTON") toggleVideoImage(img.id); }}
                              >
                                <td className={styles.dragHandle} onClick={e => e.stopPropagation()}>⠿</td>
                                <td className={styles.chkCol} onClick={e => e.stopPropagation()}>
                                  <input type="checkbox" checked={selectedVideoImages.has(img.id)} onChange={() => toggleVideoImage(img.id)} />
                                </td>
                                <td>{i + 1}</td>
                                <td><img src={img.thumbUrl} alt={img.file.name} className={styles.videoThumb} /></td>
                                <td className={styles.filenameCell}>{img.file.name}</td>
                                <td onClick={e => e.stopPropagation()}>
                                  <label className={styles.videoCheckLabel}>
                                    <input type="checkbox" checked={img.useBlurBg} onChange={e => updateVideoImage(img.id, "useBlurBg", e.target.checked)} />
                                  </label>
                                </td>
                                <td onClick={e => e.stopPropagation()}>
                                  <label className={styles.videoCheckLabel}>
                                    <input type="checkbox" checked={img.stretchToFit} disabled={img.useBlurBg} onChange={e => updateVideoImage(img.id, "stretchToFit", e.target.checked)} />
                                  </label>
                                </td>
                                <td onClick={e => e.stopPropagation()}>
                                  {!img.useBlurBg && !img.stretchToFit ? (
                                    <div className={styles.paddingColorRow}>
                                      <input type="color" value={img.paddingColor} onChange={e => updateVideoImage(img.id, "paddingColor", e.target.value)} className={styles.colorPicker} />
                                      {["#000000", "#ffffff", "#1a1a2e", "#16213e", "#0f3460"].map(c => (
                                        <span key={c} onClick={() => updateVideoImage(img.id, "paddingColor", c)} title={c}
                                          className={styles.colorSwatch}
                                          style={{ background: c, border: img.paddingColor === c ? "2px solid #4299e1" : "1px solid #718096" }} />
                                      ))}
                                    </div>
                                  ) : <span className={styles.hintText}>—</span>}
                                </td>
                                {slideshowMode === "manual" && (
                                  <td onClick={e => e.stopPropagation()}>
                                    <input type="number" className={styles.timeInput} step="1" min="0"
                                      value={timing ? parseFloat(timing.startTime.toFixed(1)) : 0}
                                      onChange={e => {
                                        const v = parseFloat(e.target.value) || 0;
                                        setManualImageTimings(prev => ({ ...prev, [img.id]: { startTime: v, endTime: prev[img.id]?.endTime ?? timing?.endTime ?? v + 10 } }));
                                      }} />
                                  </td>
                                )}
                                {slideshowMode === "manual" && (
                                  <td onClick={e => e.stopPropagation()}>
                                    <input type="number" className={styles.timeInput} step="1" min="0"
                                      value={timing ? parseFloat(timing.endTime.toFixed(1)) : 0}
                                      onChange={e => {
                                        const v = parseFloat(e.target.value) || 0;
                                        setManualImageTimings(prev => ({ ...prev, [img.id]: { startTime: prev[img.id]?.startTime ?? timing?.startTime ?? 0, endTime: v } }));
                                      }} />
                                  </td>
                                )}
                                <td onClick={e => e.stopPropagation()}>
                                  <button className={styles.previewBtn} title="Preview image rendering" onClick={() => toggleImgPreview(img.id)}>
                                    {expandedImgPreviews.has(img.id) ? "▲" : "▼"}
                                  </button>
                                </td>
                                <td onClick={e => e.stopPropagation()}>
                                  <button className={styles.removeBtn} onClick={() => removeVideoImage(img.id)}>×</button>
                                </td>
                              </tr>
                              {expandedImgPreviews.has(img.id) && (
                                <tr>
                                  <td colSpan={10} className={styles.imgPreviewRow}>
                                    <div className={styles.imgPreviewWrap} style={{ background: img.useBlurBg ? "transparent" : (img.paddingColor || videoBgColor) }}>
                                      {img.useBlurBg && (
                                        <div className={styles.imgPreviewBlurBg} style={{ backgroundImage: `url(${img.previewUrl})` }} />
                                      )}
                                      <img
                                        src={img.previewUrl}
                                        alt={img.file.name}
                                        className={styles.imgPreviewImg}
                                        style={{ objectFit: img.stretchToFit ? "fill" : "contain" }}
                                      />
                                    </div>
                                    <p className={styles.hintText} style={{marginTop:4}}>
                                      {img.useBlurBg ? "Blur background" : img.stretchToFit ? "Stretch to fit" : `Letterbox · padding: ${img.paddingColor || videoBgColor}`}
                                    </p>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Video Timeline */}
              {(() => {
                const orderedAudios = getOrderedAudios();
                const totalVideoDur = orderedAudios.reduce((s, t) => s + (t.end - t.start), 0);
                const imgTimings = getEffectiveImageTimings();
                if (orderedAudios.length === 0 || totalVideoDur === 0) return null;
                return (
                  <div className={styles.videoSection}>
                    <h3 className={styles.sectionTitle}>Timeline — {formatTime(totalVideoDur)}</h3>
                    <div className={styles.timelineWrap}>
                      {/* Audio row */}
                      <div className={styles.timelineRow}>
                        <span className={styles.timelineLabel}>Audio</span>
                        <div className={styles.timelineTrack}>
                          {orderedAudios.map((t, i) => {
                            const start = orderedAudios.slice(0, i).reduce((s, x) => s + (x.end - x.start), 0);
                            const dur = t.end - t.start;
                            return (
                              <div key={i} className={styles.timelineBlock} title={`${t.title} (${formatTime(dur)})`} style={{ left: `${(start / totalVideoDur) * 100}%`, width: `${(dur / totalVideoDur) * 100}%`, background: AUDIO_COLORS[i % AUDIO_COLORS.length] }}>
                                <span className={styles.timelineBlockLabel}>{t.title}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {/* Images row */}
                      {imgTimings.length > 0 && (
                        <div className={styles.timelineRow}>
                          <span className={styles.timelineLabel}>Images</span>
                          <div className={styles.timelineTrack}>
                            {imgTimings.map((timing, i) => {
                              const img = videoImages.find(x => x.id === timing.id);
                              const dur = timing.endTime - timing.startTime;
                              return (
                                <div key={`${timing.id}-${i}`} className={styles.timelineBlock} title={`${img?.file.name} (${formatTime(dur)})`} style={{ left: `${(timing.startTime / totalVideoDur) * 100}%`, width: `${(dur / totalVideoDur) * 100}%`, background: IMG_COLORS[i % IMG_COLORS.length] }}>
                                  <span className={styles.timelineBlockLabel}>{img?.file.name}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* Time axis */}
                      <div className={styles.timelineAxis}>
                        {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map(frac => (
                          <span key={frac} className={styles.timelineTick} style={{ left: `${frac * 100}%` }}>{formatTime(totalVideoDur * frac)}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Video settings */}
              <div className={styles.videoSettings}>
                <h3 className={styles.sectionTitle}>Video Settings</h3>

                {/* Aspect ratio preset selector */}
                <div className={styles.aspectRatioRow}>
                  <div className={styles.settingLabel}>
                    Aspect Ratio
                    <div className={styles.aspectDropdown} ref={aspectDropdownRef}>
                      <button
                        className={styles.aspectDropdownTrigger}
                        onClick={() => setAspectDropdownOpen(v => !v)}
                        type="button"
                      >
                        {(() => {
                          const match = VIDEO_PRESETS.flatMap(g => g.presets).find(p => String(p.w) === videoWidth && String(p.h) === videoHeight);
                          const icon = match?.icon || "landscape";
                          return (
                            <>
                              <svg className={styles.aspectFrameIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                {icon === "landscape" && <rect x="1" y="5" width="22" height="14" rx="2" />}
                                {icon === "portrait" && <rect x="5" y="1" width="14" height="22" rx="2" />}
                                {icon === "square" && <rect x="3" y="3" width="18" height="18" rx="2" />}
                              </svg>
                              <span>{match ? `${match.label} (${match.w}×${match.h})` : `${videoWidth}×${videoHeight}`}</span>
                              <span className={styles.aspectDropdownArrow}>{aspectDropdownOpen ? "▲" : "▼"}</span>
                            </>
                          );
                        })()}
                      </button>
                      {aspectDropdownOpen && (
                        <div className={styles.aspectDropdownMenu}>
                          {VIDEO_PRESETS.map(group => (
                            <div key={group.group}>
                              <div className={styles.aspectDropdownGroupLabel}>{group.group}</div>
                              {group.presets.map(p => {
                                const active = videoWidth === String(p.w) && videoHeight === String(p.h);
                                return (
                                  <button
                                    key={`${p.w}x${p.h}`}
                                    className={`${styles.aspectDropdownItem} ${active ? styles.aspectDropdownItemActive : ""}`}
                                    onClick={() => { setVideoWidth(String(p.w)); setVideoHeight(String(p.h)); setAspectDropdownOpen(false); }}
                                  >
                                    <svg className={styles.aspectFrameIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                      {p.icon === "landscape" && <rect x="1" y="5" width="22" height="14" rx="2" />}
                                      {p.icon === "portrait" && <rect x="5" y="1" width="14" height="22" rx="2" />}
                                      {p.icon === "square" && <rect x="3" y="3" width="18" height="18" rx="2" />}
                                    </svg>
                                    <span>{p.label}</span>
                                    <span className={styles.aspectDropdownDims}>{p.w}×{p.h}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {videoImages.length > 0 && (
                    <div className={styles.presetMatchRow}>
                      <span className={styles.presetMatchLabel}>Match image:</span>
                      {videoImages.map((img, i) => (
                        <button key={img.id} className={styles.presetMatchBtn} onClick={() => applyImageResolution(img)}
                          title={`Set resolution to match ${img.file.name}`}>
                          <img src={img.thumbUrl} alt="" className={styles.presetMatchThumb} />
                          <span>{i + 1}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.videoSettingsGrid}>
                  <label className={styles.settingLabel}>
                    Output name
                    <input type="text" className={styles.input} value={videoOutputName} onChange={e => setVideoOutputName(e.target.value)} placeholder={projectName || "album"} />
                  </label>
                  <div className={styles.settingLabel}>
                    Resolution
                    <div className={styles.dimensionRow}>
                      <input type="number" className={styles.dimensionInput} value={videoWidth} onChange={e => setVideoWidth(e.target.value)} min="1" max="3840" placeholder="W" title="Width" />
                      <span className={styles.dimensionX}>×</span>
                      <input type="number" className={styles.dimensionInput} value={videoHeight} onChange={e => setVideoHeight(e.target.value)} min="1" max="2160" placeholder="H" title="Height" />
                    </div>
                  </div>
                  <label className={styles.settingLabel}>
                    Background color
                    <input type="color" value={videoBgColor} onChange={e => setVideoBgColor(e.target.value)} style={{ width: 44, height: 34, padding: 2, borderRadius: 4, border: "1px solid #cbd5e0", cursor: "pointer" }} />
                  </label>
                </div>
                {/* Video estimate */}
                {(() => {
                  const est = estimateVideoSize();
                  if (!est) return null;
                  const durMin = Math.floor(est.totalDur / 60);
                  const durSec = Math.round(est.totalDur % 60);
                  return (
                    <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 6, fontSize: "0.82rem",
                      background: est.overLimit ? (darkMode ? "#5a1a1a" : "#fff5f5") : (darkMode ? "#252538" : "#f7fafc"),
                      border: `1px solid ${est.overLimit ? (darkMode ? "#822727" : "#fc8181") : est.nearLimit ? "#fbd38d" : (darkMode ? "#444" : "#e2e8f0")}`,
                      color: darkMode ? "#fff" : "#2d3748"
                    }}>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                        <span>Duration: <strong>{durMin}:{String(durSec).padStart(2,"0")}</strong></span>
                        <span>Resolution: <strong>{videoWidth}×{videoHeight}</strong></span>
                        <span>Est. size: <strong>{est.totalMB < 1024 ? `${est.totalMB.toFixed(0)} MB` : `${(est.totalMB/1024).toFixed(1)} GB`}</strong></span>
                        <span>Upload limit: <strong>{YT_UPLOAD_LIMIT_MB / 1024} GB</strong></span>
                      </div>
                      {est.overLimit && <div style={{ marginTop: 6, color: darkMode ? "#fc8181" : "#c53030", fontWeight: 700 }}>⚠️ Estimated size exceeds the upload limit. Lower the resolution or shorten the audio.</div>}
                      {!est.overLimit && est.nearLimit && <div style={{ marginTop: 6, color: darkMode ? "#fbd38d" : "#c05621" }}>⚠️ Approaching upload limit — consider a lower resolution.</div>}
                      {est.overDuration && <div style={{ marginTop: 6, color: darkMode ? "#fc8181" : "#c53030", fontWeight: 700 }}>⚠️ Duration exceeds YouTube&apos;s 12-hour limit.</div>}
                    </div>
                  );
                })()}
              </div>

              {/* Render */}
              {(selectedVideoImages.size === 0 || selectedVideoAudios.size === 0) && !isRenderingVideo && (
                <div className={styles.renderWarning} style={{background: darkMode ? "#3a2a1a" : "#fffaf0", borderColor: darkMode ? "#6b4d2d" : "#fbd38d", color: darkMode ? "#fbd38d" : "#c05621"}}>
                  {selectedVideoImages.size === 0 && selectedVideoAudios.size === 0
                    ? "Add at least one image and select at least one audio track to render."
                    : selectedVideoImages.size === 0
                      ? "Add or select at least one image above to render the video."
                      : "Select at least one audio track above to render the video."}
                </div>
              )}
              <div className={styles.exportRow}>
                <button className={styles.exportBtn} onClick={renderAlbumVideo}
                  disabled={isRenderingVideo || selectedVideoImages.size === 0 || selectedVideoAudios.size === 0}
                  style={!isRenderingVideo && (selectedVideoImages.size === 0 || selectedVideoAudios.size === 0) ? {background:"#cbd5e0",cursor:"not-allowed"} : undefined}>
                  {isRenderingVideo ? "Rendering…"
                    : selectedVideoImages.size === 0 ? "Render Video — no images selected"
                    : selectedVideoAudios.size === 0 ? "Render Video — no audio selected"
                    : `Render Video (${selectedVideoImages.size} image${selectedVideoImages.size !== 1 ? "s" : ""}, ${selectedVideoAudios.size} track${selectedVideoAudios.size !== 1 ? "s" : ""})`}
                </button>
                {isRenderingVideo && (
                  <button className={styles.cancelBtn} onClick={() => {
                    try { videoFfmpegRef.current?.terminate(); } catch {}
                    setIsRenderingVideo(false); setVideoRenderProgress(null); setVideoRenderStartTime(null);
                    setVideoRenderLogs(prev => [...prev, "— Render cancelled —"]);
                    setMessage("Render cancelled");
                  }}>Cancel</button>
                )}
              </div>
              {isRenderingVideo && (
                <div className={styles.renderWarning}>
                  Rendering in browser — you can navigate to YouTube Upload while this continues.
                </div>
              )}
              {videoRenderProgress !== null && (
                <div className={styles.renderProgressWrap}>
                  <div className={styles.renderProgressBar}>
                    <div className={styles.renderProgressFill} style={{ width: `${videoRenderProgress * 100}%` }} />
                  </div>
                  <div className={styles.renderProgressInfo}>
                    <span className={styles.renderProgressPct}>{(videoRenderProgress * 100).toFixed(1)}%</span>
                    {formatEta() && <span className={styles.renderProgressEta}>{formatEta()}</span>}
                  </div>
                </div>
              )}

              {/* FFmpeg log output */}
              {videoRenderLogs.length > 0 && (
                <div className={styles.videoLogWrap}>
                  <button className={styles.analyzeLogToggle} onClick={() => setShowVideoLogs(v => !v)}>
                    {showVideoLogs ? "▼" : "▶"} FFmpeg Logs ({videoRenderLogs.length} lines)
                    {isRenderingVideo && <span className={styles.spinnerInline} style={{ marginLeft: 8 }} />}
                  </button>
                  {showVideoLogs && (
                    <div className={styles.videoLogBox}>
                      {videoRenderLogs.map((line, i) => (
                        <div key={i} className={`${styles.videoLogLine} ${line.startsWith("ERROR") ? styles.videoLogError : line.startsWith("✓") ? styles.videoLogDone : ""}`}>{line}</div>
                      ))}
                      <div ref={videoLogsEndRef} />
                    </div>
                  )}
                </div>
              )}

              {/* Video preview */}
              {renderedVideoSrc && (
                <div className={styles.videoPreviewSection}>
                  <video src={renderedVideoSrc} controls className={styles.videoPreview} />
                  <button className={styles.dlAllBtn} onClick={() => { const a = document.createElement("a"); a.href = renderedVideoSrc; a.download = `${videoOutputName || projectName || "album"}.mp4`; a.click(); }}>Download Video</button>
                </div>
              )}

              {message && <p className={styles.msg}>{message}</p>}

              <div className={styles.stepNav}>
                <button className={styles.backBtn} onClick={() => setStep(4)}>← Back to Audio Export</button>
                <button className={styles.nextBtn} onClick={() => setStep(6)}>Next: YouTube Upload →</button>
                <button className={styles.skipBtn} onClick={() => resetStep(5)}>Clear Video</button>
                <button className={styles.skipBtn} onClick={resetAll}>Start Over</button>
              </div>
            </div>
          )}

          {/* ---- STEP 6 ---- */}
          {step === 6 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Step 6: YouTube Upload</h2>

              {/* Render status banner */}
              {isRenderingVideo && (
                <div className={styles.renderStatusBanner}>
                  <div className={styles.renderStatusText}>
                    <span className={styles.spinnerInline} /> Video rendering… {videoRenderProgress !== null ? `${(videoRenderProgress * 100).toFixed(1)}%` : ""}
                    {formatEta() && <span className={styles.renderProgressEta}> · {formatEta()}</span>}
                  </div>
                  <div className={styles.renderProgressBar} style={{marginTop:8}}>
                    <div className={styles.renderProgressFill} style={{ width: `${(videoRenderProgress || 0) * 100}%` }} />
                  </div>
                  <label className={styles.videoCheckLabel} style={{marginTop:8}}>
                    <input type="checkbox" checked={autoUploadYt} onChange={e => setAutoUploadYt(e.target.checked)} />
                    Upload to YouTube automatically when render finishes
                  </label>
                </div>
              )}

              {!isRenderingVideo && !renderedVideoSrc && (
                <div className={styles.renderStatusBanner} style={{background: darkMode ? "#3a1a1a" : "#fff5f5", borderColor: darkMode ? "#6b2d2d" : "#fed7d7"}}>
                  <span className={styles.renderStatusText} style={{color: darkMode ? "#fc8181" : "#c53030"}}>No rendered video yet. Go to Step 5 to render first.</span>
                </div>
              )}

              {renderedVideoSrc && !isRenderingVideo && (
                <div className={styles.videoPreviewSection} style={{ marginBottom: 20 }}>
                  <video src={renderedVideoSrc} controls className={styles.videoPreview} />
                  <button className={styles.dlAllBtn} onClick={() => { const a = document.createElement("a"); a.href = renderedVideoSrc; a.download = `${videoOutputName || projectName || "album"}.mp4`; a.click(); }}>Download Video</button>
                </div>
              )}

              {/* YouTube upload */}
              <div className={styles.ytSection}>
                <h3 className={styles.sectionTitle}><span style={{color:"#ff0000"}}>▶</span> Upload to YouTube</h3>
                <YouTubeAuth compact={true} returnUrl="/vinyl-digitizer" darkMode={darkMode} getTokensRef={getTokensRef} onAuthStateChange={setYtAuthState} />
                {ytAuthState.canAuth && (() => {
                  const titleLen = ytUploadData.title.length;
                  const descLen = ytUploadData.description.length;
                  const tagsLen = ytUploadData.tags.length;
                  const titleOver = titleLen > YT_LIMITS.title;
                  const descOver = descLen > YT_LIMITS.description;
                  const tagsOver = tagsLen > YT_LIMITS.tags;
                  const anyOver = titleOver || descOver || tagsOver;
                  return (
                  <div className={styles.ytForm}>
                    {/* Format options */}
                    <div className={styles.ytFormatSection} style={{gridColumn:"1/-1"}}>
                      <h4 className={styles.ytFormatTitle}>Format Options</h4>
                      <div className={styles.ytFormatGrid}>
                        <label className={styles.ytFormatLabel}>
                          Title style
                          <select className={`${styles.inputSmall} ${styles.ytFormatSelect}`} value={ytTitleVariation} onChange={e => { const v = parseInt(e.target.value); setYtTitleVariation(v); regenerateYtTitle(v); }}>
                            <option value={0}>Genre-focused</option>
                            <option value={1}>Style-focused</option>
                            <option value={2}>Label & country</option>
                            <option value={3}>Alt separators</option>
                            <option value={4}>Mixed genre/style</option>
                          </select>
                        </label>
                        <label className={styles.ytFormatLabel}>
                          Timestamp format
                          <select className={`${styles.inputSmall} ${styles.ytFormatSelect}`} value={ytTimestampFormat} onChange={e => { setYtTimestampFormat(e.target.value); setTimeout(regenerateYtMetadata, 0); }}>
                            <option value="auto">Auto (M:SS or H:MM:SS)</option>
                            <option value="M:SS">M:SS</option>
                            <option value="H:MM:SS">H:MM:SS</option>
                          </select>
                        </label>
                        <label className={styles.ytFormatLabel}>
                          Separator
                          <select className={`${styles.inputSmall} ${styles.ytFormatSelect}`} value={ytTimestampSeparator} onChange={e => { setYtTimestampSeparator(e.target.value); setTimeout(regenerateYtMetadata, 0); }}>
                            <option value=" ">(space)</option>
                            <option value=" - "> - (dash)</option>
                            <option value=" | "> | (pipe)</option>
                            <option value=" · "> · (dot)</option>
                          </select>
                        </label>
                        <label className={styles.ytFormatLabel} style={{flexDirection:"row",alignItems:"center",gap:6}}>
                          <input type="checkbox" checked={ytIncludeTrackNums} onChange={e => { setYtIncludeTrackNums(e.target.checked); setTimeout(regenerateYtMetadata, 0); }} />
                          Track numbers
                        </label>
                      </div>
                      {ytTitleSuggestions.length > 0 && (
                        <div className={styles.ytTitleSuggestions}>
                          <span className={styles.ytFormatHint}>Title suggestions:</span>
                          <select className={`${styles.inputSmall} ${styles.ytFormatSelect}`} style={{flex:1,minWidth:200}}
                            value={ytUploadData.title}
                            onChange={e => setYtUploadData(p => ({...p, title: e.target.value.slice(0, YT_LIMITS.title)}))}
                          >
                            <option value="">— Select a suggestion —</option>
                            {ytTitleSuggestions.map((s, i) => (
                              <option key={i} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className={styles.ytFormatActions}>
                        <button className={styles.selectBtn} onClick={() => regenerateYtMetadata()}>Regenerate Description</button>
                        <button className={styles.selectBtn} onClick={() => regenerateYtTags()}>Regenerate Tags</button>
                        <button className={styles.selectBtn} style={{background: darkMode ? "#5a2020" : "#fed7d7", color: darkMode ? "#fc8181" : "#c53030", border: "none"}} onClick={() => {
                          setYtUploadData({ title: "", description: "", privacyStatus: "private", tags: "" });
                          setYtTitleSuggestions([]);
                          lastYtDiscogsUrlRef.current = null;
                          setThumbnailFile(null);
                          if (thumbnailPreview) { URL.revokeObjectURL(thumbnailPreview); setThumbnailPreview(null); }
                        }}>Clear All Fields</button>
                      </div>
                    </div>

                    <label className={styles.settingLabel} style={{gridColumn:"1/-1"}}>
                      <div className={styles.ytFieldHeader}>
                        <span>Title</span>
                        <span className={`${styles.ytCharCount} ${titleOver ? styles.ytCharOver : ""}`}>{titleLen}/{YT_LIMITS.title}</span>
                      </div>
                      <input type="text" className={`${styles.input} ${titleOver ? styles.ytInputOver : ""}`} value={ytUploadData.title} onChange={e => setYtUploadData(p => ({...p, title: e.target.value}))} />
                    </label>
                    <div className={styles.settingLabel} style={{gridColumn:"1/-1"}}>
                      <div className={styles.ytFieldHeader}>
                        <span>Description</span>
                        <span className={`${styles.ytCharCount} ${descOver ? styles.ytCharOver : ""}`}>{descLen}/{YT_LIMITS.description}</span>
                      </div>
                      <textarea className={`${styles.input} ${descOver ? styles.ytInputOver : ""}`} value={ytUploadData.description} onChange={e => setYtUploadData(p => ({...p, description: e.target.value}))} rows={6} style={{resize:"vertical"}} />
                    </div>
                    <label className={styles.settingLabel}>
                      <div className={styles.ytFieldHeader}>
                        <span>Tags</span>
                        <span className={`${styles.ytCharCount} ${tagsOver ? styles.ytCharOver : ""}`}>{tagsLen}/{YT_LIMITS.tags}</span>
                      </div>
                      <input type="text" className={`${styles.input} ${tagsOver ? styles.ytInputOver : ""}`} value={ytUploadData.tags} onChange={e => setYtUploadData(p => ({...p, tags: e.target.value}))} placeholder="tag1, tag2" />
                    </label>
                    <label className={styles.settingLabel}>
                      Visibility
                      <select className={styles.input} value={ytUploadData.privacyStatus} onChange={e => setYtUploadData(p => ({...p, privacyStatus: e.target.value}))}>
                        <option value="private">Private</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="public">Public</option>
                      </select>
                    </label>
                    <div style={{gridColumn:"1/-1"}}>
                      <span className={styles.label}>Thumbnail (optional)</span>
                      <div style={{display:"flex",alignItems:"center",gap:12,marginTop:6}}>
                        <div onClick={() => thumbnailInputRef.current?.click()} className={styles.thumbDropzone}>
                          {thumbnailPreview ? <img src={thumbnailPreview} alt="thumb" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : <span style={{fontSize:11,color:"#a0aec0",textAlign:"center",padding:8}}>Click to upload</span>}
                        </div>
                        <input ref={thumbnailInputRef} type="file" accept="image/*" style={{display:"none"}}
                          onChange={e => {
                            const f = e.target.files?.[0]; if (!f) return;
                            if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
                            setThumbnailFile(f); setThumbnailPreview(URL.createObjectURL(f));
                          }} />
                        {thumbnailFile && <button className={styles.selectBtn} onClick={() => { setThumbnailFile(null); if(thumbnailPreview) URL.revokeObjectURL(thumbnailPreview); setThumbnailPreview(null); }}>Remove</button>}
                      </div>
                    </div>
                    {anyOver && (
                      <div className={styles.ytLimitWarning} style={{gridColumn:"1/-1"}}>
                        {titleOver && <span>Title exceeds 100 characters. </span>}
                        {descOver && <span>Description exceeds 5,000 characters. </span>}
                        {tagsOver && <span>Tags exceed 500 characters. </span>}
                        Shorten the fields highlighted in red before uploading.
                      </div>
                    )}
                    <div style={{gridColumn:"1/-1"}}>
                      <button onClick={() => uploadToYouTube()} disabled={ytUploading || (!renderedVideoSrc && !isRenderingVideo) || anyOver || isRenderingVideo} className={styles.exportBtn} style={{width:"100%",background: ytUploading ? undefined : (anyOver || isRenderingVideo || !renderedVideoSrc) ? "#cbd5e0" : "#ff0000"}}>
                        {ytUploading
                          ? (ytUploadProgress < 100 ? `Uploading… ${ytUploadProgress}%` : <span className={styles.ytProcessing}>Processing</span>)
                          : isRenderingVideo
                            ? `Rendering… ${videoRenderProgress !== null ? `${(videoRenderProgress * 100).toFixed(0)}%` : ""}`
                            : !renderedVideoSrc
                              ? "No video rendered"
                              : "Upload to YouTube"}
                      </button>
                    </div>
                    {ytUploading && (
                      <div style={{gridColumn:"1/-1"}}>
                        <div className={styles.progressBar}><div className={styles.progressFill} style={{width:`${ytUploadProgress ?? 0}%`,background: ytUploadProgress < 100 ? "#ff0000" : "#48bb78"}} /></div>
                      </div>
                    )}
                    {ytUploadError && <p className={styles.errorMsg} style={{gridColumn:"1/-1"}}>{ytUploadError}</p>}
                    {ytUploadResult && (() => {
                      const vid = ytUploadResult.videoId || ytUploadResult.id || ytUploadResult.snippet?.resourceId?.videoId;
                      return (
                        <div className={styles.ytResult} style={{gridColumn:"1/-1"}}>
                          ✅ Uploaded successfully!
                          {vid && (
                            <div style={{marginTop: 8}}>
                              <a href={`https://youtube.com/watch?v=${vid}`} target="_blank" rel="noreferrer" className={styles.ytVideoLink}>
                                https://youtube.com/watch?v={vid}
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  );
                })()}
              </div>

              <div className={styles.stepNav}>
                <button className={styles.backBtn} onClick={() => setStep(5)}>← Back to Video Render</button>
                <button className={styles.backBtn} onClick={() => setStep(1)}>← Back to Start</button>
                <button className={styles.skipBtn} onClick={() => resetStep(6)}>Clear Upload</button>
                <button className={styles.skipBtn} onClick={resetAll}>Start Over</button>
              </div>
            </div>
          )}
        </div>

          {/* Image Add Modal */}
          {showImageModal && (
            <div
              className={styles.imageModalBackdrop}
              onClick={() => setShowImageModal(false)}
              onPaste={e => {
                const items = Array.from(e.clipboardData?.items || []);
                const imageItems = items.filter(item => item.type.startsWith("image/"));
                if (imageItems.length > 0) {
                  const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
                  const renamed = files.map((f, i) => new File([f], `pasted-${Date.now()}-${i}.${f.type.split("/")[1] || "png"}`, { type: f.type }));
                  addImagesToVideo(renamed);
                }
              }}
            >
              <div
                className={styles.imageModal}
                onClick={e => e.stopPropagation()}
                onPaste={e => {
                  const items = Array.from(e.clipboardData?.items || []);
                  const imageItems = items.filter(item => item.type.startsWith("image/"));
                  if (imageItems.length > 0) {
                    e.stopPropagation();
                    const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
                    const renamed = files.map((f, i) => new File([f], `pasted-${Date.now()}-${i}.${f.type.split("/")[1] || "png"}`, { type: f.type }));
                    addImagesToVideo(renamed);
                  }
                }}
              >
                <div className={styles.imageModalHeader}>
                  <h3 className={styles.imageModalTitle}>Add Images</h3>
                  <button className={styles.imageModalClose} onClick={() => setShowImageModal(false)}>×</button>
                </div>

                <div
                  className={`${styles.imageDropZone} ${modalDragOver ? styles.imageDropZoneActive : ""}`}
                  onDragOver={e => { e.preventDefault(); setModalDragOver(true); }}
                  onDragLeave={() => setModalDragOver(false)}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); setModalDragOver(false); addImagesToVideo(e.dataTransfer.files); }}
                  onClick={() => modalFileInputRef.current?.click()}
                >
                  <div className={styles.imageDropZoneIcon}>🖼️</div>
                  <p className={styles.imageDropZoneTitle}>Drag & drop images here</p>
                  <p className={styles.imageDropZoneHint}>or click to browse · or paste with Ctrl+V</p>
                  <input ref={modalFileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                    onChange={e => { addImagesToVideo(e.target.files); e.target.value = ""; }} />
                </div>

                {imageLoadingStatus && (
                  <div className={styles.imageStatusBar}>
                    <span className={styles.fileLoadingSpinner} style={{borderTopColor:"#48bb78"}} /> Loading: {imageLoadingStatus.current}
                    <div className={styles.progressBar} style={{marginTop:4,flex:1,minWidth:100}}>
                      <div className={styles.progressFill} style={{width:`${(imageLoadingStatus.loaded / imageLoadingStatus.total) * 100}%`, background:"#48bb78"}} />
                    </div>
                    <span className={styles.imageStatusCount}>{imageLoadingStatus.loaded}/{imageLoadingStatus.total}</span>
                  </div>
                )}
                {videoImages.length > 0 && (
                  <div className={styles.imageModalList}>
                    <p className={styles.imageModalListTitle}>{videoImages.length} image{videoImages.length !== 1 ? "s" : ""} added:</p>
                    <div className={styles.imageModalGrid}>
                      {videoImages.map((img, i) => (
                        <div key={img.id} className={styles.imageModalThumbWrap}>
                          <img src={img.thumbUrl} alt={img.file.name} className={styles.imageModalThumb} />
                          <span className={styles.imageModalThumbIdx}>{i + 1}</span>
                          <button className={styles.imageModalThumbRemove} onClick={() => removeVideoImage(img.id)}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className={styles.imageModalFooter}>
                  <button className={styles.nextBtn} onClick={() => setShowImageModal(false)}>Done</button>
                </div>
              </div>
            </div>
          )}

        {/* History Sidebar */}
        {showHistory && (
          <div className={styles.historySidebar}>
            <div className={styles.historyHead}>
              <h3 className={styles.historyTitle}>Project History</h3>
              <div className={styles.historyHeadBtns}>
                {projects.length > 0 && (
                  <button className={styles.clearHistoryBtn} onClick={() => { if (window.confirm("Clear all saved projects?")) clearAllHistory(); }}>Clear All</button>
                )}
                <button className={styles.closeHistory} onClick={() => setShowHistory(false)}>×</button>
              </div>
            </div>
            {projects.length === 0 ? (
              <p className={styles.historyEmpty}>No saved projects yet. Export tracks to save automatically.</p>
            ) : (
              <div className={styles.projectList}>
                {projects.map(p => (
                  <div key={p.id} className={styles.projectCard}>
                    <div className={styles.projectMeta}>
                      <b className={styles.projectName}>{p.name}</b>
                      <span className={styles.projectDate}>{new Date(p.date).toLocaleDateString()}</span>
                      <span className={styles.projectFile}>{p.audioFileName}</span>
                      <span className={styles.projectDetails}>{p.trackCount} tracks · {p.outputFormat?.toUpperCase()}</span>
                    </div>
                    <div className={styles.projectBtns}>
                      <button className={styles.loadBtn} onClick={() => loadProject(p)}>Load</button>
                      <button className={styles.deleteBtn} onClick={() => removeProject(p.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <audio ref={audioRef} onEnded={() => { setIsPlaying(false); setPreviewingTrack(null); }} preload="auto" />
    </div>
  );
}
