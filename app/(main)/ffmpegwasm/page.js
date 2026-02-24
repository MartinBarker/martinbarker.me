"use client";
import React, { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import styles from "./ffmpegwasm.module.css";
import Table from "./Table";
import YouTubeAuth from "../YouTubeAuth/YouTubeAuth";

// ---------- IndexedDB helpers ----------
function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("ffmpegwasm", 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore("renders");
    req.onsuccess = e => res(e.target.result);
    req.onerror = rej;
  });
}
async function saveRenderToIDB(data) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("renders", "readwrite");
    tx.objectStore("renders").put(data, "last");
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}
async function loadRenderFromIDB() {
  try {
    const db = await openIDB();
    return new Promise(res => {
      const req = db.transaction("renders").objectStore("renders").get("last");
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}
async function clearRenderFromIDB() {
  try {
    const db = await openIDB();
    return new Promise(res => {
      const tx = db.transaction("renders", "readwrite");
      tx.objectStore("renders").delete("last");
      tx.oncomplete = res;
      tx.onerror = res;
    });
  } catch {}
}

// ---------- Helpers ----------
const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  return `${mins}:${String(secs).padStart(2,"0")}`;
};

const YT_FOOTER = "video rendered on www.martinbarker.me/ffmpegwasm";

const generateTracklist = (audioItems) => {
  if (!audioItems || audioItems.length < 2) return "";
  let currentTime = 0;
  return audioItems.map(item => {
    const timestamp = formatDuration(currentTime);
    const title = item.file.name.replace(/\.[^/.]+$/, "");
    currentTime += item.durationSec || 0;
    return `${timestamp} ${title}`;
  }).join("\n");
};

const buildAutoDescription = (tracklist) =>
  tracklist ? `${tracklist}\n\n${YT_FOOTER}` : YT_FOOTER;

function createFFmpegCommand(configs) {
  try {
    const { audioInputs = [], imageInputs = [], outputFilepath, width = 1920, height = 1080, backgroundColor = "black", totalDurationOverride = null } = configs;
    const cmdArgs = ["-y"];
    let outputDuration = totalDurationOverride !== null ? totalDurationOverride : audioInputs.reduce((acc, a) => acc + (a.duration || 0), 0);
    const imgDuration = (outputDuration || 1) / (imageInputs.length || 1);

    audioInputs.forEach(audio => {
      const startSec = (audio.startTime || "").split(":").reduce((a, t) => 60 * a + +t, 0);
      const endSec = typeof audio.endTime === "string" ? audio.endTime.split(":").reduce((a, t) => 60 * a + +t, 0) : audio.endTime;
      if (audio.startTime && audio.endTime) { cmdArgs.push("-ss", String(startSec), "-to", String(endSec)); }
      cmdArgs.push("-i", audio.filepath.replace(/\\/g, "/"));
    });

    imageInputs.forEach(image => { cmdArgs.push("-r", "2", "-i", image.filepath.replace(/\\/g, "/")); });

    let fc = "";
    if (audioInputs.length > 0) { fc += audioInputs.map((_, i) => `[${i}:a]`).join("") + `concat=n=${audioInputs.length}:v=0:a=1[a];`; }

    imageInputs.forEach((image, index) => {
      const imgIndex = audioInputs.length + index;
      const loop = Math.round(imgDuration * 2);
      if (image.useBlurBackground) {
        fc += `[${imgIndex}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,boxblur=20:20,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,setsar=1[bg${index}];`;
        fc += `[${imgIndex}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease,setsar=1,loop=${loop}:${loop}[fg${index}];`;
        fc += `[bg${index}][fg${index}]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1,loop=${loop}:${loop}[v${index}];`;
      } else {
        const scale = image.stretchImageToFit ? `scale=w=${width}:h=${height}` : `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease`;
        const pad = image.stretchImageToFit ? "" : `,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${image.paddingColor || backgroundColor}`;
        fc += `[${imgIndex}:v]${scale}${pad},setsar=1,loop=${loop}:${loop}[v${index}];`;
      }
    });

    if (imageInputs.length > 0) { fc += imageInputs.map((_, i) => `[v${i}]`).join("") + `concat=n=${imageInputs.length}:v=1:a=0,pad=ceil(iw/2)*2:ceil(ih/2)*2[v]`; }
    if (fc) { cmdArgs.push("-filter_complex", fc); if (imageInputs.length > 0) cmdArgs.push("-map", "[v]"); if (audioInputs.length > 0) cmdArgs.push("-map", "[a]"); }

    const isMP4 = outputFilepath.toLowerCase().endsWith(".mp4");
    if (isMP4) { cmdArgs.push("-c:a","aac","-b:a","320k","-c:v","h264","-movflags","+faststart","-profile:v","high","-level:v","4.2"); }
    else { cmdArgs.push("-c:a","pcm_s32le","-c:v","libx264"); }
    cmdArgs.push("-bufsize","3M","-crf","18","-pix_fmt","yuv420p","-tune","stillimage","-t",String(outputDuration || 5),outputFilepath);

    return { cmdArgs, outputDuration, commandString: cmdArgs.join(" ") };
  } catch (error) { return { error: error.message }; }
}

const apiBaseURL = () => process.env.NODE_ENV === "development" ? "http://localhost:3030" : "https://www.martinbarker.me/internal-api";

// ---------- Timeline Preview ----------
const AUDIO_COLORS = ["#4A90E2","#7B68EE","#50C878","#FF6B6B","#FFA07A","#40E0D0","#DDA0DD","#98FB98"];
const IMG_COLORS   = ["#E8734A","#C08040","#9B8944","#7A7A90","#B05090"];

function VideoTimeline({ audioTracks, imageTracks, totalDuration }) {
  if (!totalDuration || !audioTracks?.length) return null;

  const fmt = secs => {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
    return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
  };

  const niceIntervals = [5,10,15,30,60,120,300,600,1800,3600];
  const rawInterval = totalDuration / 6;
  const tickInterval = niceIntervals.find(n => n >= rawInterval) || 3600;
  const ticks = [];
  for (let t = 0; t <= totalDuration; t += tickInterval) ticks.push(t);
  if (ticks[ticks.length - 1] < totalDuration - 1) ticks.push(totalDuration);

  const imgDuration = totalDuration / Math.max(imageTracks?.length || 1, 1);
  const LABEL_W = 52;

  const TrackRow = ({ label, children }) => (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
      <div style={{ width: LABEL_W, flexShrink: 0, fontSize: 9, color: "#888", textTransform: "uppercase", textAlign: "right", paddingRight: 8, letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ flex: 1, position: "relative", height: 36, background: "rgba(255,255,255,0.04)", borderRadius: 4, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );

  return (
    <div style={{ background: "#12121e", borderRadius: 8, padding: "14px 16px", marginBottom: 20, userSelect: "none" }}>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
        Timeline · {fmt(totalDuration)} total
      </div>

      <TrackRow label="Audio">
        {(() => {
          let offset = 0;
          return audioTracks.map((track, i) => {
            const leftPct  = (offset / totalDuration) * 100;
            const widthPct = ((track.durationSec || 0) / totalDuration) * 100;
            const startTs  = fmt(offset);
            const endTs    = fmt(offset + (track.durationSec || 0));
            offset += track.durationSec || 0;
            return (
              <div key={i} title={`${track.name}\n${startTs} → ${endTs}`} style={{
                position: "absolute", left: `${leftPct}%`, width: `calc(${widthPct}% - 1px)`,
                height: "100%", background: AUDIO_COLORS[i % AUDIO_COLORS.length],
                borderRadius: 3, boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.12)",
                padding: "3px 5px", overflow: "hidden"
              }}>
                {widthPct > 2 && (
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.92)", lineHeight: 1.3, overflow: "hidden" }}>
                    <div style={{ fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {track.name.replace(/\.[^/.]+$/, "")}
                    </div>
                    {widthPct > 9 && <div style={{ opacity: 0.75 }}>{startTs}–{endTs}</div>}
                  </div>
                )}
              </div>
            );
          });
        })()}
      </TrackRow>

      {imageTracks?.length > 0 && (
        <TrackRow label="Image">
          {imageTracks.map((track, i) => {
            const leftPct  = (i * imgDuration / totalDuration) * 100;
            const widthPct = (imgDuration / totalDuration) * 100;
            return (
              <div key={i} title={`${track.name}\n${fmt(i * imgDuration)} → ${fmt((i + 1) * imgDuration)}`} style={{
                position: "absolute", left: `${leftPct}%`, width: `calc(${widthPct}% - 1px)`,
                height: "100%", background: IMG_COLORS[i % IMG_COLORS.length],
                borderRadius: 3, boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.12)",
                padding: "3px 5px", overflow: "hidden"
              }}>
                {widthPct > 2 && (
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.92)", fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {track.name.replace(/\.[^/.]+$/, "")}
                  </div>
                )}
              </div>
            );
          })}
        </TrackRow>
      )}

      {/* Time axis */}
      <div style={{ display: "flex", paddingLeft: LABEL_W, position: "relative", height: 14 }}>
        <div style={{ flex: 1, position: "relative" }}>
          {ticks.map(t => (
            <span key={t} style={{
              position: "absolute", left: `${(t / totalDuration) * 100}%`,
              fontSize: 9, color: "#555", transform: "translateX(-50%)", whiteSpace: "nowrap"
            }}>
              {fmt(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Step Indicator ----------
function StepIndicator({ currentStep, onStepClick, isRendering }) {
  const steps = ["Add Files", "Settings", "Render", "Result"];
  return (
    <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 32 }}>
      {steps.map((label, i) => (
        <React.Fragment key={i}>
          <div
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: (i < currentStep && !(i === 2 && isRendering)) ? "pointer" : "default" }}
            onClick={() => { if (i < currentStep && !(i === 2 && isRendering) && onStepClick) onStepClick(i); }}
          >
            <div style={{
              width: 34, height: 34, borderRadius: "50%",
              background: i < currentStep ? "#28a745" : i === currentStep ? "#007bff" : "#e9ecef",
              color: i <= currentStep ? "white" : "#adb5bd",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: "bold", fontSize: 14, transition: "background 0.2s",
              boxShadow: i === currentStep ? "0 0 0 3px rgba(0,123,255,0.25)" : "none"
            }}>
              {i < currentStep ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: 11, color: i === currentStep ? "#007bff" : i < currentStep ? "#28a745" : "#adb5bd", fontWeight: i === currentStep ? "bold" : "normal", whiteSpace: "nowrap" }}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 2, background: i < currentStep ? "#28a745" : "#e9ecef", margin: "16px 6px 0" }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------- Main Component ----------
function CombineImageAudioExample() {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const renderAttempted = useRef(false);

  // Files
  const [mediaFiles, setMediaFiles] = useState([]);
  const [selectedAudioIds, setSelectedAudioIds] = useState([]);
  const [selectedImageIds, setSelectedImageIds] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [modalImage, setModalImage] = useState(null);
  const modalUrlRef = useRef(null);

  // Render
  const [videoSrc, setVideoSrc] = useState("");
  const [lastRenderMeta, setLastRenderMeta] = useState(null);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [commandPreview, setCommandPreview] = useState("");
  const renderDurationRef = useRef(null);
  const ffmpegRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadingRef = useRef(false);

  // Settings (persisted)
  const [outputFilename, setOutputFilename] = useState("output");
  const [outputFormat, setOutputFormat] = useState("mp4");
  const [videoWidth, setVideoWidth] = useState("1920");
  const [videoHeight, setVideoHeight] = useState("1080");
  const [backgroundColor, setBackgroundColor] = useState("#000000");

  // YouTube upload
  const [ytAuthState, setYtAuthState] = useState({ canAuth: false });
  const [ytUploadData, setYtUploadData] = useState({ title: "", description: "", privacyStatus: "private", tags: "", thumbnail: null });
  const [thumbnailPreview, setThumbnailPreview] = useState(null);
  const [ytUploading, setYtUploading] = useState(false);
  const [ytUploadProgress, setYtUploadProgress] = useState(null);
  const [ytUploadResult, setYtUploadResult] = useState(null);
  const [ytUploadError, setYtUploadError] = useState("");
  const getTokensRef = useRef(null);
  const thumbnailInputRef = useRef(null);

  // ---------- Mount: restore settings + IDB ----------
  useEffect(() => {
    setMounted(true);
    ffmpegRef.current = new FFmpeg();

    try {
      const fn = localStorage.getItem("ffmpegwasm_outputFilename"); if (fn) setOutputFilename(fn);
      const fmt = localStorage.getItem("ffmpegwasm_outputFormat"); if (fmt) setOutputFormat(fmt);
      const w = localStorage.getItem("ffmpegwasm_videoWidth"); if (w) setVideoWidth(w);
      const h = localStorage.getItem("ffmpegwasm_videoHeight"); if (h) setVideoHeight(h);
      const bg = localStorage.getItem("ffmpegwasm_backgroundColor"); if (bg) setBackgroundColor(bg);
    } catch {}

    loadRenderFromIDB().then(saved => {
      if (!saved) return;
      try {
        const blob = new Blob([saved.buffer], { type: `video/${saved.format || "mp4"}` });
        setVideoSrc(URL.createObjectURL(blob));
        setLastRenderMeta(saved);
        setCurrentStep(3);
        if (saved.filename) setOutputFilename(saved.filename);
        if (saved.tracklist !== undefined) {
          setYtUploadData(prev => ({ ...prev, description: buildAutoDescription(saved.tracklist) }));
        }
      } catch {}
    });
  }, []);

  // Persist settings
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem("ffmpegwasm_outputFilename", outputFilename);
      localStorage.setItem("ffmpegwasm_outputFormat", outputFormat);
      localStorage.setItem("ffmpegwasm_videoWidth", videoWidth);
      localStorage.setItem("ffmpegwasm_videoHeight", videoHeight);
      localStorage.setItem("ffmpegwasm_backgroundColor", backgroundColor);
    } catch {}
  }, [mounted, outputFilename, outputFormat, videoWidth, videoHeight, backgroundColor]);

  // Sync upload title
  useEffect(() => {
    setYtUploadData(prev => ({ ...prev, title: prev.title || outputFilename }));
  }, [outputFilename]);

  // Auto-advance render → result
  useEffect(() => {
    if (currentStep === 2 && renderAttempted.current && !isRendering) {
      if (videoSrc) setCurrentStep(3);
    }
  }, [currentStep, isRendering, videoSrc]);

  // Auto-load ffmpeg
  useEffect(() => {
    if (mounted && !loadingRef.current && !loaded) load(true);
  }, [mounted, loaded]);

  const appendLog = (line) => setLogs(prev => { const next = [...prev, line]; return next.length > 500 ? next.slice(-500) : next; });

  // ---------- File management ----------
  const getMediaById = id => mediaFiles.find(item => item.id === id) || null;
  const totalSelectedDuration = () => selectedAudioIds.map(id => getMediaById(id)).filter(Boolean).reduce((acc, item) => acc + (item.durationSec || 0), 0);
  const formatFileSize = s => s >= 1048576 ? `${(s/1048576).toFixed(2)} MB` : s >= 1024 ? `${(s/1024).toFixed(1)} KB` : `${s} B`;

  const updateDerived = (allFiles) => {
    const audioIdSet = new Set(selectedAudioIds), imageIdSet = new Set(selectedImageIds);
    const audios = allFiles.filter(f => f.file.type.startsWith("audio/"));
    const images = allFiles.filter(f => f.file.type.startsWith("image/"));
    setSelectedAudioIds(audios.map(a => a.id).filter(id => audioIdSet.has(id)));
    setSelectedImageIds(images.map(i => i.id).filter(id => imageIdSet.has(id)));
  };

  const writeToFFmpeg = async (fsName, file) => {
    if (!loaded || !ffmpegRef.current) return;
    try { await ffmpegRef.current.writeFile(fsName, await fetchFile(file)); } catch {}
  };

  const removeFromFFmpeg = async (file) => {
    if (!loaded || !ffmpegRef.current) return;
    try { await ffmpegRef.current.deleteFile(file.name); } catch {}
  };

  const fetchAudioDuration = (file, id) => new Promise(resolve => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(isFinite(audio.duration) ? audio.duration : null); };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    audio.src = url;
  }).then(dur => { if (dur) setMediaFiles(prev => prev.map(item => item.id === id ? { ...item, durationSec: dur } : item)); });

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setMediaFiles(prev => {
      const existing = new Set(prev.map(i => `${i.file.name}-${i.file.size}-${i.file.type}`));
      const additions = files.filter(f => f?.name && !existing.has(`${f.name}-${f.size}-${f.type}`)).map(f => ({
        id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2,8)}`,
        file: f, durationSec: null,
      }));
      const updated = [...prev, ...additions];
      updateDerived(updated);
      additions.forEach(item => writeToFFmpeg(item.file.name, item.file));
      additions.filter(i => i.file.type.startsWith("audio/")).forEach(i => fetchAudioDuration(i.file, i.id));
      return updated;
    });
  };

  const removeFileById = id => {
    setMediaFiles(prev => {
      const target = prev.find(i => i.id === id);
      if (!target) return prev;
      const remaining = prev.filter(i => i.id !== id);
      updateDerived(remaining);
      removeFromFFmpeg(target.file);
      setSelectedAudioIds(c => c.filter(x => x !== id));
      setSelectedImageIds(c => c.filter(x => x !== id));
      return remaining;
    });
  };

  const openModal = (file) => {
    try {
      if (modalUrlRef.current) URL.revokeObjectURL(modalUrlRef.current);
      const url = URL.createObjectURL(file);
      modalUrlRef.current = url;
      setModalImage({ src: url, name: file.name });
    } catch {}
  };
  const closeModal = () => {
    if (modalUrlRef.current) { URL.revokeObjectURL(modalUrlRef.current); modalUrlRef.current = null; }
    setModalImage(null);
  };

  const extractCoverArt = async () => {
    const targetId = selectedAudioIds[0] || mediaFiles.find(m => m.file.type.startsWith("audio/"))?.id;
    if (!targetId) return;
    const audioItem = getMediaById(targetId);
    if (!audioItem || !loaded) return;
    const ffmpeg = ffmpegRef.current;
    const audioFsName = `${audioItem.id}-${audioItem.file.name}`;
    const coverName = `${audioItem.id}-cover.jpg`;
    try {
      await writeToFFmpeg(audioFsName, audioItem.file);
      await ffmpeg.exec(["-i", audioFsName, "-an", "-vcodec", "copy", "-map", "0:v:0", coverName]);
      const data = await ffmpeg.readFile(coverName);
      const coverFile = new File([data.buffer], `${audioItem.file.name}-cover.jpg`, { type: "image/jpeg" });
      addFiles([coverFile]);
    } catch {}
    finally { try { await ffmpeg.deleteFile(audioFsName); await ffmpeg.deleteFile(coverName); } catch {} }
  };

  // ---------- FFmpeg load ----------
  const parseTimeFromLine = line => {
    const m = line.match(/time=([\d:.]+)/);
    if (!m) return null;
    const parts = m[1].split(":").map(Number);
    if (parts.some(p => Number.isNaN(p))) return null;
    return parts.reduce((acc, t) => 60 * acc + t, 0);
  };

  const load = async (isAuto = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on("log", ({ message: msg }) => {
      appendLog(msg);
      if (renderAttempted.current) {
        const elapsed = parseTimeFromLine(msg);
        const total = renderDurationRef.current || 0;
        if (elapsed !== null && total > 0) setProgress(Math.max(0, Math.min(1, elapsed / total)));
      }
    });
    ffmpeg.on("progress", ({ progress: p }) => {
      if (!renderAttempted.current) return;
      setProgress(Math.max(0, Math.min(p, 1)));
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    setLoaded(true);
    loadingRef.current = false;
  };

  // ---------- Render ----------
  const renderVideo = async () => {
    if (isRendering || selectedAudioIds.length === 0 || selectedImageIds.length === 0) return;
    const selectedAudioItems = selectedAudioIds.map(id => getMediaById(id)).filter(Boolean);
    const selectedImageItem = getMediaById(selectedImageIds[0]);
    if (!selectedAudioItems.length || !selectedImageItem) return;

    const safeOutput = outputFilename.trim() || "output";
    const outputFilepath = `${safeOutput}.${outputFormat}`;

    const audioInputs = selectedAudioItems.map(item => ({
      filepath: `${item.id}-${item.file.name}`,
      duration: item.durationSec || 10,
      startTime: "", endTime: ""
    }));
    const imageInputs = [{
      filepath: `${selectedImageItem.id}-${selectedImageItem.file.name}`,
      stretchImageToFit: false,
      paddingColor: backgroundColor,
      useBlurBackground: false
    }];
    const totalDurationSec = totalSelectedDuration();
    const commandResult = createFFmpegCommand({
      audioInputs, imageInputs, outputFilepath,
      width: Number(videoWidth) || 1920,
      height: Number(videoHeight) || 1080,
      backgroundColor,
      totalDurationOverride: totalDurationSec || null
    });
    if (commandResult.error || !commandResult.cmdArgs) { setRenderError(commandResult.error || "Failed to build command"); return; }

    setCommandPreview(commandResult.commandString);
    setIsRendering(true);
    setRenderError("");
    setProgress(0);
    setLogs([`ffmpeg ${commandResult.commandString}`, "Writing input files..."]);
    renderDurationRef.current = commandResult.outputDuration || totalDurationSec || null;
    renderAttempted.current = true;

    const ffmpeg = ffmpegRef.current;
    try {
      for (const item of selectedAudioItems) {
        await writeToFFmpeg(`${item.id}-${item.file.name}`, item.file);
      }
      await writeToFFmpeg(`${selectedImageItem.id}-${selectedImageItem.file.name}`, selectedImageItem.file);
      await ffmpeg.exec(commandResult.cmdArgs);
      const data = await ffmpeg.readFile(outputFilepath);
      const url = URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));
      setVideoSrc(url);

      const tracklist = generateTracklist(selectedAudioItems);
      const autoDescription = buildAutoDescription(tracklist);
      setYtUploadData(prev => ({ ...prev, title: prev.title || safeOutput, description: autoDescription }));
      setYtUploadResult(null);
      setYtUploadError("");

      const meta = { buffer: data, filename: safeOutput, format: outputFormat, audioFiles: selectedAudioItems.map(i => ({ name: i.file.name, size: i.file.size, durationSec: i.durationSec })), imageFiles: [{ name: selectedImageItem.file.name, size: selectedImageItem.file.size }], timestamp: Date.now(), tracklist };
      setLastRenderMeta(meta);
      saveRenderToIDB(meta).catch(() => {});
    } catch (err) {
      setRenderError(err?.message || "Render failed");
      appendLog(`Render failed: ${err?.message || err}`);
    } finally {
      setIsRendering(false);
      setProgress(null);
      renderDurationRef.current = null;
    }
  };

  const stopRender = async () => {
    try { await ffmpegRef.current?.exit?.(); } catch {}
    setIsRendering(false);
    setProgress(null);
    renderDurationRef.current = null;
    setRenderError("Render stopped.");
  };

  const clearAll = async () => {
    if (isRendering) { await stopRender(); }
    setMediaFiles([]);
    setSelectedAudioIds([]);
    setSelectedImageIds([]);
    setVideoSrc("");
    setLastRenderMeta(null);
    setLogs([]);
    setRenderError("");
    setProgress(null);
    renderAttempted.current = false;
    setYtUploadResult(null);
    setYtUploadError("");
    if (thumbnailPreview) { URL.revokeObjectURL(thumbnailPreview); setThumbnailPreview(null); }
    setYtUploadData(prev => ({ ...prev, thumbnail: null }));
    setCurrentStep(0);
    clearRenderFromIDB();
  };

  // ---------- YouTube Upload ----------
  const handleThumbnailFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
    setThumbnailPreview(URL.createObjectURL(file));
    setYtUploadData(prev => ({ ...prev, thumbnail: file }));
  };

  const uploadToYouTube = async () => {
    if (!videoSrc || ytUploading) return;
    setYtUploading(true);
    setYtUploadProgress(0);
    setYtUploadError("");
    setYtUploadResult(null);
    try {
      const tokens = await getTokensRef.current?.getTokens();
      if (!tokens) { setYtUploadError("Not signed in to YouTube."); setYtUploading(false); return; }
      const videoBlob = await fetch(videoSrc).then(r => r.blob());
      const fd = new FormData();
      fd.append("video", videoBlob, `${ytUploadData.title || outputFilename}.${outputFormat}`);
      fd.append("title", ytUploadData.title || outputFilename);
      fd.append("description", ytUploadData.description || "");
      fd.append("privacyStatus", ytUploadData.privacyStatus || "private");
      fd.append("tags", ytUploadData.tags || "");
      fd.append("tokens", JSON.stringify(tokens));
      if (ytUploadData.thumbnail) fd.append("thumbnail", ytUploadData.thumbnail, ytUploadData.thumbnail.name);

      await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${apiBaseURL()}/youtube/uploadVideo`);
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setYtUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) setYtUploadResult(data);
            else setYtUploadError(data.error || `Upload failed (${xhr.status})`);
          } catch { setYtUploadError("Failed to parse server response"); }
          resolve();
        };
        xhr.onerror = () => { setYtUploadError("Network error during upload"); resolve(); };
        xhr.send(fd);
      });
    } catch (err) { setYtUploadError(err.message || "Upload failed"); }
    finally { setYtUploading(false); setYtUploadProgress(null); }
  };

  const renderAge = lastRenderMeta?.timestamp ? (() => {
    const diff = Date.now() - lastRenderMeta.timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  })() : null;

  const canGoToSettings = selectedAudioIds.length > 0 && selectedImageIds.length > 0;

  if (!mounted) return null;

  const BtnPrimary = ({ onClick, disabled, children, style = {} }) => (
    <button onClick={onClick} disabled={disabled} style={{ padding: "10px 22px", fontSize: 15, fontWeight: "bold", background: disabled ? "#adb5bd" : "#007bff", color: "white", border: "none", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", transition: "background 0.15s", ...style }}>
      {children}
    </button>
  );
  const BtnSecondary = ({ onClick, disabled, children, style = {} }) => (
    <button onClick={onClick} disabled={disabled} style={{ padding: "10px 22px", fontSize: 15, fontWeight: "bold", background: "transparent", color: "#6c757d", border: "1px solid #ced4da", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", ...style }}>
      {children}
    </button>
  );

  return (
    <section
      className={styles["ffmpeg-section"]}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
      onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); }}
    >
      <StepIndicator currentStep={currentStep} isRendering={isRendering} onStepClick={i => { if (!isRendering) setCurrentStep(i); }} />

      {/* ===== STEP 0: ADD FILES ===== */}
      {currentStep === 0 && (
        <div>
          <div
            className={`${styles.dropZone} ${isDragging ? styles.dragActive : ""}`}
            onClick={() => fileInputRef.current?.click()}
            style={{ marginBottom: 24 }}
          >
            <p className={styles.dropZoneTitle}>Drag & drop audio and image files here</p>
            <p className={styles.dropZoneSubtitle}>Or click to browse · Audio + at least one image required</p>
            <input ref={fileInputRef} type="file" multiple onChange={e => addFiles(e.target.files)} accept="audio/*,video/*,image/*" className={styles.hiddenFileInput} />
          </div>

          <div className={styles["files-display"]}>
            <Table
              title="Audio Files"
              data={mediaFiles.filter(i => i.file.type.startsWith("audio/")).map(i => ({ id: i.id, name: i.file.name, size: formatFileSize(i.file.size), length: formatDuration(i.durationSec), file: i.file }))}
              setData={rows => setMediaFiles(prev => { const audios = prev.filter(p => p.file.type.startsWith("audio/")); const images = prev.filter(p => p.file.type.startsWith("image/")); const m = new Map(audios.map(a => [a.id, a])); return [...rows.map(r => m.get(r.id)).filter(Boolean), ...images]; })}
              selectedIds={selectedAudioIds}
              onSelectionChange={setSelectedAudioIds}
              onRemove={removeFileById}
              columns={[
                { header: "Name", accessorKey: "name", cell: info => info.getValue() },
                { header: "Size", accessorKey: "size", cell: info => info.getValue() },
                { header: "Length", accessorKey: "length", cell: info => info.getValue() },
              ]}
            />
            <Table
              title="Image Files"
              data={mediaFiles.filter(i => i.file.type.startsWith("image/")).map(i => ({ id: i.id, name: i.file.name, size: formatFileSize(i.file.size), preview: URL.createObjectURL(i.file), file: i.file }))}
              setData={rows => setMediaFiles(prev => { const images = prev.filter(p => p.file.type.startsWith("image/")); const audios = prev.filter(p => p.file.type.startsWith("audio/")); const m = new Map(images.map(i => [i.id, i])); return [...audios, ...rows.map(r => m.get(r.id)).filter(Boolean)]; })}
              selectedIds={selectedImageIds}
              onSelectionChange={setSelectedImageIds}
              onRemove={removeFileById}
              columns={[
                { header: "Preview", accessorKey: "preview", cell: info => <img src={info.getValue()} alt={info.row.original.name} className={styles.thumbnailImg} onClick={() => openModal(info.row.original.file)} /> },
                { header: "Name", accessorKey: "name", cell: info => info.getValue() },
                { header: "Size", accessorKey: "size", cell: info => info.getValue() },
              ]}
            />
          </div>

          {mediaFiles.length > 0 && (
            <div className={styles.selectionSummary} style={{ marginBottom: 8 }}>
              <span>{selectedAudioIds.length} audio selected</span>
              <span>{selectedImageIds.length} image selected</span>
              <span>Runtime: {formatDuration(totalSelectedDuration())}</span>
              {selectedAudioIds.length > 0 && (
                <button className={styles.smallButton} onClick={extractCoverArt}>Extract cover art</button>
              )}
            </div>
          )}

          {(selectedAudioIds.length > 0 || selectedImageIds.length > 0) && (
            <VideoTimeline
              audioTracks={selectedAudioIds.map(id => getMediaById(id)).filter(Boolean).map(i => ({ name: i.file.name, durationSec: i.durationSec || 0 }))}
              imageTracks={selectedImageIds.map(id => getMediaById(id)).filter(Boolean).map(i => ({ name: i.file.name }))}
              totalDuration={totalSelectedDuration()}
            />
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 13, color: "#6c757d" }}>
                FFmpeg core: {loaded ? "✓ Ready" : "Loading…"}
              </span>
              {mediaFiles.length > 0 && (
                <button onClick={clearAll} style={{ fontSize: 13, padding: "4px 10px", background: "none", border: "1px solid #dc3545", borderRadius: 4, color: "#dc3545", cursor: "pointer" }}>
                  Clear all & restart
                </button>
              )}
            </div>
            <BtnPrimary onClick={() => setCurrentStep(1)} disabled={!canGoToSettings}>
              Next: Settings →
            </BtnPrimary>
          </div>
        </div>
      )}

      {/* ===== STEP 1: SETTINGS ===== */}
      {currentStep === 1 && (
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 20, fontSize: 20 }}>Render Settings</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057" }}>Output Filename</span>
              <input type="text" value={outputFilename} onChange={e => setOutputFilename(e.target.value)} placeholder="output"
                style={{ padding: "9px 12px", border: "1px solid #ced4da", borderRadius: 6, fontSize: 14 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057" }}>Format</span>
              <select value={outputFormat} onChange={e => setOutputFormat(e.target.value)}
                style={{ padding: "9px 12px", border: "1px solid #ced4da", borderRadius: 6, fontSize: 14, background: "white" }}>
                <option value="mp4">mp4</option>
                <option value="mkv">mkv</option>
                <option value="webm">webm</option>
                <option value="avi">avi</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057" }}>Width (px)</span>
              <input type="number" value={videoWidth} onChange={e => setVideoWidth(e.target.value)} min="1" max="7680"
                style={{ padding: "9px 12px", border: "1px solid #ced4da", borderRadius: 6, fontSize: 14 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057" }}>Height (px)</span>
              <input type="number" value={videoHeight} onChange={e => setVideoHeight(e.target.value)} min="1" max="4320"
                style={{ padding: "9px 12px", border: "1px solid #ced4da", borderRadius: 6, fontSize: 14 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057" }}>Background Color</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="color" value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)}
                  style={{ width: 44, height: 38, padding: 2, border: "1px solid #ced4da", borderRadius: 6, cursor: "pointer" }} />
                <span style={{ fontSize: 13, color: "#6c757d", fontFamily: "monospace" }}>{backgroundColor}</span>
              </div>
            </label>
          </div>

          <div style={{ padding: "12px 16px", background: "#f8f9fa", borderRadius: 6, marginBottom: 24, fontSize: 13, color: "#6c757d" }}>
            <strong>{selectedAudioIds.length}</strong> audio track{selectedAudioIds.length !== 1 ? "s" : ""} · <strong>{selectedImageIds.length}</strong> image · <strong>{formatDuration(totalSelectedDuration())}</strong> runtime → <strong>{outputFilename || "output"}.{outputFormat}</strong> at {videoWidth}×{videoHeight}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <BtnSecondary onClick={() => setCurrentStep(0)}>← Back</BtnSecondary>
            <BtnPrimary onClick={() => { setCurrentStep(2); renderVideo(); }} disabled={!loaded}>
              {loaded ? "Render Video →" : "Loading FFmpeg…"}
            </BtnPrimary>
            <button onClick={clearAll} style={{ marginLeft: "auto", fontSize: 13, padding: "4px 10px", background: "none", border: "1px solid #dc3545", borderRadius: 4, color: "#dc3545", cursor: "pointer" }}>
              Clear all & restart
            </button>
          </div>
        </div>
      )}

      {/* ===== STEP 2: RENDER ===== */}
      {currentStep === 2 && (
        <div>
          {isRendering ? (
            <>
              <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 20 }}>Rendering…</h2>
              {progress !== null && (
                <div style={{ marginBottom: 20 }}>
                  <div className={styles["progress-bar"]}>
                    <div className={styles["progress-fill"]} style={{ width: `${progress * 100}%` }} />
                    <span className={styles["progress-text"]}>{(progress * 100).toFixed(1)}%</span>
                  </div>
                </div>
              )}
              <button onClick={stopRender}
                style={{ padding: "8px 18px", background: "#dc3545", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, marginBottom: 20 }}>
                Stop Render
              </button>
            </>
          ) : (
            <>
              {renderError && (
                <div style={{ padding: "16px", background: "#f8d7da", border: "1px solid #f5c6cb", borderRadius: 6, marginBottom: 20 }}>
                  <div style={{ color: "#721c24", fontWeight: "bold", marginBottom: 8 }}>Render failed</div>
                  <div style={{ color: "#721c24", fontFamily: "monospace", fontSize: 13 }}>{renderError}</div>
                </div>
              )}
              <div style={{ display: "flex", gap: 12 }}>
                <BtnSecondary onClick={() => setCurrentStep(1)}>← Back to Settings</BtnSecondary>
                <BtnPrimary onClick={() => { renderAttempted.current = true; renderVideo(); }}>Try Again</BtnPrimary>
              </div>
            </>
          )}

          <div style={{ marginTop: 16 }}>
            <button onClick={() => setShowLogs(v => !v)}
              style={{ background: "none", border: "none", color: "#6c757d", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 }}>
              {showLogs ? "▼" : "▶"} FFmpeg Logs {logs.length > 0 ? `(${logs.length} lines)` : ""}
            </button>
            {showLogs && (
              <div className={styles.logBox} style={{ maxHeight: 250 }}>
                {logs.map((line, i) => <div key={i} className={styles.logLine}>{line}</div>)}
              </div>
            )}
          </div>

          {!isRendering && (
            <div style={{ marginTop: 16 }}>
              <button onClick={clearAll} style={{ fontSize: 13, padding: "4px 10px", background: "none", border: "1px solid #dc3545", borderRadius: 4, color: "#dc3545", cursor: "pointer" }}>
                Clear all & restart
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== STEP 3: RESULT ===== */}
      {currentStep === 3 && (
        <div>
          {lastRenderMeta && renderAge && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#e7f3ff", border: "1px solid #b3d9ff", borderRadius: 6, fontSize: 13, color: "#004085" }}>
              {lastRenderMeta.timestamp && Date.now() - lastRenderMeta.timestamp > 30000 ? "Restored from last render" : "Render complete"} ({renderAge}) · {lastRenderMeta.audioFiles?.length ?? "?"} audio + {lastRenderMeta.imageFiles?.length ?? "?"} image → {lastRenderMeta.filename}.{lastRenderMeta.format}
            </div>
          )}

          {lastRenderMeta?.audioFiles?.length > 0 && (
            <VideoTimeline
              audioTracks={lastRenderMeta.audioFiles}
              imageTracks={lastRenderMeta.imageFiles}
              totalDuration={lastRenderMeta.audioFiles.reduce((a, f) => a + (f.durationSec || 0), 0)}
            />
          )}

          <div className={styles.videoFrame} style={{ marginBottom: 16 }}>
            <video src={videoSrc} controls style={{ width: "100%", borderRadius: 8 }} />
          </div>

          <button
            onClick={() => { const a = document.createElement("a"); a.href = videoSrc; a.download = `${lastRenderMeta?.filename || outputFilename}.${lastRenderMeta?.format || outputFormat}`; a.click(); }}
            style={{ padding: "9px 20px", fontSize: 14, fontWeight: "bold", background: "#28a745", color: "white", border: "none", borderRadius: 6, cursor: "pointer", marginBottom: 24 }}
          >
            Download Video
          </button>

          {/* YouTube Upload Panel — open by default */}
          <div style={{ border: "1px solid #dee2e6", borderRadius: 8, overflow: "hidden", marginBottom: 24 }}>
            <div style={{ padding: "14px 18px", background: "#f8f9fa", borderBottom: "1px solid #dee2e6", fontWeight: "bold", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#ff0000", fontSize: 18 }}>▶</span> Upload to YouTube
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ marginBottom: 16 }}>
                <YouTubeAuth compact={true} returnUrl="/ffmpegwasm" getTokensRef={getTokensRef} onAuthStateChange={setYtAuthState} />
              </div>

              {ytAuthState.canAuth ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: "1 / -1" }}>
                      <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057" }}>Title</span>
                      <input type="text" value={ytUploadData.title} onChange={e => setYtUploadData(p => ({ ...p, title: e.target.value }))} placeholder={outputFilename}
                        style={{ padding: "9px 12px", border: "1px solid #ced4da", borderRadius: 6, fontSize: 14 }} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: "1 / -1" }}>
                      <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057" }}>Description</span>
                      <textarea value={ytUploadData.description} onChange={e => setYtUploadData(p => ({ ...p, description: e.target.value }))} rows={2} placeholder="Optional description"
                        style={{ padding: "9px 12px", border: "1px solid #ced4da", borderRadius: 6, fontSize: 14, resize: "vertical" }} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057" }}>Tags</span>
                      <input type="text" value={ytUploadData.tags} onChange={e => setYtUploadData(p => ({ ...p, tags: e.target.value }))} placeholder="tag1, tag2, tag3"
                        style={{ padding: "9px 12px", border: "1px solid #ced4da", borderRadius: 6, fontSize: 14 }} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057" }}>Visibility</span>
                      <select value={ytUploadData.privacyStatus} onChange={e => setYtUploadData(p => ({ ...p, privacyStatus: e.target.value }))}
                        style={{ padding: "9px 12px", border: "1px solid #ced4da", borderRadius: 6, fontSize: 14, background: "white" }}>
                        <option value="private">Private</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="public">Public</option>
                      </select>
                    </label>
                  </div>

                  {/* Thumbnail */}
                  <div style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 13, fontWeight: "bold", color: "#495057", display: "block", marginBottom: 6 }}>Thumbnail (optional)</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div
                        onClick={() => thumbnailInputRef.current?.click()}
                        style={{ width: 120, height: 68, border: "2px dashed #ced4da", borderRadius: 6, cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f9fa", flexShrink: 0 }}
                      >
                        {thumbnailPreview ? <img src={thumbnailPreview} alt="thumbnail" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "#adb5bd", textAlign: "center", padding: 8 }}>Click to upload image</span>}
                      </div>
                      <input ref={thumbnailInputRef} type="file" accept="image/*" style={{ display: "none" }}
                        onChange={e => { if (e.target.files?.[0]) handleThumbnailFile(e.target.files[0]); }} />
                      {ytUploadData.thumbnail && (
                        <button onClick={() => { setYtUploadData(p => ({ ...p, thumbnail: null })); if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview); setThumbnailPreview(null); }}
                          style={{ fontSize: 12, padding: "4px 10px", background: "none", border: "1px solid #ced4da", borderRadius: 4, cursor: "pointer", color: "#6c757d" }}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <button onClick={uploadToYouTube} disabled={ytUploading}
                    style={{ width: "100%", padding: "12px", fontSize: 15, fontWeight: "bold", background: ytUploading ? "#adb5bd" : "#ff0000", color: "white", border: "none", borderRadius: 6, cursor: ytUploading ? "not-allowed" : "pointer" }}>
                    {ytUploading
                      ? ytUploadProgress < 100 ? `Uploading… ${ytUploadProgress}%` : "Processing…"
                      : "Upload to YouTube"}
                  </button>

                  {ytUploading && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6c757d", marginBottom: 4 }}>
                        <span>{ytUploadProgress < 100 ? "Sending to server…" : "Server processing…"}</span>
                        <span>{ytUploadProgress < 100 ? `${ytUploadProgress}%` : "100% ✓"}</span>
                      </div>
                      <div style={{ height: 6, background: "#e9ecef", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: 3, transition: "width 0.3s ease",
                          background: ytUploadProgress < 100 ? "#ff0000" : "#28a745",
                          width: `${ytUploadProgress ?? 0}%`
                        }} />
                      </div>
                      {ytUploadProgress >= 100 && (
                        <div style={{ fontSize: 11, color: "#6c757d", marginTop: 4 }}>
                          Upload complete — waiting for YouTube to confirm…
                        </div>
                      )}
                    </div>
                  )}

                  {ytUploadError && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "#f8d7da", border: "1px solid #f5c6cb", borderRadius: 6, fontSize: 13 }}>
                      <span style={{ color: "#721c24", fontWeight: "bold" }}>Error: </span>
                      <span style={{ color: "#721c24", fontFamily: "monospace" }}>{ytUploadError}</span>
                    </div>
                  )}
                  {ytUploadResult && (
                    <div style={{ marginTop: 12, padding: "12px", background: "#d4edda", border: "1px solid #c3e6cb", borderRadius: 6 }}>
                      <div style={{ color: "#155724", fontWeight: "bold", marginBottom: 6 }}>✅ Uploaded!</div>
                      {ytUploadResult.thumbnailUploaded && <div style={{ color: "#155724", fontSize: 13, marginBottom: 4 }}>✓ Custom thumbnail set</div>}
                      <a href={`https://www.youtube.com/watch?v=${ytUploadResult.id}`} target="_blank" rel="noopener noreferrer"
                        style={{ color: "#007bff", fontWeight: "bold", fontSize: 14 }}>View on YouTube →</a>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>Sign in above to upload your video to YouTube.</p>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <BtnSecondary onClick={() => { setCurrentStep(0); }}>
              ← Back to Files
            </BtnSecondary>
            <button onClick={clearAll} style={{ fontSize: 13, padding: "4px 10px", background: "none", border: "1px solid #dc3545", borderRadius: 4, color: "#dc3545", cursor: "pointer" }}>
              Clear all & restart
            </button>
          </div>
        </div>
      )}

      {/* Image modal */}
      {modalImage && (
        <div className={styles.modalBackdrop} onClick={closeModal}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={closeModal}>✕</button>
            <img src={modalImage.src} alt={modalImage.name} className={styles.modalImage} />
            <div className={styles.modalCaption}>{modalImage.name}</div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function Home() {
  return (
    <main className={styles["ffmpeg-main"]}>
      <CombineImageAudioExample />
    </main>
  );
}
