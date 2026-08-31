"use client";
import React, { useState, useRef, useEffect, useCallback, useContext } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import JSZip from "jszip";
import styles from "./riptag.module.css";
import YouTubeAuth from "../YouTubeAuth/YouTubeAuth";
import RipTagDevPanel from "./DevPanel";
import * as devLog from "./devLog";
import { ColorContext } from "../ColorContext";
import {
  extractTagsFromDiscogs,
  buildTagString,
  sanitizeYouTubeTag,
  buildSafeTagList,
  buildSafeTagString,
  youTubeTagCost,
  generateVideoTitleRecommendations,
  buildTimestampDescription,
  formatTimestamp,
  YT_LIMITS,
} from "../../utils/musicMetadata";
import { initFirebase } from "../../utils/firebase";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import {
  blobKey, putBlob, getBlob, deleteBlob, getFile,
  listProjects as storeListProjects, getProject as storeGetProject,
  putProject as storePutProject, deleteProject as storeDeleteProject,
  deleteAllProjects as storeDeleteAllProjects, trimProjectAssets,
  estimateStorage, requestPersistence,
  idbSave, idbLoad, idbDelete,
} from "./riptagStore";
import * as renderQueue from "./renderQueue";

// ---- Helpers ----
// The one duration/timestamp format for the whole page: hh:mm:ss once past an
// hour, mm:ss below it. Minutes never run past 59 — a 5h15m rip reads
// 05:15:43, not 315:43. Truncates rather than rounds so a displayed time never
// reads past the point it refers to.
function formatTime(s) {
  if (!Number.isFinite(s) || s < 0) return "00:00";
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const p = (n) => n.toString().padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

// Alias kept for the clip panel, which reads and writes the same format.
const formatClock = formatTime;

// Parse "H:MM:SS", "M:SS", or a plain seconds value into seconds.
function parseClock(str) {
  if (str == null) return 0;
  const s = String(str).trim();
  if (s === "") return 0;
  const parts = s.split(":");
  if (parts.length === 1) return Math.max(0, parseFloat(parts[0]) || 0);
  let sec = 0;
  for (const p of parts) sec = sec * 60 + (parseFloat(p) || 0);
  return Math.max(0, sec);
}

// Duration from the container header via an <audio> metadata read. Decoding a
// file just to measure it costs ~6 GB of RAM for a multi-hour rip and throws,
// which used to leave the track recorded as 0 seconds long.
function probeAudioDuration(url) {
  return new Promise((resolve) => {
    const a = new Audio();
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      a.removeAttribute("src");
      resolve(Number.isFinite(v) && v > 0 ? v : 0);
    };
    a.addEventListener("loadedmetadata", () => done(a.duration));
    a.addEventListener("error", () => done(0));
    a.preload = "metadata";
    a.src = url;
  });
}

function formatBytes(b) {
  if (!b) return "0 KB";
  if (b >= 1048576) return (b / 1048576).toFixed(2) + " MB";
  return (b / 1024).toFixed(0) + " KB";
}

// ---- Timeline colors ----
const AUDIO_COLORS = ["#667eea","#764ba2","#f093fb","#4facfe","#43e97b","#fa709a","#fee140","#30cfd0"];
const IMG_COLORS   = ["#f7971e","#12c2e9","#f64f59","#c471ed","#11998e","#ee0979","#ff6a00","#3f5efb"];

// ---- Image motion (Ken Burns) ----
// Applied to the composed frame (after letterbox / blur-bg compositing) via
// zoompan. STILL_FPS is enough for a static slideshow; anything with motion
// has to be encoded at a real frame rate, which costs a lot more time.
const IMAGE_MOTIONS = [
  { value: "none",      label: "Still (no motion)", short: "still" },
  { value: "zoom-in",   label: "Zoom in",           short: "zoom in" },
  { value: "zoom-out",  label: "Zoom out",          short: "zoom out" },
  { value: "pan-right", label: "Pan left → right",  short: "pan →" },
  { value: "pan-left",  label: "Pan right → left",  short: "pan ←" },
  { value: "pan-down",  label: "Pan top → bottom",  short: "pan ↓" },
  { value: "pan-up",    label: "Pan bottom → top",  short: "pan ↑" },
];
// CSS-module class that mimics each motion in the in-table preview.
const MOTION_PREVIEW_CLASS = {
  "zoom-in": "motionZoomIn",
  "zoom-out": "motionZoomOut",
  "pan-right": "motionPanRight",
  "pan-left": "motionPanLeft",
  "pan-down": "motionPanDown",
  "pan-up": "motionPanUp",
};
const BG_MOTIONS = [
  { value: "none",  label: "Static blur", short: "static bg" },
  { value: "drift", label: "Slow drift",  short: "drifting bg" },
];
const MOTION_ZOOM = 1.25;      // how far zoom/pan moves (1.25 = 25%)
// Speed is relative to the image's own on-screen time: 1× sweeps the full
// travel exactly once across the segment, 2× sweeps out and back, 0.5× covers
// half of it. Foreground and background speeds are stored separately per image.
const MOTION_SPEED_MIN = 0.25;
const MOTION_SPEED_MAX = 4;
const MOTION_SPEED_STEP = 0.25;
const clampMotionSpeed = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return 1;
  return Math.min(MOTION_SPEED_MAX, Math.max(MOTION_SPEED_MIN, n));
};
const STILL_FPS = 2;           // frame rate for motionless slideshows

// The ffmpeg core is ~32 MB. It was fetched and turned into blob URLs on every
// single render — once per batch video — which is the bulk of the wait before
// anything starts happening. The URLs stay valid for the life of the page, so
// build them once and hand the same pair to every FFmpeg instance. (Each render
// still gets its own FFmpeg worker; only the core download is shared.)
const FFMPEG_CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
let ffmpegCorePromise = null;
function loadFFmpegCore() {
  if (!ffmpegCorePromise) {
    ffmpegCorePromise = (async () => ({
      coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    }))();
    // A failed fetch must not poison every later render.
    ffmpegCorePromise.catch(() => { ffmpegCorePromise = null; });
  }
  return ffmpegCorePromise;
}

// Downscaled copies of source images, reused across renders: a batch re-renders
// the same image once per track, and repeated renders of one project redo the
// identical work. Weakly keyed on the source File so nothing is pinned.
const downscaleCache = new WeakMap(); // File -> Map<maxDim, result>

// Re-encoding to PNG was the slow half of preparing an image for the encoder —
// canvas PNG encoding is slow and the result is large for ffmpeg to read back.
// Photographic sources go out as high-quality JPEG instead; PNG sources stay
// PNG so any transparency survives.
async function computeDownscale(file, maxDim) {
  const isPng = /png/i.test(file.type || "") || /\.png$/i.test(file.name || "");
  const outType = isPng ? "image/png" : "image/jpeg";
  const quality = isPng ? undefined : 0.92;
  const ext = isPng ? "png" : "jpg";

  const draw = (source, nw, nh) => new Promise((resolve) => {
    if (!nw || !nh || Math.max(nw, nh) <= maxDim) {
      resolve({ file, resized: false, original: { w: nw, h: nh } });
      return;
    }
    const scale = maxDim / Math.max(nw, nh);
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(source, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) { resolve({ file, resized: false, original: { w: nw, h: nh } }); return; }
      const newName = file.name.replace(/(\.[^.]+)?$/, `_resized_${w}x${h}.${ext}`);
      resolve({
        file: new File([blob], newName, { type: outType }),
        resized: true, original: { w: nw, h: nh }, resizedTo: { w, h },
      });
    }, outType, quality);
  });

  // Off-thread decode, so a huge scan doesn't freeze the tab mid-render.
  if (typeof createImageBitmap === "function") {
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch { bmp = null; }
    if (bmp) {
      try { return await draw(bmp, bmp.width, bmp.height); }
      finally { try { bmp.close(); } catch {} }
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const out = await draw(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ file, resized: false }); };
    img.src = url;
  });
}
// Background blur strength, 0-100. 100 reproduces the look the render has
// always had. Expressed as a share of the frame width so a 4K render and a 720p
// one are blurred the same amount relative to the picture, not in raw pixels.
// 100 is the strength the render has always used, kept as the reference point
// so an existing project looks unchanged. The scale runs past it because that
// turned out not to be blurry enough for a backdrop.
const BG_BLUR_DEFAULT = 175;
const BG_BLUR_MAX = 400;
const BG_BLUR_MAX_SIGMA_PCT = 0.027;
// Repeated box passes approximate a Gaussian; three is where it stops being
// visibly boxy. The old expression used twenty, which is ~7x the work for no
// visible difference — the radius below is scaled to match its blur strength
// (sigma ~= radius * sqrt(passes / 3)), so the picture is unchanged.
const BG_BLUR_PASSES = 3;
const clampBgBlur = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(BG_BLUR_MAX, Math.round(n))) : BG_BLUR_DEFAULT;
};
// The boxblur clause for a frame `width` px wide, or "" when blur is off.
const bgBlurFilter = (width, blurPct) => {
  const pct = clampBgBlur(blurPct);
  if (pct === 0) return "";
  // Past roughly a quarter of the frame the kernel is wider than the picture,
  // so a bigger radius costs time without looking any softer.
  const radius = Math.max(1, Math.min(
    Math.round(width / 4),
    Math.round(width * BG_BLUR_MAX_SIGMA_PCT * (pct / 100)),
  ));
  return `,boxblur=${radius}:${BG_BLUR_PASSES}`;
};
const BG_DRIFT_ZOOM = 1.2;     // blur bg is scaled this much larger so it has room to drift
const BG_DRIFT_AMOUNT = 0.06;  // drift travel, as a fraction of the output size
const BG_DRIFT_PERIOD = 24;    // seconds for one full drift cycle

// ---- Text overlay ----
// The overlay is rasterised in the browser with a 2D canvas at the output
// resolution and handed to FFmpeg as a transparent PNG per segment. That keeps
// the on-page preview and the encoded frame pixel-identical, and avoids relying
// on drawtext/libfreetype being compiled into the ffmpeg.wasm core.
const OVERLAY_FONTS = [
  { label: "Arial",           value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica",       value: "Helvetica, Arial, sans-serif" },
  { label: "Verdana",         value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma",          value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS",    value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Impact",          value: "Impact, Haettenschweiler, sans-serif" },
  { label: "Georgia",         value: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier New",     value: "'Courier New', Courier, monospace" },
  { label: "System UI",       value: "system-ui, -apple-system, sans-serif" },
];
const OVERLAY_POSITIONS = [
  { value: "top-left",      label: "Top left" },
  { value: "top-center",    label: "Top center" },
  { value: "top-right",     label: "Top right" },
  { value: "middle-left",   label: "Middle left" },
  { value: "middle-center", label: "Middle center" },
  { value: "middle-right",  label: "Middle right" },
  { value: "bottom-left",   label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right",  label: "Bottom right" },
];
// Every size below is a percentage of the output *height* (margins use width for
// the horizontal axis), so a look set up at 1080p survives a resolution change.
const DEFAULT_TEXT_OVERLAY = {
  enabled: false,
  source: "track",          // "track" = the playing track's title | "custom"
  customText: "",
  fontFamily: OVERLAY_FONTS[0].value,
  fontSize: 5.5,            // % of output height
  fontWeight: 700,
  italic: false,
  uppercase: false,
  color: "#ffffff",
  outlineWidth: 0,          // % of font size
  outlineColor: "#000000",
  shadow: true,
  bgEnabled: true,
  bgColor: "#000000",
  bgOpacity: 0.55,
  bgPadX: 1.6,              // % of output height
  bgPadY: 0.9,
  bgRadius: 0.8,
  position: "bottom-center",
  marginX: 4,               // % of output width
  marginY: 6,               // % of output height
  maxWidthPct: 88,          // wrap width, % of output width
  // How long the caption stays up once its image appears. "full" spans the
  // whole segment; "seconds" shows it for the first N seconds and then drops it.
  durationMode: "full",     // "full" | "seconds"
  durationSeconds: 5,
};

// Seconds a caption is visible within a segment of `segDur`. null means "the
// whole segment" — the caller then skips the enable expression entirely.
function overlayVisibleFor(o, segDur) {
  if (!o || o.durationMode !== "seconds") return null;
  const n = Number(o.durationSeconds);
  if (!isFinite(n) || n <= 0) return 0;
  // No point gating when it already covers the segment.
  return n >= segDur ? null : n;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function wrapOverlayLines(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${cur} ${words[i]}`;
      if (ctx.measureText(test).width <= maxWidth) cur = test;
      else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);
  }
  return lines;
}

// Output resolution multiplier, shared by both render modes. h264 needs even
// dimensions and every mode clamps the same way, so the maths lives in one
// place rather than once per render path.
const RENDER_SCALES = [0.25, 0.33, 0.5, 0.75, 1, 1.25, 1.5, 2];
const RENDER_MAX_DIM = 7680;
const scaleDimension = (n, scale) => {
  const v = Math.min(RENDER_MAX_DIM, Math.max(2, Math.round(n * (Number(scale) || 1))));
  return Math.max(2, Math.floor(v / 2) * 2);
};

// One list of text-overlay modes for both the Text Overlay section and the
// batch settings panel. The same choice used to be offered through two
// different controls in two different places, which is why they could disagree.
const TEXT_MODE_OPTIONS = [
  { value: "track", label: "Song name (changes per track)" },
  { value: "custom", label: "Custom text (same throughout)" },
  { value: "off", label: "No text" },
];

// Draws the overlay onto an already-sized 2D context. Used both for the
// on-page preview and for the transparent PNG fed to FFmpeg — one code path so
// the two can never drift apart.
function drawTextOverlay(ctx, text, o, w, h) {
  const raw = o.uppercase ? String(text ?? "").toUpperCase() : String(text ?? "");
  if (!raw.trim()) return;
  const fontPx = Math.max(8, Math.round((o.fontSize / 100) * h));
  ctx.save();
  ctx.font = `${o.italic ? "italic " : ""}${o.fontWeight} ${fontPx}px ${o.fontFamily}`;
  ctx.textBaseline = "alphabetic";
  const lines = wrapOverlayLines(ctx, raw, (o.maxWidthPct / 100) * w);
  const lineHeight = Math.round(fontPx * 1.22);
  const textW = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width)));
  const textH = lineHeight * lines.length;
  const padX = Math.round((o.bgPadX / 100) * h);
  const padY = Math.round((o.bgPadY / 100) * h);
  const boxW = textW + padX * 2;
  const boxH = textH + padY * 2;
  const [vPos, hPos] = o.position.split("-");
  const mx = (o.marginX / 100) * w;
  const my = (o.marginY / 100) * h;
  const boxX = Math.round(hPos === "left" ? mx : hPos === "right" ? w - mx - boxW : (w - boxW) / 2);
  const boxY = Math.round(vPos === "top" ? my : vPos === "bottom" ? h - my - boxH : (h - boxH) / 2);

  if (o.bgEnabled && o.bgOpacity > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, o.bgOpacity));
    ctx.fillStyle = o.bgColor;
    roundRectPath(ctx, boxX, boxY, boxW, boxH, (o.bgRadius / 100) * h);
    ctx.fill();
    ctx.restore();
  }

  ctx.textAlign = hPos === "left" ? "left" : hPos === "right" ? "right" : "center";
  const textX = hPos === "left" ? boxX + padX
    : hPos === "right" ? boxX + boxW - padX
    : boxX + boxW / 2;
  if (o.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = Math.round(fontPx * 0.18);
    ctx.shadowOffsetY = Math.round(fontPx * 0.06);
  }
  lines.forEach((line, i) => {
    const y = boxY + padY + lineHeight * i + Math.round(fontPx * 0.86);
    if (o.outlineWidth > 0) {
      ctx.lineWidth = Math.max(1, (o.outlineWidth / 100) * fontPx * 2);
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeStyle = o.outlineColor;
      ctx.strokeText(line, textX, y);
    }
    ctx.fillStyle = o.color;
    ctx.fillText(line, textX, y);
  });
  ctx.restore();
}

// Rasterise one overlay to a transparent PNG File for the ffmpeg VFS.
function renderOverlayPngFile(text, o, w, h, name) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    drawTextOverlay(ctx, text, o, w, h);
    canvas.toBlob((blob) => resolve(blob ? new File([blob], name, { type: "image/png" }) : null), "image/png");
  });
}

// file.arrayBuffer() gives no progress, which on a multi-hundred-megabyte side
// means a spinner for the better part of a minute. Streaming the same read
// yields a real byte count. Falls back to arrayBuffer() where streams aren't
// available, reporting nothing rather than pretending.
async function readFileWithProgress(file, onProgress) {
  if (typeof file.stream !== "function") {
    onProgress?.(0);
    const buf = await file.arrayBuffer();
    onProgress?.(1);
    return buf;
  }
  const total = file.size || 0;
  const reader = file.stream().getReader();
  const chunks = [];
  let read = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    read += value.byteLength;
    // Throttled: a 700 MB file arrives in thousands of chunks, and a setState
    // per chunk would cost more than the read itself.
    const now = performance.now();
    if (total > 0 && now - lastReport > 100) {
      lastReport = now;
      onProgress?.(Math.min(1, read / total));
    }
  }
  onProgress?.(1);
  const out = new Uint8Array(read);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out.buffer;
}

const loadImageElement = (src) => new Promise((resolve, reject) => {
  // An image that is still being processed has no object URL yet. Without this
  // the src becomes the string "null" and the browser fetches /null (a 404).
  if (!src) { reject(new Error("loadImageElement: no source")); return; }
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = reject;
  im.src = src;
});

// A storage write that runs out of room reports itself in three different
// shapes depending on the browser and the API. Recognising it matters because
// the advice — free space, delete a project — is completely different from any
// other storage error.
const isQuotaError = (e) =>
  !!e && (e.name === "QuotaExceededError"
    || e.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || e.code === 22
    || /quota/i.test(e.message || ""));

// Dev-only tracing for the render path. A button that silently does nothing is
// indistinguishable from a button that isn't wired up, so every branch that can
// end a render before it starts announces itself.
const RENDER_DEBUG = process.env.NODE_ENV !== "production";
const rlog = (message, data) => {
  if (!RENDER_DEBUG) return;
  console.log("%c[riptag:render]", "color:#805ad5;font-weight:700", message, data ?? "");
  const level = /ABORT|THREW|ERROR/.test(message) ? "error"
    : /enqueued|ok\b|started/.test(message) ? "ok" : "info";
  devLog.push(level, message, data);
};

// ---- Render timing instrumentation ----------------------------------------
// A render that starts fast and crawls later is the hard one to explain from a
// raw ffmpeg log: the log says what it is doing but never how fast, and the
// queue's line cap means the early part has scrolled away by the time it is
// slow. This records wall-clock per stage, samples the encode rate in short
// windows while a pass runs, and prints a per-decile breakdown at the end —
// which is what actually shows *where* a render loses its speed.
const RENDER_SAMPLE_LOG_MS = 5000;   // how often the live rate line is logged
const RENDER_SAMPLE_CAP = 20000;     // ceiling on retained samples per pass

const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

const fmtWall = (ms) => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s`;
};
const fmtClock = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
           : `${m}:${String(s % 60).padStart(2, "0")}`;
};
const pctOf = (part, whole) => whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : "—";

// Chrome-only, and it does NOT cover the wasm heap ffmpeg actually lives in.
// Useful as a secondary signal (blob/array accumulation on our side), not as
// "the" memory number.
const jsHeapNote = () => {
  const m = typeof performance !== "undefined" && performance.memory;
  if (!m?.usedJSHeapSize) return "";
  return ` · js-heap ${Math.round(m.usedJSHeapSize / 1048576)}MB`;
};

function createRenderTimer(log) {
  const t0 = nowMs();
  let last = t0;
  const entries = [];   // chronological, {kind: "stage" | "pass", ...}
  let pass = null;

  const stage = (label) => {
    const now = nowMs();
    entries.push({ kind: "stage", label, ms: now - last });
    log(`⏱ ${label} — ${fmtWall(now - last)} (total ${fmtWall(now - t0)})${jsHeapNote()}`);
    last = now;
  };

  const beginPass = (label, mediaDur, note = "") => {
    const now = nowMs();
    pass = {
      kind: "pass", label, mediaDur: mediaDur > 0 ? mediaDur : 0,
      startedAt: now, endedAt: null, lastLogAt: now,
      window: { wall: now, media: 0 }, samples: [], maxMedia: 0, lastStatus: "",
    };
    entries.push(pass);
    log(`⏱ ${label}: encoding ${fmtClock(mediaDur)} of media${note ? ` — ${note}` : ""}…`);
    last = now;
  };

  // Fed from every `time=` line ffmpeg prints. `status` carries fps/size/speed
  // off the same line, which is how a slowdown gets correlated with output
  // growth rather than just observed.
  const sample = (mediaSec, status) => {
    if (!pass) return;
    const now = nowMs();
    if (mediaSec > pass.maxMedia) pass.maxMedia = mediaSec;
    if (pass.samples.length < RENDER_SAMPLE_CAP) pass.samples.push({ wall: now - pass.startedAt, media: mediaSec });
    if (status) pass.lastStatus = status;
    if (now - pass.lastLogAt < RENDER_SAMPLE_LOG_MS) return;
    const winSec = (now - pass.window.wall) / 1000;
    const winRate = winSec > 0 ? (mediaSec - pass.window.media) / winSec : 0;
    const avgRate = mediaSec / Math.max(0.001, (now - pass.startedAt) / 1000);
    const pct = pass.mediaDur > 0 ? ` ${((mediaSec / pass.mediaDur) * 100).toFixed(0)}%` : "";
    log(`⏱ ${pass.label}${pct} — ${fmtClock(mediaSec)}/${fmtClock(pass.mediaDur)} encoded in ${fmtWall(now - pass.startedAt)}`
      + ` · ${winRate.toFixed(2)}× now, ${avgRate.toFixed(2)}× avg${status ? ` · ${status}` : ""}${jsHeapNote()}`);
    pass.lastLogAt = now;
    pass.window = { wall: now, media: mediaSec };
  };

  const endPass = () => {
    if (!pass) return;
    pass.endedAt = nowMs();
    const wall = pass.endedAt - pass.startedAt;
    log(`⏱ ${pass.label} finished — ${fmtWall(wall)} for ${fmtClock(pass.maxMedia)} of media `
      + `(${(pass.maxMedia / Math.max(0.001, wall / 1000)).toFixed(2)}× average)`);
    last = pass.endedAt;
    pass = null;
  };

  // Wall time spent on each 10% band of a pass's media. A render that "gets
  // slow halfway" shows up here as the later bands costing multiples of the
  // earlier ones — and if they don't, the slowdown is somewhere else.
  const deciles = (p) => {
    if (!p.samples.length || p.mediaDur <= 0) return [];
    const out = [];
    let prevWall = 0, i = 0;
    for (let d = 1; d <= 10; d++) {
      const target = (p.mediaDur * d) / 10;
      while (i < p.samples.length && p.samples[i].media < target) i++;
      if (i >= p.samples.length) break;
      out.push({ band: `${(d - 1) * 10}-${d * 10}%`, ms: p.samples[i].wall - prevWall });
      prevWall = p.samples[i].wall;
    }
    return out;
  };

  // Printed last, so it survives the queue's log cap even when ffmpeg has been
  // chatty enough to push every heartbeat out of the buffer.
  const summary = () => {
    if (pass) endPass();
    const total = nowMs() - t0;
    log(`⏱ ═══ Render timing — total ${fmtWall(total)} ═══`);
    for (const e of entries) {
      if (e.kind === "stage") { log(`⏱   ${e.label}: ${fmtWall(e.ms)} (${pctOf(e.ms, total)})`); continue; }
      const wall = (e.endedAt || nowMs()) - e.startedAt;
      log(`⏱   ${e.label}: ${fmtWall(wall)} (${pctOf(wall, total)}) — ${fmtClock(e.maxMedia)} of media `
        + `at ${(e.maxMedia / Math.max(0.001, wall / 1000)).toFixed(2)}× average`);
      const bands = deciles(e);
      if (bands.length > 1) {
        const fastest = Math.min(...bands.map(b => b.ms)) || 1;
        for (const b of bands) {
          log(`⏱     ${b.band.padStart(8)} ${fmtWall(b.ms).padStart(8)}  (${(b.ms / fastest).toFixed(1)}× the fastest band)`);
        }
      }
      if (e.lastStatus) log(`⏱     last ffmpeg status: ${e.lastStatus}`);
    }
    log("⏱ ═══ end timing ═══");
  };

  return { stage, beginPass, sample, endPass, summary };
}

// ---- Persistence keys ----
// Projects themselves live in IndexedDB (see riptagStore); localStorage only
// remembers which one was open and holds the pre-projects autosave blob that
// gets migrated into a real project on first run.
const STORAGE_KEY = "vinyl_digitizer_progress";
const ACTIVE_PROJECT_KEY = "riptag_active_project";
// User-saved Text Overlay defaults, applied to new projects.
const TEXT_DEFAULTS_KEY = "riptag_text_overlay_defaults";
const LEGACY_MIGRATED_KEY = "riptag_legacy_migrated";

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
export default function RipTagPage() {
  const { darkMode } = useContext(ColorContext);
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(1);

  // Audio source
  const [audioMode, setAudioMode] = useState("upload");
  const [audioFile, setAudioFile] = useState(null);
  // Every audio file the user has dropped/uploaded/recorded this session
  const [droppedAudioFiles, setDroppedAudioFiles] = useState([]);
  // Per-file duration cache keyed by "name:size", populated asynchronously
  const [audioDurationMap, setAudioDurationMap] = useState({}); // { "name:size": seconds }
  // When >1 files were uploaded in a single drop, prompt user on Step 2 to pick which to edit
  const [pendingAudioFiles, setPendingAudioFiles] = useState([]);
  // Whether the user has acknowledged the audio-file picker on the current visit.
  // Reset whenever the user navigates back to Step 1 so the picker re-shows.
  const [audioPickConfirmed, setAudioPickConfirmed] = useState(false);
  // File keys whose filename cell the user has clicked to expand (no truncation)
  const [expandedFilenames, setExpandedFilenames] = useState(new Set());
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingLevel, setRecordingLevel] = useState(0);

  // Waveform / peaks.js
  const [channelData, setChannelData] = useState(null);
  const [duration, setDuration] = useState(0);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [waveformLoadStatus, setWaveformLoadStatus] = useState(""); // descriptive status text
  // Preparation progress for the selected file: { pct, label }. Step 1 blocks
  // on it, so it has to reflect real work — a spinner that means "something is
  // happening, for an unknown length of time" is what this replaces.
  const [audioPrepStatus, setAudioPrepStatus] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [tracks, setTracks] = useState([]); // [{id, startTime, endTime, name}]
  // Marker JSON panel (the cog in the waveform toolbar): the track boundaries
  // as plain text, so a set of positions can be kept outside the browser and
  // pasted back — into another tab, another machine, or a rebuilt project — for
  // the same recording.
  const [showMarkerJson, setShowMarkerJson] = useState(false);
  const [markerJsonDraft, setMarkerJsonDraft] = useState("");
  // Once the box has been edited it stops tracking the live markers, so a drag
  // on the waveform can't quietly overwrite something half-pasted.
  const [markerJsonDirty, setMarkerJsonDirty] = useState(false);

  // Undo/redo history for waveform marker edits. Snapshots are pushed at the
  // start of drag/split/delete operations; clearing future on each new snapshot
  // matches the "linear history" UX users expect from Ctrl+Z / Ctrl+Y.
  const tracksHistoryRef = useRef([]);
  const tracksFutureRef = useRef([]);
  const HISTORY_LIMIT = 100;
  const snapshotTracks = useCallback(() => {
    tracksHistoryRef.current.push(tracks);
    if (tracksHistoryRef.current.length > HISTORY_LIMIT) tracksHistoryRef.current.shift();
    tracksFutureRef.current = [];
  }, [tracks]);
  const syncPeaksToTracks = useCallback((nextTracks) => {
    const p = peaksRef.current;
    if (!p) return;
    try {
      p.segments.removeAll();
      nextTracks.forEach((track, i) => {
        p.segments.add({
          id: track.id,
          startTime: track.startTime,
          endTime: track.endTime,
          labelText: `${i + 1}. ${track.name}`,
          editable: true,
          color: AUDIO_COLORS[i % AUDIO_COLORS.length],
        });
      });
    } catch {}
  }, []);
  const undoTracks = useCallback(() => {
    if (tracksHistoryRef.current.length === 0) return;
    const prev = tracksHistoryRef.current.pop();
    tracksFutureRef.current.push(tracks);
    setTracks(prev);
    syncPeaksToTracks(prev);
  }, [tracks, syncPeaksToTracks]);
  const redoTracks = useCallback(() => {
    if (tracksFutureRef.current.length === 0) return;
    const next = tracksFutureRef.current.pop();
    tracksHistoryRef.current.push(tracks);
    setTracks(next);
    syncPeaksToTracks(next);
  }, [tracks, syncPeaksToTracks]);

  // Visible time range of the zoomview (for positioning boundary handles)
  const [viewRange, setViewRange] = useState({ start: 0, end: 0 });
  const [zoomviewWidth, setZoomviewWidth] = useState(0);
  // Tracks currently being dragged (live override for handle rendering during drag)
  const dragStateRef = useRef(null);
  const [, forceHandleRender] = useState(0);

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
  const [silMinTrackLen, setSilMinTrackLen] = useState(10); // min seconds per detected track; merges away shorter splits

  // FFmpeg / export
  const [loaded, setLoaded] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeLog, setAnalyzeLog] = useState([]);
  const [showAnalyzeLog, setShowAnalyzeLog] = useState(false);
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
  // ---- Projects ----
  const [projects, setProjects] = useState([]);        // stored project records, newest first
  const [showHistory, setShowHistory] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  // Consecutive autosave failures. Storage that is broken stays broken, and
  // hammering it just floods the console.
  const saveFailuresRef = useRef(0);
  const SAVE_FAILURE_LIMIT = 3;
  const activeProjectIdRef = useRef(null);
  const [projectBusy, setProjectBusy] = useState("");  // "" | "saving" | "loading"
  const [storageInfo, setStorageInfo] = useState(null);
  // Set while switching projects so the autosave effects don't write the
  // half-applied state of a load back over the record being loaded.
  const hydratingRef = useRef(false);
  const [renderJobs, setRenderJobs] = useState([]);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  // Cloud sync (hidden — enable via window.showauth() in the console)
  const [showAuthPanel, setShowAuthPanel] = useState(false);
  const [fb, setFb] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("");
  const [cloudError, setCloudError] = useState("");
  const [cloudSavedAt, setCloudSavedAt] = useState(null);

  // Video render (Step 5)
  const [videoImages, setVideoImages] = useState([]);  // [{id, file, thumbUrl, previewUrl, stretchToFit, useBlurBg, paddingColor, motion, motionSpeed, bgMotion, bgMotionSpeed}]
  const [selectedVideoAudios, setSelectedVideoAudios] = useState(new Set());
  const [selectedVideoImages, setSelectedVideoImages] = useState(new Set());
  const [showImageModal, setShowImageModal] = useState(false);
  const [modalDragOver, setModalDragOver] = useState(false);
  const [isRenderingVideo, setIsRenderingVideo] = useState(false);
  const [videoRenderProgress, setVideoRenderProgress] = useState(null);
  const [videoRenderStartTime, setVideoRenderStartTime] = useState(null);
  const [videoRenderLogs, setVideoRenderLogs] = useState([]);
  const [videoRenderError, setVideoRenderError] = useState(null);
  const [showVideoLogs, setShowVideoLogs] = useState(false);
  // Image downscale ceiling: cap source images at this pixel dimension before rendering. "auto" = 1.25× output max dim.
  const [imageMaxDim, setImageMaxDim] = useState("auto");
  const videoLogsEndRef = useRef(null);
  const [renderedVideoSrc, setRenderedVideoSrc] = useState(null);
  const [videoOutputName, setVideoOutputName] = useState("");
  const [showOutputNamePicker, setShowOutputNamePicker] = useState(false);
  const [videoWidth, setVideoWidth] = useState("1920");
  const [videoHeight, setVideoHeight] = useState("1080");
  const [videoBgColor, setVideoBgColor] = useState("#000000");
  const [ytUploadData, setYtUploadData] = useState({ title: "", description: "", privacyStatus: "private", tags: "" });
  const ytUploadDataRef = useRef(ytUploadData);
  const [ytUploading, setYtUploading] = useState(false);
  const [ytUploadProgress, setYtUploadProgress] = useState(null);
  const [ytUploadResult, setYtUploadResult] = useState(null);
  const [ytUploadError, setYtUploadError] = useState("");
  const [ytUploadAuthError, setYtUploadAuthError] = useState(null); // { reason, raw } when invalid_grant / 401
  const [ytAuthState, setYtAuthState] = useState({ canAuth: false });
  // Clear the upload auth-error banner once the user successfully re-authenticates
  useEffect(() => {
    if (ytAuthState.canAuth && ytUploadAuthError) setYtUploadAuthError(null);
  }, [ytAuthState.canAuth]); // eslint-disable-line react-hooks/exhaustive-deps
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [thumbnailPreview, setThumbnailPreview] = useState(null);
  const [embedArtFile, setEmbedArtFile] = useState(null); // album art to embed in FLAC exports
  const [embedArtPreview, setEmbedArtPreview] = useState(null);
  const embedArtInputRef = useRef(null);
  const [autoUploadYt, setAutoUploadYt] = useState(false);
  const autoUploadYtRef = useRef(false);
  // Whether the user has explicitly toggled the auto-upload ("Queue upload")
  // choice. Until they do, we default it ON as soon as they're signed in.
  const autoUploadUserSetRef = useRef(false);
  // YouTube metadata formatting options
  const [ytTitleVariation, setYtTitleVariation] = useState(0);
  const [ytTimestampFormat, setYtTimestampFormat] = useState("auto"); // "auto", "M:SS", "H:MM:SS"
  const [ytTimestampSeparator, setYtTimestampSeparator] = useState(" ");
  const [ytIncludeTrackNums, setYtIncludeTrackNums] = useState(false);
  const [ytDescSuffix, setYtDescSuffix] = useState("\n\nDigitized with RipTag – https://martinbarker.me/riptag");
  const [ytTitleSuggestions, setYtTitleSuggestions] = useState([]);

  // Video timeline / ordering (Step 5)
  const [slideshowMode, setSlideshowMode] = useState("distribute"); // "distribute" | "loop" | "per-track" | "manual"
  const [loopInterval, setLoopInterval] = useState(10); // seconds per image when mode is "loop"
  const [motionFps, setMotionFps] = useState(24); // output fps when any image has a motion effect
  const [manualImageTimings, setManualImageTimings] = useState({}); // {imgId: {startTime, endTime}}
  const [expandedImgPreviews, setExpandedImgPreviews] = useState(new Set());
  // "title-asc" | "title-desc" | "index" | "manual" — manual is set by a drag,
  // and stops the auto-sort from undoing it.
  const [audioSortMode, setAudioSortMode] = useState("title-asc");
  // Per-audio image pick — {trackIdx: imgId}. Only consulted in "per-track"
  // mode; an unset track falls back to cycling through the selected images.
  const [trackImageAssign, setTrackImageAssign] = useState({});
  // Per-track caption overrides: { [trackIdx]: { text?, position? } }. Applies
  // to both the concat render's per-track captions and to batch videos, so
  // there's one place to edit them rather than two.
  const [trackTextOverrides, setTrackTextOverrides] = useState({});
  const [showTextPerTrack, setShowTextPerTrack] = useState(false);
  // Text burned over the video (song title or a fixed custom string).
  const [textOverlay, setTextOverlay] = useState(DEFAULT_TEXT_OVERLAY);
  // Open by default — the preview is the fastest way to see what the overlay
  // settings actually do, and it costs nothing until text is switched on.
  const [showTextPreview, setShowTextPreview] = useState(true);
  const [textPreviewImgId, setTextPreviewImgId] = useState(null);
  const [textPreviewTrackIdx, setTextPreviewTrackIdx] = useState(null);
  const [textPreviewBusy, setTextPreviewBusy] = useState(false);
  const textPreviewCanvasRef = useRef(null);
  const concatPreviewCanvasRef = useRef(null);
  // When on, the output resolution tracks the image the video opens with (the
  // pinned image of the first track, else the first selected image) instead of
  // being set by hand. Batch renders take it per-video, from each track's image.
  const [autoMatchImageRes, setAutoMatchImageRes] = useState(false);
  // Strength of the blurred background, 0-100, where 100 is the look the render
  // has always produced. Per image, with this as the default for new ones.
  const [defaultBgBlur, setDefaultBgBlur] = useState(100);
  // Resolution multiplier applied to whatever the resolution works out to.
  // Shared by the concat render and the batch, so the two modes can't quietly
  // produce different sizes from the same project.
  const [renderScale, setRenderScale] = useState(1);
  // Batch render: one video per track, each with that track's image. Only the
  // genuinely batch-only choices live here — resolution mode, scale and the
  // text overlay are shared with the concat render (see sharedTextMode /
  // resolutionMode / renderScale below).
  const [batchSettings, setBatchSettings] = useState({
    scope: "selected",        // "selected" = every selected track | "pinned" = only tracks with a pinned image
    nameTemplate: "%num% - %title%",
  });
  const [showBatchSettings, setShowBatchSettings] = useState(false);
  const [batchVideos, setBatchVideos] = useState([]); // [{jobId, trackIdx, title, name, url, size}]
  const [videoAudioOrder, setVideoAudioOrder] = useState([]); // ordered indices into exportedTracks
  // Per-track clip ranges keyed by exportedTracks index: { [idx]: { start, end } } in seconds, relative to the track
  const [trackClips, setTrackClips] = useState({});
  const [expandedAudioRows, setExpandedAudioRows] = useState(new Set());
  const [imageLoadingStatus, setImageLoadingStatus] = useState(null); // {loaded, total, current}
  const [discogsArtStatus, setDiscogsArtStatus] = useState(null); // {loaded, total, current, images}

  // Refs
  const ffmpegRef = useRef(null);
  const zoomviewRef = useRef(null);
  const overviewRef = useRef(null);
  const peaksRef = useRef(null);
  const audioContextRef = useRef(null);
  // Low-sample-rate, mono AudioBuffer decoded once and reused for both the
  // peaks.js waveform and silence analysis. Keeping a single small buffer
  // (instead of a full-rate decode + a second decode inside peaks.js) is what
  // keeps memory under iOS Safari's per-tab limit. Playback/export still use
  // the original-quality file via the <audio> element.
  const decodedBufferRef = useRef(null);
  // Set when decoding the current file threw, so anything waiting on
  // decodedBufferRef stops waiting instead of hanging until its timeout.
  const decodeFailedRef = useRef(false);
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
  // Synchronous re-entrancy guard for the video render. isRenderingVideo is
  // async React state, so the Render button can be re-triggered before it
  // disables; this ref blocks a second concurrent render instantly.
  const getTokensRef = useRef(null);
  const thumbnailInputRef = useRef(null);
  const modalFileInputRef = useRef(null);
  const directFileInputRef = useRef(null);
  const [directDropDragOver, setDirectDropDragOver] = useState(false);
  const [audioLoadingStatus, setAudioLoadingStatus] = useState(null); // {loaded, total, current}
  const [aspectDropdownOpen, setAspectDropdownOpen] = useState(false);
  const aspectDropdownRef = useRef(null);
  const audioDragRef = useRef(null);
  // Set while a Step 5 audio row is duplicated/removed, so the auto-select
  // effect below doesn't re-select rows the user had deliberately unchecked.
  const skipAudioAutoSelectRef = useRef(false);
  const imageDragRef = useRef(null);
  const playbackTimerRef = useRef(null);
  const previewCheckRef = useRef(null);

  // Clears the workflow back to a blank slate. Shared by "Start Over" and by
  // "New project" — the latter must NOT touch the stored project list, only the
  // live editing state.
  const resetProjectState = () => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    if (peaksRef.current) { try { peaksRef.current.destroy(); } catch {} peaksRef.current = null; }
    exportedTracks.forEach(t => URL.revokeObjectURL(t.url));
    videoImages.forEach(img => { if (img.thumbUrl) URL.revokeObjectURL(img.thumbUrl); if (img.previewUrl) URL.revokeObjectURL(img.previewUrl); });
    if (renderedVideoSrc) URL.revokeObjectURL(renderedVideoSrc);
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
    setAudioFile(null); setDroppedAudioFiles([]); setAudioDurationMap({}); setExpandedFilenames(new Set()); setPendingAudioFiles([]); setAudioPickConfirmed(false); setChannelData(null); setDuration(0); setTracks([]); setCurrentTime(0); setIsPlaying(false);
    setDiscogsUrl(""); setDiscogsData(null); setDiscogsError(""); setTrackNames([]); setManualTrackCount(""); setProjectName("My Album");
    setExportedTracks([]); setSelectedTracks(new Set()); setMessage("");
    setVideoImages([]); setSelectedVideoImages(new Set()); setSelectedVideoAudios(new Set()); setRenderedVideoSrc(null);
    setTrackImageAssign({}); setTrackTextOverrides({});
    setTextOverlay(loadSavedTextDefaults() || DEFAULT_TEXT_OVERLAY);
    batchVideos.forEach(v => { try { URL.revokeObjectURL(v.url); } catch {} });
    setBatchVideos([]);
    setManualImageTimings({}); setVideoAudioOrder([]); setTrackClips({}); setVideoOutputName("");
    setSilenceRegions([]); setVolumeSuggestion(null);
    setYtUploadData({ title: "", description: "", privacyStatus: "private", tags: "" }); setYtTitleSuggestions([]);
    setYtUploadResult(null); setYtUploadError(""); setThumbnailFile(null); setThumbnailPreview(null);
    setRiaaEnabled(false); setVolumeDb(0); setStep(1);
    autoSplitDoneRef.current = false;
    lastYtDiscogsUrlRef.current = null;
  };

  // Wipes the active project back to a blank slate. Distinct from the trash
  // icon beside it, which only clears the step you are looking at.
  const resetAll = async () => {
    if (!window.confirm("Start over? This clears the whole project — every step, not just this one.")) return;
    const id = activeProjectIdRef.current;
    const live = id ? renderQueue.jobsForProject(id).filter(j => j.status === "running" || j.status === "queued") : [];
    if (live.length && !window.confirm(`This project has ${live.length} render${live.length === 1 ? "" : "s"} in flight. Cancel ${live.length === 1 ? "it" : "them"} too?`)) return;
    resetProjectState();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    idbDelete("rendered_video");
    if (id) {
      hydratingRef.current = true;
      try {
        await storeDeleteProject(id);
        await storePutProject({
          id, name: "New project", createdAt: Date.now(), updatedAt: Date.now(),
          settings: null, audioFiles: [], exportedTracks: [], images: [], video: null,
          bytes: { audio: 0, tracks: 0, images: 0, video: 0, total: 0 }, trackCount: 0,
        });
        renderQueue.purgeProject(id);
        await refreshProjects();
      } catch (e) {
        // Storage being unavailable must not leave the page half-reset.
        setMessage(`Cleared, but the project record could not be rewritten: ${e?.message || e}`);
      }
      setTimeout(() => { hydratingRef.current = false; }, 0);
    }
    setStep(1);
    setMessage("Started over — the project is empty.");
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

    // Restore progress from localStorage
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.step) setStep(saved.step);
        if (saved.projectName) setProjectName(saved.projectName);
        if (saved.discogsUrl) setDiscogsUrl(saved.discogsUrl);
        if (saved.discogsData) setDiscogsData(saved.discogsData);
        if (saved.trackNames) setTrackNames(saved.trackNames);
        if (saved.manualTrackCount) setManualTrackCount(saved.manualTrackCount);
        if (saved.tracks) setTracks(saved.tracks);
        if (saved.outputFormat) setOutputFormat(saved.outputFormat);
        if (saved.filenameFormat) setFilenameFormat(saved.filenameFormat);
        if (saved.volumeDb != null) setVolumeDb(saved.volumeDb);
        if (saved.riaaEnabled != null) setRiaaEnabled(saved.riaaEnabled);
        if (saved.ytUploadData) setYtUploadData(saved.ytUploadData);
        if (saved.videoWidth) setVideoWidth(saved.videoWidth);
        if (saved.videoHeight) setVideoHeight(saved.videoHeight);
        if (saved.videoBgColor) setVideoBgColor(saved.videoBgColor);
        if (saved.imageMaxDim !== undefined) setImageMaxDim(saved.imageMaxDim);
        if (saved.slideshowMode) setSlideshowMode(saved.slideshowMode);
        if (saved.loopInterval != null) setLoopInterval(saved.loopInterval);
        if (saved.motionFps != null) setMotionFps(saved.motionFps);
        if (saved.textOverlay) setTextOverlay({ ...DEFAULT_TEXT_OVERLAY, ...saved.textOverlay });
        if (saved.trackImageAssign) setTrackImageAssign(saved.trackImageAssign);
        if (saved.ytTitleVariation != null) setYtTitleVariation(saved.ytTitleVariation);
        if (saved.ytTimestampFormat) setYtTimestampFormat(saved.ytTimestampFormat);
        if (saved.ytTimestampSeparator != null) setYtTimestampSeparator(saved.ytTimestampSeparator);
        if (saved.ytIncludeTrackNums != null) setYtIncludeTrackNums(saved.ytIncludeTrackNums);
        if (saved.ytDescSuffix != null) setYtDescSuffix(saved.ytDescSuffix);
        if (saved.discogsInputMode) setDiscogsInputMode(saved.discogsInputMode);
        if (saved.videoOutputName) setVideoOutputName(saved.videoOutputName);
        if (saved.audioFileName) {
          // We can't restore the actual File object, but we can note what was loaded
          restoredRef.current = true;
        }
      }
    } catch {}

    // Always try to restore the rendered video from IndexedDB — IDB is the
    // source of truth, not the localStorage `hasRenderedVideo` flag. There's a
    // race between this mount-restore (which uses async idbLoad) and the
    // autosave effect: the autosave runs after `setMounted(true)` and writes
    // `hasRenderedVideo: false` because `renderedVideoSrc` is still null while
    // IDB is loading. If the page were torn down during that window
    // (e.g., another navigation) the flag would persist as false and the
    // restore on the next mount would silently skip the blob. Probing IDB
    // unconditionally side-steps that.
    idbLoad('rendered_video').then(blob => {
      if (blob && blob.size > 0) {
        const url = URL.createObjectURL(blob);
        setRenderedVideoSrc(url);
      }
    }).catch(() => {});
  }, []);

  // Bootstrap the project store: adopt the last-open project, or create the
  // first one. Runs once, after the localStorage restore above has queued its
  // state writes, so a migrated project captures them.
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      hydratingRef.current = true;
      try {
        requestPersistence();
        const all = await storeListProjects();
        if (cancelled) return;
        setProjects(all);
        setStorageInfo(await estimateStorage());

        const lastId = (() => { try { return localStorage.getItem(ACTIVE_PROJECT_KEY); } catch { return null; } })();
        const last = lastId ? all.find(p => p.id === lastId) : null;

        if (last) {
          setActiveProjectId(last.id);
          activeProjectIdRef.current = last.id;
          // The localStorage restore already repopulated settings for this
          // same project, so only the blobs still need loading.
          await hydrateProject(last);
        } else if (all.length) {
          setActiveProjectId(all[0].id);
          activeProjectIdRef.current = all[0].id;
          try { localStorage.setItem(ACTIVE_PROJECT_KEY, all[0].id); } catch {}
          await hydrateProject(all[0]);
        } else {
          // First run (or a pre-projects install): adopt whatever the old
          // single-slot autosave left behind rather than discarding it.
          const id = newProjectId();
          setActiveProjectId(id);
          activeProjectIdRef.current = id;
          try {
            localStorage.setItem(ACTIVE_PROJECT_KEY, id);
            localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
          } catch {}
          await storePutProject({
            id, name: "My Album", createdAt: Date.now(), updatedAt: Date.now(),
            settings: null, audioFiles: [], exportedTracks: [], images: [], video: null,
            bytes: { audio: 0, tracks: 0, images: 0, video: 0, total: 0 }, trackCount: 0,
          });
        }
        if (!cancelled) await refreshProjects();
      } catch (e) {
        if (cancelled) return;
        setMessage(`Project storage unavailable: ${e?.message || e}`);
        // Every id assignment above lives inside this try, so a storage layer
        // that refuses to open (full disk, blocked origin, private window) left
        // activeProjectId null for the life of the page — and null is what
        // startRender refuses on. Mint one anyway: renders and exports run
        // entirely from memory, only *saving* needs IndexedDB.
        if (!activeProjectIdRef.current) {
          const id = newProjectId();
          activeProjectIdRef.current = id;
          setActiveProjectId(id);
          try { localStorage.setItem(ACTIVE_PROJECT_KEY, id); } catch {}
        }
      } finally {
        setTimeout(() => { hydratingRef.current = false; }, 0);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Autosave the active project. Debounced hard — a save rewrites blobs, so it
  // must not fire on every keystroke.
  useEffect(() => {
    if (!mounted || !activeProjectId || hydratingRef.current) return;
    // A storage layer that is failing fails every time. Retrying every 2.5s
    // produced twenty-odd identical errors a minute and did nothing useful, so
    // it gives up after a few and says so once.
    if (saveFailuresRef.current >= SAVE_FAILURE_LIMIT) return;
    const t = setTimeout(() => { if (!hydratingRef.current) saveActiveProject(); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Every field collectSettings() writes belongs here — anything missing is
    // silently lost on refresh, because nothing else schedules the save. Clip
    // ranges were the visible casualty: set a start/end, reload, gone.
  }, [mounted, activeProjectId, step, audioMode, projectName, discogsUrl, discogsData,
      discogsInputMode, trackNames, manualTrackCount, tracks, duration,
      outputFormat, filenameFormat, volumeDb, riaaEnabled,
      silThresholdDb, silMinDur, silWindowMs, silMinTrackLen, selectedTracks,
      videoWidth, videoHeight, videoBgColor, imageMaxDim,
      slideshowMode, loopInterval, motionFps, manualImageTimings,
      textOverlay, trackImageAssign, videoAudioOrder, trackClips,
      selectedVideoAudios, selectedVideoImages,
      videoOutputName, ytUploadData, ytTitleVariation, ytTimestampFormat,
      ytTimestampSeparator, ytIncludeTrackNums, ytDescSuffix, ytTitleSuggestions,
      autoUploadYt, autoMatchImageRes, renderScale, batchSettings, trackTextOverrides,
      exportedTracks, videoImages, droppedAudioFiles]);

  // Persist in-flight work when the tab goes away.
  useEffect(() => {
    if (!mounted) return;
    const onHide = () => { if (!hydratingRef.current) saveActiveProject(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
    // `saveActiveProject` is declared further down the component body, so it
    // can't appear in this dependency array without tripping its TDZ at render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Save progress to localStorage whenever key state changes
  useEffect(() => {
    if (!mounted) return;
    try {
      const data = {
        step,
        projectName,
        discogsUrl,
        discogsData,
        trackNames,
        manualTrackCount,
        tracks,
        outputFormat,
        filenameFormat,
        volumeDb,
        riaaEnabled,
        ytUploadData,
        videoWidth,
        videoHeight,
        videoBgColor,
        imageMaxDim,
        slideshowMode,
        loopInterval,
        motionFps,
        textOverlay,
        trackImageAssign,
        ytTitleVariation,
        ytTimestampFormat,
        ytTimestampSeparator,
        ytIncludeTrackNums,
        ytDescSuffix,
        discogsInputMode,
        audioFileName: audioFile?.name || null,
        videoOutputName,
        hasRenderedVideo: !!renderedVideoSrc,
        savedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }, [mounted, step, projectName, discogsUrl, discogsData, trackNames, manualTrackCount,
      tracks, outputFormat, filenameFormat, volumeDb, riaaEnabled, ytUploadData,
      videoWidth, videoHeight, videoBgColor, imageMaxDim, slideshowMode, loopInterval, motionFps,
      textOverlay, trackImageAssign,
      ytTitleVariation, ytTimestampFormat, ytTimestampSeparator, ytIncludeTrackNums,
      ytDescSuffix, discogsInputMode, audioFile, videoOutputName, renderedVideoSrc]);

  useEffect(() => { autoUploadYtRef.current = autoUploadYt; }, [autoUploadYt]);
  useEffect(() => { ytUploadDataRef.current = ytUploadData; }, [ytUploadData]);

  // Default the "Queue upload" auto-upload toggle ON once the user is signed
  // in to YouTube — unless they've already chosen a setting themselves.
  useEffect(() => {
    if (ytAuthState.canAuth && !autoUploadUserSetRef.current) setAutoUploadYt(true);
  }, [ytAuthState.canAuth]);

  // Expose window.showauth() to reveal the hidden cloud-sync panel from the console.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.showauth = () => {
      setShowAuthPanel(true);
      console.log("[riptag] Cloud sync panel shown");
    };
    return () => { try { delete window.showauth; } catch {} };
  }, []);

  // Lazily init Firebase + subscribe to auth state once the panel is opened.
  useEffect(() => {
    if (!showAuthPanel) return;
    let unsub = () => {};
    let cancelled = false;
    (async () => {
      try {
        const firebase = await initFirebase();
        if (cancelled) return;
        setFb(firebase);
        unsub = onAuthStateChanged(firebase.auth, (u) => setAuthUser(u));
      } catch (e) {
        if (!cancelled) setCloudError(`Firebase init failed: ${e.message || e}`);
      }
    })();
    return () => { cancelled = true; unsub(); };
  }, [showAuthPanel]);

  // Build the same progress payload we persist to localStorage, for cloud sync.
  const buildProgressPayload = () => ({
    step, projectName, discogsUrl, discogsData, trackNames, manualTrackCount,
    tracks, outputFormat, filenameFormat, volumeDb, riaaEnabled, ytUploadData,
    videoWidth, videoHeight, videoBgColor, imageMaxDim, slideshowMode, loopInterval, motionFps,
    textOverlay, trackImageAssign,
    ytTitleVariation, ytTimestampFormat, ytTimestampSeparator, ytIncludeTrackNums,
    ytDescSuffix, discogsInputMode,
    audioFileName: audioFile?.name || null,
    videoOutputName,
    hasRenderedVideo: !!renderedVideoSrc,
    savedAt: Date.now(),
  });

  // Apply a progress payload back into component state (same shape as localStorage restore).
  const applyProgressPayload = (saved) => {
    if (!saved || typeof saved !== "object") return;
    if (saved.step) setStep(saved.step);
    if (saved.projectName) setProjectName(saved.projectName);
    if (saved.discogsUrl) setDiscogsUrl(saved.discogsUrl);
    if (saved.discogsData) setDiscogsData(saved.discogsData);
    if (saved.trackNames) setTrackNames(saved.trackNames);
    if (saved.manualTrackCount) setManualTrackCount(saved.manualTrackCount);
    if (saved.tracks) setTracks(saved.tracks);
    if (saved.outputFormat) setOutputFormat(saved.outputFormat);
    if (saved.filenameFormat) setFilenameFormat(saved.filenameFormat);
    if (saved.volumeDb != null) setVolumeDb(saved.volumeDb);
    if (saved.riaaEnabled != null) setRiaaEnabled(saved.riaaEnabled);
    if (saved.ytUploadData) setYtUploadData(saved.ytUploadData);
    if (saved.videoWidth) setVideoWidth(saved.videoWidth);
    if (saved.videoHeight) setVideoHeight(saved.videoHeight);
    if (saved.videoBgColor) setVideoBgColor(saved.videoBgColor);
    if (saved.imageMaxDim !== undefined) setImageMaxDim(saved.imageMaxDim);
    if (saved.slideshowMode) setSlideshowMode(saved.slideshowMode);
    if (saved.loopInterval != null) setLoopInterval(saved.loopInterval);
    if (saved.motionFps != null) setMotionFps(saved.motionFps);
    if (saved.textOverlay) setTextOverlay({ ...DEFAULT_TEXT_OVERLAY, ...saved.textOverlay });
    if (saved.trackImageAssign) setTrackImageAssign(saved.trackImageAssign);
    if (saved.ytTitleVariation != null) setYtTitleVariation(saved.ytTitleVariation);
    if (saved.ytTimestampFormat) setYtTimestampFormat(saved.ytTimestampFormat);
    if (saved.ytTimestampSeparator != null) setYtTimestampSeparator(saved.ytTimestampSeparator);
    if (saved.ytIncludeTrackNums != null) setYtIncludeTrackNums(saved.ytIncludeTrackNums);
    if (saved.ytDescSuffix != null) setYtDescSuffix(saved.ytDescSuffix);
    if (saved.discogsInputMode) setDiscogsInputMode(saved.discogsInputMode);
    if (saved.videoOutputName) setVideoOutputName(saved.videoOutputName);
  };

  const handleCloudSignIn = async () => {
    if (!fb) return;
    setCloudError(""); setCloudStatus(""); setAuthBusy(true);
    try { await signInWithPopup(fb.auth, fb.googleProvider); }
    catch (e) { setCloudError(e.message || String(e)); }
    finally { setAuthBusy(false); }
  };

  const handleCloudSignOut = async () => {
    if (!fb) return;
    setCloudError(""); setCloudStatus(""); setAuthBusy(true);
    try { await signOut(fb.auth); setCloudSavedAt(null); }
    catch (e) { setCloudError(e.message || String(e)); }
    finally { setAuthBusy(false); }
  };

  const handleCloudSave = async () => {
    if (!fb || !authUser) return;
    setCloudError(""); setCloudStatus("Saving…"); setAuthBusy(true);
    try {
      const ref = doc(fb.db, "users", authUser.uid);
      const progress = buildProgressPayload();
      await setDoc(ref, {
        email: authUser.email || null,
        vinylDigitizerProgress: progress,
        vinylDigitizerSavedAt: serverTimestamp(),
      }, { merge: true });
      setCloudSavedAt(Date.now());
      setCloudStatus("Saved to cloud");
    } catch (e) { setCloudError(e.message || String(e)); setCloudStatus(""); }
    finally { setAuthBusy(false); }
  };

  const handleCloudLoad = async () => {
    if (!fb || !authUser) return;
    setCloudError(""); setCloudStatus("Loading…"); setAuthBusy(true);
    try {
      const ref = doc(fb.db, "users", authUser.uid);
      const snap = await getDoc(ref);
      if (!snap.exists() || !snap.data().vinylDigitizerProgress) {
        setCloudStatus("No cloud save found");
        return;
      }
      const saved = snap.data().vinylDigitizerProgress;
      if (!window.confirm("Restore progress from cloud? This will overwrite your current session state (audio/video files stay local).")) {
        setCloudStatus("");
        return;
      }
      applyProgressPayload(saved);
      const ts = snap.data().vinylDigitizerSavedAt;
      setCloudSavedAt(ts?.toMillis ? ts.toMillis() : Date.now());
      setCloudStatus("Loaded from cloud");
    } catch (e) { setCloudError(e.message || String(e)); setCloudStatus(""); }
    finally { setAuthBusy(false); }
  };

  // Update browser tab title with progress during render/upload
  useEffect(() => {
    const base = "RipTag – Record Audio Splitter | Martin Barker";
    if (isRenderingVideo && videoRenderProgress !== null) {
      document.title = `${(videoRenderProgress * 100).toFixed(0)}% ${base}`;
    } else if (ytUploading && ytUploadProgress !== null) {
      document.title = `${ytUploadProgress}% ${base}`;
    } else {
      document.title = base;
    }
    return () => { document.title = base; };
  }, [isRenderingVideo, videoRenderProgress, ytUploading, ytUploadProgress]);

  // Decode audio when file changes (for silence detection + volume analysis)
  useEffect(() => {
    if (!audioFile) return;
    setIsLoadingWaveform(true);
    setTracks([]);
    setCurrentTime(0);
    setIsPlaying(false);
    setExportedTracks([]);
    // Drop the previous file's waveform buffer immediately — otherwise a fast
    // switch to Step 3 would render the old file's waveform.
    decodedBufferRef.current = null;
    decodeFailedRef.current = false;
    // Destroy existing peaks instance
    if (peaksRef.current) {
      peaksRef.current.destroy();
      peaksRef.current = null;
    }
    setAudioPrepStatus({ pct: 0, label: "Reading audio file…" });
    const decode = async () => {
      try {
        setWaveformLoadStatus("Reading audio file…");
        // Read through the stream rather than arrayBuffer() so the byte count
        // is a real percentage. On a 700 MB vinyl side this is most of the
        // wait, and it used to be a spinner with nothing behind it.
        const buf = await readFileWithProgress(audioFile, (pct) => {
          // The read is the first 70% of getting to a usable waveform.
          setAudioPrepStatus({ pct: Math.round(pct * 70), label: "Reading audio file…" });
        });
        setWaveformLoadStatus("Decoding audio data…");
        setAudioPrepStatus({ pct: 72, label: "Decoding audio…" });

        // Decode through an OfflineAudioContext fixed at a low sample rate so
        // decodeAudioData resamples the whole file down to WAVEFORM_SAMPLE_RATE
        // as it decodes — the full-rate PCM never materializes in JS. This is
        // the single biggest memory win and what stops iOS Safari from killing
        // the tab on long vinyl rips. 8 kHz mono is ample for waveform display
        // and silence detection; real playback/export use the original file.
        const WAVEFORM_SAMPLE_RATE = 8000;
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offline = new OfflineCtx(1, 1, WAVEFORM_SAMPLE_RATE);
        let decoded = await offline.decodeAudioData(buf);

        // Take channel 0 only. If a browser ignored the context sample rate and
        // decoded at the native rate, downsample by block-averaging so we never
        // hold a full-resolution array in state.
        setAudioPrepStatus({ pct: 88, label: "Analysing waveform…" });
        let mono = decoded.getChannelData(0);
        let sr = decoded.sampleRate;
        const durationSec = decoded.duration;
        if (sr > WAVEFORM_SAMPLE_RATE * 1.5) {
          // floor keeps the resulting rate (sr/factor) >= WAVEFORM_SAMPLE_RATE,
          // which createBuffer requires (valid range is 8000–96000 Hz).
          const factor = Math.floor(sr / WAVEFORM_SAMPLE_RATE);
          const outLen = Math.floor(mono.length / factor);
          const ds = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) {
            let s = 0;
            const base = i * factor;
            for (let j = 0; j < factor; j++) s += mono[base + j];
            ds[i] = s / factor;
          }
          mono = ds;
          sr = sr / factor;
        }

        // Build a compact mono AudioBuffer at the low rate and hand it to
        // peaks.js (via webAudio.audioBuffer) so peaks.js does NOT decode the
        // file a second time.
        setAudioPrepStatus({ pct: 96, label: "Building waveform…" });
        const wfBuffer = new OfflineCtx(1, mono.length, sr).createBuffer(1, mono.length, sr);
        wfBuffer.copyToChannel(mono, 0);
        decodedBufferRef.current = wfBuffer;
        decoded = null; // release the decoded buffer

        setDuration(durationSec);
        setChannelData(mono);
        setAudioPrepStatus({ pct: 100, label: "Ready" });
        // Held briefly at 100 so the bar visibly completes instead of vanishing.
        setTimeout(() => setAudioPrepStatus(null), 400);
        setMessage(`Loaded: ${audioFile.name} (${formatTime(durationSec)})`);
      } catch (err) {
        decodeFailedRef.current = true;
        setAudioPrepStatus(null);
        setMessage("Error decoding audio: " + err.message);
        setIsLoadingWaveform(false);
        setWaveformLoadStatus("");
      }
    };
    decode();
  }, [audioFile]);

  // Read durations for each uploaded audio file (lightweight metadata-only read)
  useEffect(() => {
    let cancelled = false;
    const missing = droppedAudioFiles.filter(f => !(`${f.name}:${f.size}` in audioDurationMap));
    if (missing.length === 0) return;
    missing.forEach(f => {
      const key = `${f.name}:${f.size}`;
      const url = URL.createObjectURL(f);
      const a = new Audio();
      const cleanup = () => { URL.revokeObjectURL(url); };
      a.addEventListener('loadedmetadata', () => {
        cleanup();
        if (cancelled) return;
        setAudioDurationMap(prev => ({ ...prev, [key]: a.duration }));
      });
      a.addEventListener('error', () => {
        cleanup();
        if (cancelled) return;
        setAudioDurationMap(prev => ({ ...prev, [key]: null }));
      });
      a.preload = 'metadata';
      a.src = url;
    });
    return () => { cancelled = true; };
  }, [droppedAudioFiles]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Auto-import audio files dropped in Step 1 into the Step 5 video audio
  // table when the user has not gone through the Step 4 export flow. Lets the
  // user drop audio in Step 1 and Skip directly to the video render step.
  // `audioLoadingStatus` is set synchronously by addDirectAudioFiles, so the
  // re-renders it triggers will short-circuit this effect and prevent a
  // double-import.
  useEffect(() => {
    if (
      step === 5 &&
      exportedTracks.length === 0 &&
      droppedAudioFiles.length > 0 &&
      !audioLoadingStatus
    ) {
      addDirectAudioFiles(droppedAudioFiles);
    }
    // addDirectAudioFiles is a stable inline function — intentionally omitted
    // from deps to avoid retriggering when unrelated state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, exportedTracks.length, droppedAudioFiles, audioLoadingStatus]);

  // Auto-select all exported tracks when entering step 5 and sync order
  useEffect(() => {
    if (skipAudioAutoSelectRef.current) { skipAudioAutoSelectRef.current = false; return; }
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
  // Distinct files on disk. A Step 5 copy re-uses its source's blob, so the
  // download list and the ZIP keep one entry per underlying file. Deduping on
  // url rather than on the copy flag survives deleting the original row.
  const exportedFiles = exportedTracks.filter((t, i) => exportedTracks.findIndex(o => o.url === t.url) === i);

  // Sync track names when track count changes
  useEffect(() => {
    setTrackNames(prev => Array.from({ length: trackCount }, (_, i) => {
      if (tracks[i]?.name && tracks[i].name !== `Track ${i + 1}`) return tracks[i].name;
      if (prev[i]) return prev[i];
      if (discogsData?.tracklist?.[i]) return discogsData.tracklist[i].title;
      return `Track ${i + 1}`;
    }));
  }, [trackCount, discogsData, tracks]);

  // Auto-apply Discogs track names to tracks and waveform labels when tracks are created with generic names
  const autoNameAppliedRef = useRef(false);
  useEffect(() => { autoNameAppliedRef.current = false; }, [trackCount]);
  useEffect(() => {
    if (autoNameAppliedRef.current) return;
    if (!discogsData?.tracklist?.length || tracks.length === 0) return;
    const hasGenericName = tracks.some((t, i) => t.name === `Track ${i + 1}` && discogsData.tracklist[i]?.title);
    if (!hasGenericName) return;
    autoNameAppliedRef.current = true;
    const updated = tracks.map((track, i) => {
      if (track.name === `Track ${i + 1}` && discogsData.tracklist[i]?.title) {
        return { ...track, name: discogsData.tracklist[i].title };
      }
      return track;
    });
    setTracks(updated);
    if (peaksRef.current) {
      updated.forEach((track, i) => {
        const seg = peaksRef.current.segments.getSegment(track.id);
        if (seg) seg.update({ labelText: `${i + 1}. ${track.name}` });
      });
    }
  }, [tracks, discogsData]);

  // Sync selectedTracks (id-based) when tracks change
  const trackIds = tracks.map(t => t.id).join(',');
  useEffect(() => {
    setSelectedTracks(new Set(tracks.map(t => t.id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIds]);

  // An open marker-JSON box follows the waveform — drag a boundary and the text
  // updates — until the user edits it, at which point their text is what
  // matters and this stops writing over it.
  useEffect(() => {
    if (!showMarkerJson || markerJsonDirty) return;
    setMarkerJsonDraft(buildMarkerJson());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMarkerJson, markerJsonDirty, tracks, audioFile, duration]);

  // Step 4 exists to produce the track files, so arriving there starts that
  // rather than waiting for a click. Held back until the Discogs art has
  // finished loading: FLAC embeds the cover, and exporting a second early would
  // write every track without one.
  const autoExportDoneRef = useRef(false);
  useEffect(() => { autoExportDoneRef.current = false; }, [audioFile, outputFormat]);
  useEffect(() => {
    if (step !== 4 || autoExportDoneRef.current) return;
    if (isExporting || exportedTracks.length > 0) return;
    // Spelled out rather than reusing `canExport`, which is declared far below
    // this effect — naming it in the dependency array reads it during render,
    // inside its temporal dead zone.
    if (tracks.length === 0 || !audioFile || selectedTracks.size === 0) return;
    // "Art loaded already" means the fetch isn't still in flight. A release with
    // no art at all doesn't block it.
    if (discogsArtStatus) return;
    if (discogsData?.images?.length && videoImages.every(im => im.source !== "discogs")) return;
    autoExportDoneRef.current = true;
    setMessage(`Exporting ${selectedTracks.size} track(s) as ${outputFormat.toUpperCase()}…`);
    exportTracks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tracks.length, audioFile, selectedTracks, isExporting, exportedTracks.length, discogsArtStatus, discogsData, videoImages, outputFormat]);

  // Auto-run split detection when first entering Step 3
  const autoSplitDoneRef = useRef(false);
  // Reset when audio changes or when leaving step 3
  useEffect(() => { autoSplitDoneRef.current = false; }, [audioFile]);
  useEffect(() => { if (step < 3) autoSplitDoneRef.current = false; }, [step]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [step]);
  // When the user returns to Step 1, force the audio picker to re-prompt
  // the next time they enter Step 2.
  useEffect(() => { if (step === 1) setAudioPickConfirmed(false); }, [step]);

  // Ctrl/Cmd+Z = undo marker edit, Ctrl/Cmd+Y or Ctrl+Shift+Z = redo. Step 3 only.
  useEffect(() => {
    if (step !== 3) return;
    const onKey = (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      const tag = (e.target?.tagName || "").toUpperCase();
      // Don't hijack typing in track-name inputs or other text fields
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undoTracks();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        redoTracks();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, undoTracks, redoTracks]);
  useEffect(() => {
    if (step === 3 && channelData && duration > 0 && !autoSplitDoneRef.current && !isLoadingWaveform) {
      autoSplitDoneRef.current = true;
      // If the user told us how many tracks to expect in the previous step —
      // either by dropping a Discogs URL (tracklist length) or typing a manual
      // track count — honor that exact number instead of auto-detecting split
      // points from silence. Only fall back to silence detection when no count
      // was given.
      const expectedCount = parseInt(manualTrackCount) || discogsData?.tracklist?.length || 0;
      // Small delay to ensure peaks.js instance is fully ready after waveform load completes
      const timer = setTimeout(() => {
        if (expectedCount > 0) splitIntoEqualTracks(expectedCount);
        else detectSilence();
      }, 100);
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

      const getAudioContext = () => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          audioContextRef.current = new Ctx();
        }
        return audioContextRef.current;
      };
      const webAudio = decodedBufferRef.current
        ? { audioBuffer: decodedBufferRef.current }
        : { audioContext: getAudioContext() };

      const options = {
        zoomview: {
          container: zoomviewRef.current,
        },
        overview: {
          container: overviewRef.current,
        },
        mediaElement: audioRef.current,
        // Reuse the single low-rate AudioBuffer we already decoded. Passing
        // webAudio.audioBuffer makes peaks.js build the waveform from this
        // buffer instead of fetching + decoding the media element again (a
        // second full-resolution decode was a primary cause of iOS crashes).
        // If the decode hasn't finished (or failed), hand peaks.js a real
        // AudioContext instead and let it decode the media itself — a webAudio
        // object with neither is what raised "The webAudio.audioContext option
        // must be a valid AudioContext" and left Step 3 with no waveform.
        webAudio,
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
            // Retry once by letting peaks.js decode the media through an
            // AudioContext. Deleting webAudio outright isn't a fallback —
            // peaks.js then has no source at all and fails again.
            if (options.webAudio.audioBuffer) {
              console.log('Retrying peaks.js init with an AudioContext...');
              const fallbackOptions = { ...options, webAudio: { audioContext: getAudioContext() } };
              Peaks.init(fallbackOptions, (retryErr, retryInstance) => {
                if (retryErr) { reject(retryErr); return; }
                peaksRef.current = retryInstance;
                try {
                  const levels = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
                  retryInstance.zoom.setZoom(levels.length - 1);
                } catch {}
                try { retryInstance.views.getView('zoomview')?.enableAutoScroll(false); } catch {}
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
                retryInstance.on('zoomview.update', ({ startTime, endTime }) => {
                  setViewRange({ start: startTime, end: endTime });
                });
                try {
                  const v = retryInstance.views.getView('zoomview');
                  if (v) setViewRange({ start: v.getStartTime(), end: v.getEndTime() });
                } catch {}
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
          // Disable auto-scroll so zoom/playback doesn't yank the view back to the playhead
          try { peaksInstance.views.getView('zoomview')?.enableAutoScroll(false); } catch {}

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

          peaksInstance.on('zoomview.update', ({ startTime, endTime }) => {
            setViewRange({ start: startTime, end: endTime });
          });
          try {
            const v = peaksInstance.views.getView('zoomview');
            if (v) setViewRange({ start: v.getStartTime(), end: v.getEndTime() });
          } catch {}

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
      // Wait for the decode effect to produce the waveform AudioBuffer.
      // Entering Step 3 while a long rip is still decoding used to init
      // peaks.js with an empty webAudio option, which failed outright.
      if (!decodedBufferRef.current && !decodeFailedRef.current) {
        setWaveformLoadStatus("Decoding audio data…");
        const deadline = Date.now() + 120000;
        while (!decodedBufferRef.current && !decodeFailedRef.current && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 100));
          if (cancelled) { setIsLoadingWaveform(false); setWaveformLoadStatus(""); return; }
        }
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

  // Resize peaks.js waveform views when the window is resized
  useEffect(() => {
    const handleResize = () => {
      if (!peaksRef.current) return;
      try { peaksRef.current.views.getView('zoomview')?.fitToContainer(); } catch {}
      try { peaksRef.current.views.getView('overview')?.fitToContainer(); } catch {}
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Cleanup peaks.js on unmount
  useEffect(() => {
    return () => {
      if (peaksRef.current) {
        try { peaksRef.current.destroy(); } catch {}
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try { audioContextRef.current.close(); } catch {}
      }
      decodedBufferRef.current = null; // free the decoded waveform buffer
      if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
    };
  }, []);

  // Zoom controls for peaks.js
  const zoomIn = () => { if (peaksRef.current) peaksRef.current.zoom.zoomIn(); };
  const zoomOut = () => { if (peaksRef.current) peaksRef.current.zoom.zoomOut(); };

  // Keyboard shortcuts for waveform editor
  useEffect(() => {
    const handleKey = (e) => {
      if (step !== 3) return;
      // Ignore if user is typing in an input/textarea/select
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        // Read paused state directly from the audio element to avoid stale closure
        if (!audioRef.current) return;
        if (audioRef.current.paused) {
          const p = audioRef.current.play();
          if (p && p.catch) p.catch(() => {});
          setIsPlaying(true);
        } else {
          audioRef.current.pause();
          setIsPlaying(false);
        }
      } else if (e.key === "," || e.key === "<" || e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "." || e.key === ">" || e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!audioRef.current) return;
        if (e.shiftKey) {
          // Shift+Left: jump to previous track boundary
          const ct = audioRef.current.currentTime;
          const boundaries = tracks.flatMap(t => [t.startTime, t.endTime])
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort((a, b) => a - b);
          const prev = [...boundaries].reverse().find(b => b < ct - 0.05);
          if (prev != null) { audioRef.current.currentTime = prev; setCurrentTime(prev); }
        } else {
          // Left arrow: nudge back 5 seconds
          const t = Math.max(0, audioRef.current.currentTime - 5);
          audioRef.current.currentTime = t;
          setCurrentTime(t);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!audioRef.current) return;
        if (e.shiftKey) {
          // Shift+Right: jump to next track boundary
          const ct = audioRef.current.currentTime;
          const boundaries = tracks.flatMap(t => [t.startTime, t.endTime])
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort((a, b) => a - b);
          const next = boundaries.find(b => b > ct + 0.05);
          if (next != null) { audioRef.current.currentTime = next; setCurrentTime(next); }
        } else {
          // Right arrow: nudge forward 5 seconds
          const t = Math.min(duration, audioRef.current.currentTime + 5);
          audioRef.current.currentTime = t;
          setCurrentTime(t);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        zoomOut();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step, tracks, duration]);

  // Scroll wheel zoom on waveform container
  const handleWaveWheel = useCallback((e) => {
    if (!peaksRef.current) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else if (e.deltaY > 0) zoomOut();
  }, []);

  // Attach wheel listener to zoomview (needs {passive: false} to preventDefault).
  // Re-run when entering step 3 since the zoomview div only mounts in that step.
  useEffect(() => {
    if (step !== 3) return;
    let attached = null;
    let raf = 0;
    const tryAttach = () => {
      const el = zoomviewRef.current;
      if (el && attached !== el) {
        if (attached) attached.removeEventListener("wheel", handleWaveWheel, { capture: true });
        el.addEventListener("wheel", handleWaveWheel, { passive: false, capture: true });
        attached = el;
        return;
      }
      if (!el) raf = requestAnimationFrame(tryAttach);
    };
    tryAttach();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (attached) attached.removeEventListener("wheel", handleWaveWheel, { capture: true });
    };
  }, [step, handleWaveWheel]);

  // Track zoomview pixel width via ResizeObserver (for boundary handle positioning)
  useEffect(() => {
    if (step !== 3) return;
    let observer = null;
    let raf = 0;
    const tryObserve = () => {
      const el = zoomviewRef.current;
      if (!el) { raf = requestAnimationFrame(tryObserve); return; }
      setZoomviewWidth(el.clientWidth);
      observer = new ResizeObserver(entries => {
        for (const entry of entries) setZoomviewWidth(entry.contentRect.width);
      });
      observer.observe(el);
    };
    tryObserve();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (observer) observer.disconnect();
    };
  }, [step]);

  // ---- Boundary handle drag (above-waveform splitters) ----
  const beginBoundaryDrag = useCallback((e, mode, idxLeft, idxRight) => {
    // mode: 'joint-move' | 'joint-split' | 'solo-end' | 'solo-start'
    e.preventDefault();
    e.stopPropagation();
    if (!peaksRef.current) return;
    const view = peaksRef.current.views.getView('zoomview');
    const containerEl = zoomviewRef.current;
    if (!view || !containerEl) return;
    snapshotTracks();
    const startMouseX = e.clientX;
    const containerRect = containerEl.getBoundingClientRect();
    const widthPx = containerRect.width || 1;

    // Snapshot current track times so we can compute fresh values per move
    const startEnd = idxLeft != null ? tracks[idxLeft].endTime : null;
    const startStart = idxRight != null ? tracks[idxRight].startTime : null;

    dragStateRef.current = { mode, idxLeft, idxRight, splitDir: null };
    forceHandleRender(n => n + 1);

    const pxToSeconds = (px) => {
      const range = view.getEndTime() - view.getStartTime();
      return (px / widthPx) * range;
    };

    const onMove = (ev) => {
      const dx = ev.clientX - startMouseX;
      const dt = pxToSeconds(dx);
      const segL = idxLeft != null ? peaksRef.current.segments.getSegment(tracks[idxLeft].id) : null;
      const segR = idxRight != null ? peaksRef.current.segments.getSegment(tracks[idxRight].id) : null;
      // Re-render handle overlay so the handle follows the cursor
      requestAnimationFrame(() => forceHandleRender(n => n + 1));

      if (mode === 'joint-move') {
        // Move both boundaries together; clamp so neither crosses the other side.
        const prevEnd = idxLeft > 0 ? tracks[idxLeft - 1].endTime : 0;
        const nextStart = idxRight < tracks.length - 1 ? tracks[idxRight + 1].startTime : duration;
        const minT = Math.max(prevEnd, (tracks[idxLeft].startTime + 0.05));
        const maxT = Math.min(nextStart, (tracks[idxRight].endTime - 0.05));
        const t = Math.max(minT, Math.min(maxT, startEnd + dt));
        if (segL) segL.update({ endTime: t });
        if (segR) segR.update({ startTime: t });
      } else if (mode === 'joint-split') {
        // Direction-based: dragging left moves track[idxLeft].endTime backwards;
        // dragging right moves track[idxRight].startTime forwards.
        const st = dragStateRef.current;
        if (st && st.splitDir == null && Math.abs(dx) > 2) {
          st.splitDir = dx < 0 ? 'left' : 'right';
          forceHandleRender(n => n + 1);
        }
        const dir = dragStateRef.current?.splitDir;
        if (dir === 'left' && segL) {
          const minT = Math.max((idxLeft > 0 ? tracks[idxLeft - 1].endTime : 0), tracks[idxLeft].startTime + 0.05);
          const t = Math.max(minT, Math.min(startEnd, startEnd + dt));
          segL.update({ endTime: t });
        } else if (dir === 'right' && segR) {
          const maxT = Math.min((idxRight < tracks.length - 1 ? tracks[idxRight + 1].startTime : duration), tracks[idxRight].endTime - 0.05);
          const t = Math.min(maxT, Math.max(startStart, startStart + dt));
          segR.update({ startTime: t });
        }
      } else if (mode === 'solo-end' && segL) {
        const minT = Math.max((idxLeft > 0 ? tracks[idxLeft - 1].endTime : 0), tracks[idxLeft].startTime + 0.05);
        const maxT = (idxLeft < tracks.length - 1) ? tracks[idxLeft + 1].startTime : duration;
        const t = Math.max(minT, Math.min(maxT, startEnd + dt));
        segL.update({ endTime: t });
      } else if (mode === 'solo-start' && segR) {
        const minT = (idxRight > 0) ? tracks[idxRight - 1].endTime : 0;
        const maxT = Math.min((idxRight < tracks.length - 1 ? tracks[idxRight + 1].startTime : duration), tracks[idxRight].endTime - 0.05);
        const t = Math.max(minT, Math.min(maxT, startStart + dt));
        segR.update({ startTime: t });
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Commit final times from peaks segments back to React state
      const segs = peaksRef.current.segments.getSegments().sort((a, b) => a.startTime - b.startTime);
      const stripNum = (label) => { const m = (label || '').match(/^\d+\.\s*(.*)$/); return m ? m[1] : (label || 'Track'); };
      setTracks(segs.map(s => ({ id: s.id, startTime: s.startTime, endTime: s.endTime, name: stripNum(s.labelText) })));
      setExportedTracks([]);
      dragStateRef.current = null;
      forceHandleRender(n => n + 1);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [tracks, duration, snapshotTracks]);

  // ---- Track manipulation ----
  const generateTrackId = () => `track-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const splitTrackAtTime = (time) => {
    const trackIdx = tracks.findIndex(t => time > t.startTime + 0.05 && time < t.endTime - 0.05);
    if (trackIdx === -1) return false;
    snapshotTracks();
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
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: "audio/webm" });
        setAudioFile(file);
        setDroppedAudioFiles(prev => [...prev, file]);
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
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    const audioFiles = files.filter(f => f.type.startsWith("audio/"));
    const imageFiles = files.filter(f => f.type.startsWith("image/"));

    if (audioFiles.length > 0) {
      setDroppedAudioFiles(prev => {
        const existingKeys = new Set(prev.map(f => `${f.name}:${f.size}`));
        const fresh = audioFiles.filter(f => !existingKeys.has(`${f.name}:${f.size}`));
        return [...prev, ...fresh];
      });
      if (audioFiles.length === 1) {
        setAudioFile(audioFiles[0]);
        setPendingAudioFiles([]);
      } else {
        // Pre-select the first file so the user can advance to step 2,
        // but remember all of them so step 2 can show a picker.
        setPendingAudioFiles(audioFiles);
        setAudioFile(audioFiles[0]);
        setMessage(`${audioFiles.length} audio files dropped — confirm which to edit on Step 2.`);
      }
    }

    if (imageFiles.length > 0) {
      addImagesToVideo(imageFiles);
      // Also set the first dropped image as the embedded album art for FLAC export (step 4)
      if (!embedArtFile) {
        const f = imageFiles[0];
        setEmbedArtFile(f);
        if (embedArtPreview) URL.revokeObjectURL(embedArtPreview);
        setEmbedArtPreview(URL.createObjectURL(f));
        setExportedTracks([]);
      }
    }
  };
  const handleFileInput = e => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setDroppedAudioFiles(prev => {
      const existingKeys = new Set(prev.map(f => `${f.name}:${f.size}`));
      const fresh = files.filter(f => !existingKeys.has(`${f.name}:${f.size}`));
      return [...prev, ...fresh];
    });
    if (files.length === 1) {
      setAudioFile(files[0]);
      setPendingAudioFiles([]);
    } else {
      setPendingAudioFiles(files);
      setAudioFile(files[0]);
      setMessage(`${files.length} audio files selected — confirm which to edit on Step 2.`);
    }
  };

  // ---- Discogs ----
  // Which release the Step 5 image table currently holds art for. Compared on
  // every successful lookup so a *new* release refetches and an unchanged one
  // (or a project being restored) doesn't.
  const discogsArtReleaseRef = useRef(null);

  // Shared by the URL box and the search-result picker: both are the user
  // choosing a release, and both should leave the art matching that release.
  const onDiscogsReleaseLoaded = (data) => {
    setDiscogsData(data);
    setProjectName(data.title || "My Album");
    setManualTrackCount(String(data.tracklist.length));
    setTrackNames(data.tracklist.map(t => t.title));
    const releaseId = data.id ?? null;
    if (releaseId != null && discogsArtReleaseRef.current === releaseId) return;
    discogsArtReleaseRef.current = releaseId;
    if (!data.images?.length) { removeDiscogsImages(); return; }
    // Fire and forget — the button's own progress bar reports it, and the user
    // can carry on with Step 2 while the art downloads.
    fetchDiscogsImage({ replace: true, release: data }).catch(() => {});
  };

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
      onDiscogsReleaseLoaded(data);
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
      onDiscogsReleaseLoaded(data);
      setDiscogsUrl(`https://www.discogs.com/release/${result.id}`);
      setDiscogsSearchResults([]);
    } catch (err) { setDiscogsSearchError(err.message); }
    finally { setIsFetchingDiscogs(false); }
  };

  // ---- FFmpeg ----
  const loadFFmpeg = async () => {
    const ff = ffmpegRef.current;
    ff.on("log", ({ message: msg }) => { logOutputRef.current += msg + "\n"; });
    ff.on("progress", ({ progress: p }) => setProgress(p));
    await ff.load(await loadFFmpegCore());
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

  // Create exactly `count` tracks by dividing the audio evenly, without running
  // silence auto-detection. Used when the user specified a track count in the
  // previous step (manual count or Discogs tracklist) — we honor that number
  // and let them drag the boundaries to fine-tune.
  // ---- Marker JSON: export / import track boundaries ------------------------
  // Versioned, and stamped with the audio it came from: the times are only
  // meaningful against that exact recording, so an import can say so rather
  // than silently laying one album's boundaries over another's.
  const MARKER_JSON_VERSION = 1;
  const buildMarkerJson = () => JSON.stringify({
    riptagMarkers: MARKER_JSON_VERSION,
    audio: audioFile
      ? { name: audioFile.name, size: audioFile.size, duration: Number((duration || 0).toFixed(3)) }
      : null,
    // Milliseconds are finer than any boundary a person drags to, and keep the
    // text readable.
    tracks: tracks.map(t => ({
      start: Number(t.startTime.toFixed(3)),
      end: Number(t.endTime.toFixed(3)),
      name: t.name,
    })),
  }, null, 2);

  const resetMarkerJson = () => { setMarkerJsonDirty(false); setMarkerJsonDraft(buildMarkerJson()); };

  const copyMarkerJson = () => {
    navigator.clipboard?.writeText(markerJsonDraft)
      .then(() => setMessage("Marker JSON copied to the clipboard."))
      .catch(() => setMessage("Could not copy — the browser blocked clipboard access. Select the text and copy manually."));
  };

  const downloadMarkerJson = () => {
    const base = (audioFile?.name || projectName || "riptag")
      .replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9 _\-]/g, "").trim() || "riptag";
    const url = URL.createObjectURL(new Blob([markerJsonDraft], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}-markers.json`;
    a.click();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1000);
  };

  const applyMarkerJson = () => {
    let parsed;
    try { parsed = JSON.parse(markerJsonDraft); }
    catch (err) { setMessage(`Marker JSON isn't valid JSON: ${err.message}`); return; }
    // A bare array is accepted too — it's the obvious thing to paste by hand.
    const rows = Array.isArray(parsed) ? parsed : parsed?.tracks;
    if (!Array.isArray(rows) || rows.length === 0) {
      setMessage('Marker JSON needs a "tracks" array with at least one entry.');
      return;
    }

    // Warn, don't refuse: a re-encode of the same rip changes the size and name
    // while the timings still line up, and only the user knows which it is.
    const src = Array.isArray(parsed) ? null : parsed.audio;
    if (src && audioFile) {
      const mismatch = [];
      if (src.name && src.name !== audioFile.name) mismatch.push(`name (${src.name})`);
      if (src.size && src.size !== audioFile.size) mismatch.push("file size");
      if (src.duration && duration > 0 && Math.abs(src.duration - duration) > 1) {
        mismatch.push(`length (${formatTime(src.duration)} vs ${formatTime(duration)})`);
      }
      if (mismatch.length && !window.confirm(
        `These markers were saved from a different audio file — ${mismatch.join(", ")} doesn't match.\n\n`
        + "The positions will only line up if it's the same recording. Apply them anyway?"
      )) return;
    }

    const limit = duration > 0 ? duration : Infinity;
    const cleaned = rows.map((r, i) => {
      // startTime/endTime as well as start/end, so a block copied straight out
      // of the internal track shape imports without editing.
      const rawStart = Number(r?.start ?? r?.startTime);
      const rawEnd = Number(r?.end ?? r?.endTime);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) return null;
      const startTime = Math.max(0, Math.min(rawStart, limit));
      const endTime = Math.max(startTime + 0.01, Math.min(rawEnd, limit));
      const name = r?.name != null && String(r.name).trim() !== ""
        ? String(r.name)
        : (trackNames[i] || discogsData?.tracklist?.[i]?.title || `Track ${i + 1}`);
      return { id: `${generateTrackId()}-${i}`, startTime, endTime, name };
    }).filter(Boolean).sort((a, b) => a.startTime - b.startTime);

    if (!cleaned.length) {
      setMessage("No usable markers in that JSON — every entry needs numeric start and end times, with end after start.");
      return;
    }

    snapshotTracks();
    setSilenceRegions([]);
    setTracks(cleaned);
    syncPeaksToTracks(cleaned);
    setExportedTracks([]);
    setMarkerJsonDirty(false);
    const skipped = rows.length - cleaned.length;
    setMessage(`Applied ${cleaned.length} marker${cleaned.length === 1 ? "" : "s"} from JSON`
      + `${skipped ? ` — skipped ${skipped} unusable entr${skipped === 1 ? "y" : "ies"}` : ""}.`);
  };

  const splitIntoEqualTracks = (count) => {
    if (!duration || duration <= 0) { setMessage("Load audio first"); return; }
    // If tracks already exist, just refresh names without re-splitting.
    if (tracks.length > 0) { applyTrackNames(); return; }
    const n = Math.max(1, Math.floor(count));
    setSilenceRegions([]);
    const newTracks = [];
    for (let i = 0; i < n; i++) {
      newTracks.push({
        id: generateTrackId(),
        startTime: (duration * i) / n,
        endTime: (duration * (i + 1)) / n,
        name: trackNames[i] || discogsData?.tracklist?.[i]?.title || `Track ${i + 1}`,
      });
    }
    setTracks(newTracks);
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
    setMessage(`✓ ${n} track(s) created from your specified count — drag the boundaries to adjust`);
  };

  const detectSilence = () => {
    if (!channelData || channelData.length === 0) { setMessage("Load audio first"); return; }
    // If tracks already exist, just update names without re-splitting
    if (tracks.length > 0) { applyTrackNames(); return; }
    setIsAnalyzing(true); cancelRef.current = false; setExportedTracks([]);
    setAnalyzeLog([]); setShowAnalyzeLog(true);
    const log = (msg) => setAnalyzeLog(prev => [...prev, msg]);
    const tsStart = 0, tsEnd = duration;
    log(`Audio: ${formatTime(duration)} · Range: ${formatTime(tsStart)} → ${formatTime(tsEnd)}`);
    log(`Target: all silences`);
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
        const rawPts = bestRegions.map(r => r.mid).filter(m => m > tsStart + 0.1 && m < tsEnd - 0.1).sort((a, b) => a - b);
        // Enforce minimum track length: greedily drop splits that would create a
        // track shorter than silMinTrackLen. Guarantees every resulting track is
        // at least that long (short segments merge into the previous track).
        const minLen = Math.max(0, silMinTrackLen);
        const pts = [];
        let prevBoundary = tsStart;
        for (const p of rawPts) {
          if (p - prevBoundary >= minLen) { pts.push(p); prevBoundary = p; }
        }
        // Drop the last split if the trailing track would be too short.
        while (pts.length && tsEnd - pts[pts.length - 1] < minLen) pts.pop();
        const dropped = rawPts.length - pts.length;
        log(`Placing ${pts.length} split(s) at silence midpoints${dropped > 0 ? ` (dropped ${dropped} < ${minLen}s min track length)` : ""}`);
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
        setMessage(`✓ ${pts.length} split point(s) via all silences`);
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
    return ["-metadata", `title=${title}`, "-metadata", `artist=${artist}`, "-metadata", `album=${album}`, "-metadata", `date=${year}`, "-metadata", `track=${i + 1}/${trackNames.length}`, "-metadata", `genre=${discogsData.genres?.join(", ") || ""}`, "-metadata", `comment=Digitized with RipTag`];
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
        // Keep the Blob itself, not only an object URL for it. Everything that
        // needs the bytes back — the ZIP, the video render — had to fetch() the
        // blob: URL through the network stack, which fails outright once the
        // browser can't serve the blob (net::ERR_UNEXPECTED). A restored project
        // already carries `file`; a fresh export now does too.
        exported.push({ uid: newAssetUid(), index: i, name: fn, file: blob, url: URL.createObjectURL(blob), size: blob.size, start: track.startTime, end: track.endTime, title: trackNames[i] || track.name });
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
    if (!exportedFiles.length) { setMessage("Nothing to zip — export some tracks first."); return; }
    const total = exportedFiles.length;
    const zipName = `${(projectName || "album").replace(/[^a-zA-Z0-9 _\-]/g, "").trim() || "album"}_tracks.zip`;
    rlog("downloadZip: started", { files: total, format: outputFormat });

    // Ask for the destination before anything is awaited: showSaveFilePicker
    // needs the click's transient activation, and reading the tracks would
    // spend it. Streaming to that handle keeps the whole archive off the heap
    // and out of the download manager — a 450 MB blob: URL handed to Edge is
    // what produced "Couldn't download – network issue".
    let fileHandle = null;
    if (typeof window.showSaveFilePicker === "function") {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: zipName,
          types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
        });
      } catch (e) {
        if (e?.name === "AbortError") { rlog("downloadZip: cancelled at the save dialog"); return; }
        // Any other failure (a browser without it, a blocked picker) falls
        // through to the blob download below.
        rlog("downloadZip: save picker unavailable, falling back to a blob download", e?.message || String(e));
      }
    }

    setMessage(`Building ZIP — 0/${total}…`);
    try {
      const zip = new JSZip();
      // exportedFiles, not exportedTracks: Step 5 copies point at a file that
      // is already in the archive.
      for (let i = 0; i < total; i++) {
        const t = exportedFiles[i];
        setMessage(`Building ZIP — reading ${i + 1}/${total}: ${t.name}`);
        let bytes;
        try {
          bytes = await readTrackBytes(t);
        } catch (e) {
          // Name the file. "Failed to fetch" for a whole archive told you
          // nothing about which track the browser had lost.
          throw new Error(`${e.message} (failed on “${t.name}”, file ${i + 1} of ${total})`);
        }
        zip.file(t.name, bytes);
      }
      setMessage(`Building ZIP — compressing ${total} file(s)…`);
      // FLAC and WAV differ here: FLAC is already compressed, so deflating it
      // burns CPU and a second full copy of the data for ~nothing.
      const alreadyCompressed = /^(flac|mp3|m4a|ogg|opus)$/i.test(outputFormat);
      const zipOptions = alreadyCompressed
        ? { compression: "STORE" }
        : { compression: "DEFLATE", compressionOptions: { level: 1 } };

      if (fileHandle) {
        // Chunks go straight to the file the user picked, so peak memory is one
        // track rather than the whole archive twice over.
        const writable = await fileHandle.createWritable();
        let written = 0;
        try {
          await new Promise((resolve, reject) => {
            const stream = zip.generateInternalStream({ ...zipOptions, type: "uint8array", streamFiles: true });
            // Serialised through one promise chain: write() is async and the
            // stream would otherwise hand us chunks faster than the disk takes
            // them.
            let chain = Promise.resolve();
            let lastPct = -1;
            stream.on("data", (chunk, meta) => {
              stream.pause();
              written += chunk.byteLength;
              const pct = Math.round(meta?.percent ?? 0);
              if (pct !== lastPct && pct % 5 === 0) {
                lastPct = pct;
                setMessage(`Writing ZIP — ${pct}% (${formatBytes(written)})`);
              }
              chain = chain
                .then(() => writable.write(chunk))
                .then(() => stream.resume())
                .catch(reject);
            });
            stream.on("error", reject);
            stream.on("end", () => { chain.then(resolve, reject); });
            stream.resume();
          });
          await writable.close();
        } catch (e) {
          try { await writable.abort(); } catch {}
          throw e;
        }
        rlog("downloadZip: done (streamed to disk)", { bytes: written, compression: zipOptions.compression });
        setMessage(`ZIP saved (${formatBytes(written)}) — ${fileHandle.name}`);
        return;
      }

      const blob = await zip.generateAsync(
        { ...zipOptions, type: "blob" },
        (meta) => {
          if (Math.round(meta.percent) % 10 === 0) setMessage(`Building ZIP — ${Math.round(meta.percent)}%`);
        },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      // In the document, not detached: a detached anchor's download can be
      // dropped for a large blob, which the browser then reports as a network
      // failure rather than anything it can explain.
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Held for five minutes. Thirty seconds is not enough when the browser is
      // prompting for a save location or flushing hundreds of megabytes, and
      // revoking mid-write is exactly the "network issue" the download manager
      // reports.
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 300000);
      rlog("downloadZip: done (blob download)", { bytes: blob.size, compression: zipOptions.compression });
      setMessage(`ZIP downloaded (${formatBytes(blob.size)})`);
    } catch (err) {
      rlog("downloadZip: FAILED", err?.message || String(err));
      setMessage(`ZIP error: ${err.message}`);
    }
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
    // A rejected play() used to be swallowed while isPlaying stayed true, so
    // the button showed "pause" over silent audio and the next press only
    // paused an already-paused element.
    if (p && p.catch) p.catch((err) => {
      if (err?.name !== 'AbortError') console.warn('audio play() failed:', err);
      setIsPlaying(false);
    });
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
    const el = audioRef.current;
    if (!el) return;
    // Read the element rather than isPlaying — the flag can drift out of sync
    // with actual playback, and then the first press does nothing audible.
    if (!el.paused) { stopPreview(); }
    else { safePlay(); setIsPlaying(true); }
  };

  // Export finishing is a natural checkpoint — persist the new track files.
  // The freshly exported list is passed through because `exportedTracks` state
  // hasn't committed yet at the call site.
  const saveProject = (expTracks) => saveActiveProject({ overrides: { exportedTracks: expTracks } });

  const clearAllHistory = async () => {
    if (renderQueue.pendingCount() > 0) {
      setMessage("Finish or cancel the active renders before clearing all projects.");
      return;
    }
    // Same reason as deleteProjectById: clear the pointer so the fresh project
    // doesn't autosave the wiped one back.
    activeProjectIdRef.current = null;
    setActiveProjectId(null);
    await storeDeleteAllProjects();
    renderQueue.clearFinished();
    await refreshProjects();
    await startNewProject();
  };

  // ---- Video Image Helpers ----
  // Longest edge of the on-screen preview image. Big enough for the overlay
  // preview canvas, small enough to decode in a few milliseconds.
  const PREVIEW_MAX_DIM = 1600;

  // Produces the 160px table thumbnail and a display-sized preview from a
  // single decode. Two things used to make dropping a large image feel like a
  // hang: the file was decoded on the main thread, and previewUrl pointed at
  // the original, so every preview redraw decoded the full-resolution image
  // again. Neither is true now.
  const createThumbnail = async (file, maxSize = 160) => {
    const scaleToUrl = (source, sw, sh, limit, type, quality) => new Promise((done) => {
      const s = Math.min(limit / sw, limit / sh, 1);
      const w = Math.max(1, Math.round(sw * s));
      const h = Math.max(1, Math.round(sh * s));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(source, 0, 0, w, h);
      canvas.toBlob((blob) => done(blob ? URL.createObjectURL(blob) : null), type, quality);
    });

    const build = async (source, sw, sh) => {
      const thumbUrl = await scaleToUrl(source, sw, sh, maxSize, "image/jpeg", 0.7);
      // Only re-encode when there's something to save — a small image is
      // cheaper shown as-is. webp so a transparent PNG keeps its alpha.
      const previewUrl = Math.max(sw, sh) > PREVIEW_MAX_DIM
        ? await scaleToUrl(source, sw, sh, PREVIEW_MAX_DIM, "image/webp", 0.85)
        : null;
      return {
        thumbUrl: thumbUrl || URL.createObjectURL(file),
        previewUrl: previewUrl || URL.createObjectURL(file),
        width: sw, height: sh,
      };
    };

    // createImageBitmap decodes off the main thread, so the tab stays
    // responsive while a 60-megapixel scan is being read.
    if (typeof createImageBitmap === "function") {
      let bmp = null;
      try { bmp = await createImageBitmap(file); } catch { bmp = null; }
      if (bmp) {
        try { return await build(bmp, bmp.width, bmp.height); }
        finally { try { bmp.close(); } catch {} }
      }
    }

    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = async () => {
        const out = await build(img, img.width, img.height);
        URL.revokeObjectURL(url);
        resolve(out);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ thumbUrl: URL.createObjectURL(file), previewUrl: URL.createObjectURL(file), width: 0, height: 0 });
      };
      img.src = url;
    });
  };

  // `meta` is merged into every image this call adds — `source: "discogs"` is
  // what lets a later release swap replace exactly the art it fetched and leave
  // the user's own uploads alone. `ignoreIds` excludes images that are being
  // removed in the same tick from the duplicate check, since `videoImages` in
  // this closure still has them.
  const addImagesToVideo = async (files, { meta = {}, ignoreIds = null } = {}) => {
    const imageFiles = Array.from(files || []).filter(f => f?.type?.startsWith("image/"));
    if (!imageFiles.length) return;
    // Dedupe against current state AND within the incoming batch (in case the
    // same file appears twice in one drop). stopPropagation in handleDrop
    // already prevents the handler from firing twice for the same event, so
    // this check is sufficient.
    const existingKeys = new Set(videoImages
      .filter(img => !ignoreIds?.has(img.id))
      .map(img => `${img.file.name}:${img.file.size}`));
    const seenInBatch = new Set();
    const fresh = [];
    for (const f of imageFiles) {
      const key = `${f.name}:${f.size}`;
      if (existingKeys.has(key) || seenInBatch.has(key)) continue;
      seenInBatch.add(key);
      fresh.push(f);
    }
    if (!fresh.length) return;
    setImageLoadingStatus({ loaded: 0, total: fresh.length, current: fresh[0].name });
    for (let i = 0; i < fresh.length; i++) {
      const f = fresh[i];
      setImageLoadingStatus({ loaded: i, total: fresh.length, current: f.name });
      const id = `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      // Add a placeholder entry immediately so the row appears with a spinner
      setVideoImages(prev => [...prev, { id, file: f, thumbUrl: null, previewUrl: null, loading: true, width: 0, height: 0, stretchToFit: false, useBlurBg: true, bgBlur: defaultBgBlur, paddingColor: "#000000", motion: "none", motionSpeed: 1, bgMotion: "none", bgMotionSpeed: 1, ...meta }]);
      setSelectedVideoImages(prev => { const next = new Set(prev); next.add(id); return next; });
      const { thumbUrl, previewUrl, width, height } = await createThumbnail(f);
      // Step 1's table reads width/height; step 5 (and the memory estimate,
      // "Match image" resolution, and Image Settings oversize count) reads
      // naturalWidth/naturalHeight. Write both so neither silently sees zero.
      setVideoImages(prev => prev.map(img => img.id === id
        ? { ...img, thumbUrl, previewUrl, width, height, naturalWidth: width, naturalHeight: height, loading: false }
        : img));
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
      // Reuse the cached duration computed in Step 1 if available; otherwise
      // decode the file here to determine duration.
      const cacheKey = `${f.name}:${f.size}`;
      let dur = typeof audioDurationMap[cacheKey] === "number" ? audioDurationMap[cacheKey] : 0;
      // Header read first: instant, and the only thing that works on a
      // multi-hour file. Decoding is the last resort, for containers whose
      // header carries no duration.
      if (!dur) dur = await probeAudioDuration(url);
      if (!dur) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const buf = await f.slice().arrayBuffer();
          const decoded = await ctx.decodeAudioData(buf);
          dur = decoded.duration;
          ctx.close();
        } catch { /* fallback — leave dur = 0 */ }
      }
      const title = f.name.replace(/\.[^.]+$/, "");
      // Add each track immediately so it appears in the table as it loads
      setExportedTracks(prev => [...prev, { uid: newAssetUid(), title, name: f.name, size: f.size, start: 0, end: dur, url, file: f }]);
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
    // Drop any per-track pins that referenced it, so those tracks go back to Auto.
    setTrackImageAssign(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, imgId]) => imgId !== id));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    if (textPreviewImgId === id) setTextPreviewImgId(null);
  };

  // ---- Bulk clears for the Video step ---------------------------------------
  // Each of these drops the live state *and* saves, so the project record and
  // its IndexedDB blobs are pruned too (saveActiveProject deletes any blob whose
  // slot no longer exists) rather than leaving orphans behind.

  // The state setters below don't commit until after these functions return, so
  // every save passes explicit overrides. Chaining two clears and letting each
  // save on its own would make the second one write the first's data back.
  const wipeAudioState = () => {
    exportedTracks.forEach(t => { try { URL.revokeObjectURL(t.url); } catch {} });
    setExportedTracks([]);
    setSelectedVideoAudios(new Set());
    setVideoAudioOrder([]);
    setTrackClips({});
    setExpandedAudioRows(new Set());
    // Pins are keyed by track index, so they're meaningless without the tracks.
    setTrackImageAssign({});
    setTrackTextOverrides({});
    setTextPreviewTrackIdx(null);
  };
  const AUDIO_CLEARED_SETTINGS = { selectedVideoAudios: [], videoAudioOrder: [], trackClips: {}, trackImageAssign: {}, trackTextOverrides: {} };

  const wipeImageState = () => {
    videoImages.forEach(im => {
      if (im.thumbUrl) { try { URL.revokeObjectURL(im.thumbUrl); } catch {} }
      if (im.previewUrl) { try { URL.revokeObjectURL(im.previewUrl); } catch {} }
    });
    setVideoImages([]);
    setSelectedVideoImages(new Set());
    setManualImageTimings({});
    setExpandedImgPreviews(new Set());
    setTrackImageAssign({});
    setTextPreviewImgId(null);
    setShowTextPreview(false);
  };
  const IMAGE_CLEARED_SETTINGS = { selectedVideoImages: [], manualImageTimings: {}, trackImageAssign: {} };

  const clearVideoAudioTable = async () => {
    if (exportedTracks.length === 0) return;
    if (!window.confirm(`Remove all ${exportedTracks.length} audio track${exportedTracks.length === 1 ? "" : "s"} from the video? Files you already downloaded are unaffected.`)) return;
    wipeAudioState();
    await saveActiveProject({ overrides: { exportedTracks: [], settings: { ...AUDIO_CLEARED_SETTINGS } } });
    setMessage("Cleared the audio tracks table.");
  };

  const clearVideoImageTable = async () => {
    if (videoImages.length === 0) return;
    if (!window.confirm(`Remove all ${videoImages.length} image${videoImages.length === 1 ? "" : "s"} from the video?`)) return;
    wipeImageState();
    await saveActiveProject({ overrides: { videoImages: [], settings: { ...IMAGE_CLEARED_SETTINGS } } });
    setMessage("Cleared the images table.");
  };

  const clearAllVideoTables = async () => {
    if (exportedTracks.length === 0 && videoImages.length === 0) return;
    if (!window.confirm(`Clear both tables — ${exportedTracks.length} audio track${exportedTracks.length === 1 ? "" : "s"} and ${videoImages.length} image${videoImages.length === 1 ? "" : "s"}?`)) return;
    wipeAudioState();
    wipeImageState();
    // One save covering both, so neither wipe's stale closure can undo the other.
    await saveActiveProject({ overrides: {
      exportedTracks: [], videoImages: [],
      settings: { ...AUDIO_CLEARED_SETTINGS, ...IMAGE_CLEARED_SETTINGS },
    } });
    setMessage("Cleared the audio and image tables.");
  };

  const clearRenderedVideo = async () => {
    if (!renderedVideoSrc) return;
    if (!window.confirm("Delete the rendered video? This removes it from browser storage — download it first if you want to keep it.")) return;
    const id = activeProjectIdRef.current;
    try { URL.revokeObjectURL(renderedVideoSrc); } catch {}
    setRenderedVideoSrc(null);
    // A finished job would otherwise keep offering the deleted result.
    if (id) renderQueue.clear(id);
    try {
      if (id) {
        await deleteBlob(blobKey(id, "video"));
        const rec = await storeGetProject(id);
        if (rec) {
          const bytes = { ...(rec.bytes || {}), video: 0 };
          bytes.total = (bytes.audio || 0) + (bytes.tracks || 0) + (bytes.images || 0);
          await storePutProject({ ...rec, video: null, bytes, updatedAt: Date.now() });
        }
      }
      // Legacy single-slot key from before projects existed.
      await idbDelete("rendered_video");
      await refreshProjects();
    } catch (e) {
      setMessage(`Removed from the page, but storage cleanup failed: ${e?.message || e}`);
      return;
    }
    setMessage("Deleted the rendered video.");
  };

  const toggleVideoAudio = (idx) => {
    setSelectedVideoAudios(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  // Duplicate an audio row so one long file can be rendered several times with
  // different clip ranges / images. The copy shares the source's blob (same
  // url/file, new uid) and is appended to exportedTracks, then slotted into the
  // display order right below the row it came from — appending keeps every
  // index-keyed piece of state (clips, pins, selection, order) valid as-is.
  const duplicateAudioRow = (trackIdx, orderIdx) => {
    const src = exportedTracks[trackIdx];
    if (!src) return;
    const newIdx = exportedTracks.length;
    skipAudioAutoSelectRef.current = true;
    setExportedTracks(prev => [...prev, { ...prev[trackIdx], uid: newAssetUid(), copyOf: prev[trackIdx].uid }]);
    setVideoAudioOrder(prev => {
      const base = prev.length === exportedTracks.length ? prev : exportedTracks.map((_, i) => i);
      const next = [...base];
      const at = next.indexOf(trackIdx) === -1 ? next.length - 1 : (orderIdx ?? next.indexOf(trackIdx));
      next.splice(at + 1, 0, newIdx);
      return next;
    });
    setSelectedVideoAudios(prev => new Set(prev).add(newIdx));
    // Carry the source row's per-track settings over, so the copy starts as an
    // exact duplicate and the user only edits what should differ.
    const range = getTrackClipRange(trackIdx);
    if (range?.isClipped) setTrackClips(prev => ({ ...prev, [newIdx]: { start: range.clipStart, end: range.clipEnd } }));
    setTrackImageAssign(prev => (prev[trackIdx] ? { ...prev, [newIdx]: prev[trackIdx] } : prev));
    setTrackTextOverrides(prev => (prev[trackIdx] ? { ...prev, [newIdx]: { ...prev[trackIdx] } } : prev));
    setMessage(`Copied “${src.title || src.name}” — set a different clip range on the copy to render it as its own video.`);
  };

  // Remove a single audio row. Every piece of Step 5 state is keyed by the
  // exportedTracks index, so dropping one entry means shifting each key above
  // it down by one.
  const removeAudioRow = (trackIdx) => {
    const t = exportedTracks[trackIdx];
    if (!t) return;
    const shift = (i) => (i > trackIdx ? i - 1 : i);
    const shiftMap = (obj) => {
      const next = {};
      for (const [k, v] of Object.entries(obj)) {
        const i = Number(k);
        if (i === trackIdx) continue;
        next[shift(i)] = v;
      }
      return next;
    };
    const shiftSet = (set) => {
      const next = new Set();
      set.forEach(i => { if (i !== trackIdx) next.add(shift(i)); });
      return next;
    };
    // Copies share the source's object URL — only release it once nothing else points at it.
    if (t.url && !exportedTracks.some((o, i) => i !== trackIdx && o.url === t.url)) {
      try { URL.revokeObjectURL(t.url); } catch {}
    }
    skipAudioAutoSelectRef.current = true;
    setExportedTracks(prev => prev.filter((_, i) => i !== trackIdx));
    setVideoAudioOrder(prev => {
      const base = prev.length === exportedTracks.length ? prev : exportedTracks.map((_, i) => i);
      return base.filter(i => i !== trackIdx).map(shift);
    });
    setSelectedVideoAudios(shiftSet);
    setExpandedAudioRows(shiftSet);
    setTrackClips(shiftMap);
    setTrackImageAssign(shiftMap);
    setTrackTextOverrides(shiftMap);
    setTextPreviewTrackIdx(prev => (prev == null ? prev : prev === trackIdx ? null : shift(prev)));
    setMessage(`Removed “${t.title || t.name}” from the video.`);
  };

  // Effective clip range for a track. Falls back to the full track when no clip is set.
  // Returned start/end are file-relative seconds (each exported track file starts at 0).
  const getTrackClipRange = (trackIdx) => {
    const t = exportedTracks[trackIdx];
    if (!t) return null;
    const fullDur = t.end - t.start;
    // A file whose length couldn't be read is recorded as 0 seconds. Clamping
    // against that would snap every clip value the user types back to zero, so
    // an unknown length means "no upper bound" instead.
    const known = Number.isFinite(fullDur) && fullDur > 0;
    const limit = known ? fullDur : Infinity;
    const c = trackClips[trackIdx];
    const cs = c?.start != null ? Math.max(0, Math.min(limit, c.start)) : 0;
    const ce = c?.end != null ? Math.max(cs, Math.min(limit, c.end)) : Math.max(cs, fullDur);
    return { fullDur, durKnown: known, clipStart: cs, clipEnd: ce, clipDur: ce - cs, isClipped: cs > 0 || ce < fullDur };
  };

  const getOrderedAudios = () => {
    const order = videoAudioOrder.length === exportedTracks.length ? videoAudioOrder : exportedTracks.map((_, i) => i);
    return order.filter(i => selectedVideoAudios.has(i)).map(i => {
      const t = exportedTracks[i];
      if (!t) return null;
      const range = getTrackClipRange(i);
      // Override start/end so `end - start` yields the *clipped* duration — keeps every
      // downstream duration calc (image timing, totals, ffmpeg -t, YouTube timestamps) consistent.
      return { ...t, _trackIdx: i, clipStart: range.clipStart, clipEnd: range.clipEnd, clipDur: range.clipDur, isClipped: range.isClipped, start: 0, end: range.clipDur };
    }).filter(Boolean);
  };

  // selectedVideoAudios, videoAudioOrder, trackClips and trackImageAssign are
  // all keyed by index into exportedTracks. A restore that produced fewer
  // tracks (or none, if IndexedDB refused the read) left those sets pointing at
  // rows that no longer exist — which is how the Render button could be enabled
  // while the render had nothing to build from.
  useEffect(() => {
    const n = exportedTracks.length;
    const inRange = (i) => Number(i) >= 0 && Number(i) < n;
    setSelectedVideoAudios(prev => {
      const next = new Set([...prev].filter(inRange));
      return next.size === prev.size ? prev : next;
    });
    setVideoAudioOrder(prev => {
      const next = prev.filter(inRange);
      return next.length === prev.length ? prev : next;
    });
    setTrackClips(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => inRange(k)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    setTrackImageAssign(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => inRange(k)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [exportedTracks.length]);

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
      // Sync image transitions with audio track transitions. A track with an
      // explicit image pick uses it; the rest cycle through the selection.
      const timings = [];
      let cumTime = 0;
      orderedAudios.forEach((audio, i) => {
        const dur = audio.end - audio.start;
        const pickedId = trackImageAssign[audio._trackIdx];
        const picked = pickedId ? selectedImgs.find(im => im.id === pickedId) : null;
        const img = picked || selectedImgs[i % selectedImgs.length];
        // Consecutive tracks sharing an image become one segment — fewer ffmpeg
        // inputs, and the timeline reads as one block instead of a false cut.
        const prev = timings[timings.length - 1];
        if (prev && prev.id === img.id) prev.endTime = cumTime + dur;
        else timings.push({ id: img.id, startTime: cumTime, endTime: cumTime + dur });
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

  // Computed once per render — in loop mode this list has one entry per image
  // *occurrence*, so it can be much longer than videoImages.
  const rowTimings = getEffectiveImageTimings();

  // ---- Auto-match output resolution to the image ----------------------------
  // Resolves the image a given track will actually display, honouring pins and
  // falling back to the same cycling rule getEffectiveImageTimings uses.
  const imageForTrack = (orderIdx, trackIdx) => {
    const selectedImgs = videoImages.filter(img => selectedVideoImages.has(img.id));
    if (!selectedImgs.length) return null;
    const pinnedId = trackImageAssign[trackIdx];
    const pinned = pinnedId ? selectedImgs.find(im => im.id === pinnedId) : null;
    return pinned || selectedImgs[orderIdx % selectedImgs.length];
  };

  // The image the finished video opens with — what "auto match" follows.
  const autoMatchSourceImage = (() => {
    const first = rowTimings[0];
    if (first) {
      const img = videoImages.find(im => im.id === first.id);
      if (img?.naturalWidth) return img;
    }
    return videoImages.find(im => selectedVideoImages.has(im.id) && im.naturalWidth) || null;
  })();

  // Keep the resolution fields in step with that image while auto-match is on.
  useEffect(() => {
    if (!autoMatchImageRes) return;
    const img = autoMatchSourceImage;
    if (!img?.naturalWidth || !img?.naturalHeight) return;
    setVideoWidth(String(img.naturalWidth));
    setVideoHeight(String(img.naturalHeight));
  }, [autoMatchImageRes, autoMatchSourceImage]);

  // ---- Settings shared by both render modes ---------------------------------
  // The concat render and the batch used to keep their own copies of the
  // resolution mode, the scale and the text overlay, so the same project could
  // be set two ways at once. These are the single source of truth; both panels
  // read and write them, and both panels show the same value.
  //
  // "auto" means the image decides the size: the opening image for the concat
  // render, each track's own image for the batch.
  const resolutionMode = autoMatchImageRes ? "auto" : "fixed";
  // "off" | "track" | "custom" — the enable switch and the text source folded
  // into one control, matching what the batch panel always offered.
  const sharedTextMode = textOverlay.enabled ? textOverlay.source : "off";
  const setSharedTextMode = (mode) => setTextOverlay(o => ({
    ...o,
    enabled: mode !== "off",
    // Keep the last real source when switching off, so turning it back on
    // returns to what the user had chosen.
    source: mode === "off" ? o.source : mode,
  }));
  // Final output size of the concat render, scale included.
  const concatDimensions = {
    w: scaleDimension(parseInt(videoWidth) || 1920, renderScale),
    h: scaleDimension(parseInt(videoHeight) || 1080, renderScale),
  };

  // Cumulative [start,end) span of every ordered audio track on the video
  // timeline, used to caption segments with the track that's playing.
  const getAudioSpans = (orderedAudios) => {
    let cum = 0;
    return orderedAudios.map(a => {
      const dur = a.end - a.start;
      const span = { start: cum, end: cum + dur, title: a.title, trackIdx: a._trackIdx };
      cum += dur;
      return span;
    });
  };

  // A track's caption text and position, after any per-track override.
  const trackCaptionText = (trackIdx, fallbackTitle) => {
    const o = trackTextOverrides[trackIdx];
    return (o && o.text != null && o.text !== "") ? o.text : (fallbackTitle || "");
  };
  const trackCaptionPosition = (trackIdx) =>
    trackTextOverrides[trackIdx]?.position || textOverlay.position;

  const setTrackCaption = (trackIdx, patch) => {
    setTrackTextOverrides(prev => {
      const next = { ...prev, [trackIdx]: { ...(prev[trackIdx] || {}), ...patch } };
      // Drop entries that no longer override anything, so "has overrides"
      // counts stay honest.
      const e = next[trackIdx];
      if ((e.text == null || e.text === "") && !e.position) delete next[trackIdx];
      return next;
    });
  };

  // ---- Text overlay defaults (saved to localStorage, applied to new projects)
  const loadSavedTextDefaults = () => {
    try {
      const raw = localStorage.getItem(TEXT_DEFAULTS_KEY);
      return raw ? { ...DEFAULT_TEXT_OVERLAY, ...JSON.parse(raw) } : null;
    } catch { return null; }
  };
  const [hasSavedTextDefaults, setHasSavedTextDefaults] = useState(false);
  useEffect(() => { setHasSavedTextDefaults(!!loadSavedTextDefaults()); }, [mounted]);

  const saveTextDefaults = () => {
    try {
      localStorage.setItem(TEXT_DEFAULTS_KEY, JSON.stringify(textOverlay));
      setHasSavedTextDefaults(true);
      setMessage("Saved these text settings as your default for new projects.");
    } catch (e) { setMessage(`Could not save defaults: ${e?.message || e}`); }
  };
  const resetTextToDefaults = () => {
    const saved = loadSavedTextDefaults();
    setTextOverlay({ ...(saved || DEFAULT_TEXT_OVERLAY), enabled: textOverlay.enabled });
    setMessage(saved ? "Reset to your saved default." : "Reset to the built-in default.");
  };
  const clearTextDefaults = () => {
    try { localStorage.removeItem(TEXT_DEFAULTS_KEY); } catch {}
    setHasSavedTextDefaults(false);
    setTextOverlay({ ...DEFAULT_TEXT_OVERLAY, enabled: textOverlay.enabled });
    setMessage("Cleared your saved default and restored the built-in one.");
  };

  // Text only varies over time when it's sourced from the track titles; a
  // custom string is the same on every segment.
  const overlayTextVaries = textOverlay.enabled && textOverlay.source === "track";

  // Attach the overlay caption to each image timing, splitting a timing wherever
  // a track boundary falls inside it so the caption changes with the song.
  const attachOverlayText = (timings, orderedAudios) => {
    if (!textOverlay.enabled) return timings.map(t => ({ ...t, text: "", position: textOverlay.position }));
    if (!overlayTextVaries) return timings.map(t => ({ ...t, text: textOverlay.customText, position: textOverlay.position }));
    const spans = getAudioSpans(orderedAudios);
    const out = [];
    timings.forEach(t => {
      spans.forEach(s => {
        const start = Math.max(t.startTime, s.start);
        const end = Math.min(t.endTime, s.end);
        if (end - start > 0.02) out.push({
          id: t.id, startTime: start, endTime: end,
          text: trackCaptionText(s.trackIdx, s.title),
          position: trackCaptionPosition(s.trackIdx),
        });
      });
    });
    return out.length ? out : timings.map(t => ({ ...t, text: "", position: textOverlay.position }));
  };

  // ---- Text overlay preview -------------------------------------------------
  const overlayPreviewImage = () =>
    videoImages.find(i => i.id === textPreviewImgId)
    || videoImages.find(i => selectedVideoImages.has(i.id))
    || videoImages[0]
    || null;

  const overlayPreviewText = () => {
    if (textOverlay.source === "custom") return textOverlay.customText;
    const audios = getOrderedAudios();
    const chosen = audios.find(a => a._trackIdx === textPreviewTrackIdx) || audios[0];
    return chosen?.title || "Song title";
  };

  // Reproduces the render's letterbox / stretch / blur-background compositing on
  // a canvas so the preview frame matches the encoded one. Both previews — the
  // Text Overlay one and the small one under the Render Concat button — go
  // through here, so neither can drift from the other or from the encoder.
  const paintFramePreview = async (canvas, { img, text, overlay, outW, outH, maxWidth }) => {
    if (!canvas) return;
    // Everything drawTextOverlay does is a percentage of the frame, so shrinking
    // the canvas keeps the composition identical at a fraction of the pixels.
    const shrink = maxWidth ? Math.min(1, maxWidth / outW) : 1;
    const w = Math.max(2, Math.round(outW * shrink));
    const h = Math.max(2, Math.round(outH * shrink));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    let im = null;
    const src = img?.previewUrl || img?.thumbUrl;
    if (src) {
      try { im = await loadImageElement(src); } catch { /* draw bg only */ }
    }
    if (im) {
      const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      const contain = Math.min(w / iw, h / ih);
      const cover = Math.max(w / iw, h / ih);
      if (img.useBlurBg) {
        ctx.save();
        const blurPct = clampBgBlur(img.bgBlur);
        ctx.filter = `blur(${Math.max(1, Math.round(h * 0.011 * (blurPct / 100)))}px)`;
        const bw = iw * cover * 1.02, bh = ih * cover * 1.02;
        ctx.drawImage(im, (w - bw) / 2, (h - bh) / 2, bw, bh);
        ctx.restore();
        ctx.drawImage(im, (w - iw * contain) / 2, (h - ih * contain) / 2, iw * contain, ih * contain);
      } else if (img.stretchToFit) {
        ctx.drawImage(im, 0, 0, w, h);
      } else {
        ctx.fillStyle = img.paddingColor || videoBgColor;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(im, (w - iw * contain) / 2, (h - ih * contain) / 2, iw * contain, ih * contain);
      }
    } else {
      ctx.fillStyle = videoBgColor;
      ctx.fillRect(0, 0, w, h);
    }
    drawTextOverlay(ctx, text, overlay, w, h);
  };

  const drawOverlayPreview = async () => {
    const img = overlayPreviewImage();
    if (!img) return;
    await paintFramePreview(textPreviewCanvasRef.current, {
      img,
      text: overlayPreviewText(),
      overlay: textOverlay,
      outW: concatDimensions.w,
      outH: concatDimensions.h,
    });
  };

  // ---- Concat button preview ------------------------------------------------
  // The frame the concat video opens with: the first image on the timeline,
  // captioned the way the first track will be. Drawn automatically so the
  // button underneath it isn't the only description of what it produces.
  const concatPreviewImage = (() => {
    const first = rowTimings[0];
    const img = first ? videoImages.find(im => im.id === first.id) : null;
    return img || videoImages.find(im => selectedVideoImages.has(im.id)) || null;
  })();

  const concatPreviewFrame = () => {
    const firstAudio = getOrderedAudios()[0];
    if (!textOverlay.enabled) return { text: "", overlay: textOverlay };
    if (textOverlay.source === "custom") return { text: textOverlay.customText, overlay: textOverlay };
    if (!firstAudio) return { text: "", overlay: textOverlay };
    return {
      text: trackCaptionText(firstAudio._trackIdx, firstAudio.title),
      overlay: { ...textOverlay, position: trackCaptionPosition(firstAudio._trackIdx) },
    };
  };

  const drawConcatPreview = async () => {
    const canvas = concatPreviewCanvasRef.current;
    if (!canvas) return;
    const { text, overlay } = concatPreviewFrame();
    await paintFramePreview(canvas, {
      img: concatPreviewImage,
      text,
      overlay,
      outW: concatDimensions.w,
      outH: concatDimensions.h,
      maxWidth: 420,
    });
  };

  const runOverlayPreview = async () => {
    setShowTextPreview(true);
    setTextPreviewBusy(true);
    try {
      // System fonts may not be measurable until the font set settles; without
      // this the first preview can lay out with a fallback metric.
      if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
      await drawOverlayPreview();
    } finally {
      setTextPreviewBusy(false);
    }
  };

  // Keep an open preview in sync with the controls.
  useEffect(() => {
    if (!showTextPreview) return;
    let cancelled = false;
    (async () => {
      if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
      if (!cancelled) await drawOverlayPreview();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTextPreview, textOverlay, textPreviewImgId, textPreviewTrackIdx, concatDimensions.w, concatDimensions.h, videoBgColor, videoImages, exportedTracks, trackClips, videoAudioOrder, selectedVideoAudios]);

  // A storage write that isn't awaited — an autosave racing a navigation, a
  // background putBlob — surfaced as a bare "Uncaught (in promise)
  // QuotaExceededError" in the console and nothing at all in the UI.
  useEffect(() => {
    const onRejection = (e) => {
      const err = e?.reason;
      if (!isQuotaError(err)) return;
      e.preventDefault();
      rlog("unhandled storage rejection (quota)", err?.message || String(err));
      setMessage("Out of browser storage — a background save failed. "
        + "Delete an old project from the Projects panel, or free disk space. "
        + "Exports and renders still work; only saving is affected.");
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  // Warm the ffmpeg core as soon as the user reaches the export/render steps,
  // so pressing Render doesn't begin with a 32 MB download.
  useEffect(() => {
    if (step < 4) return;
    loadFFmpegCore().catch(() => {});
  }, [step]);

  // Redraw the concat preview whenever anything it shows can have changed.
  useEffect(() => {
    if (step !== 5) return;
    let cancelled = false;
    (async () => {
      if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
      if (!cancelled) await drawConcatPreview();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, textOverlay, trackTextOverrides, concatDimensions.w, concatDimensions.h, videoBgColor,
      videoImages, selectedVideoImages, selectedVideoAudios, videoAudioOrder, exportedTracks,
      slideshowMode, trackImageAssign, manualImageTimings, loopInterval]);

  // True when any *selected* image has a motion effect. Motion forces the render
  // to a real frame rate, so the fps control and the slow-render warning key off it.
  const anySelectedImageMotion = videoImages.some(img =>
    selectedVideoImages.has(img.id) &&
    ((img.motion && img.motion !== "none") || (img.useBlurBg && (img.bgMotion || "none") !== "none"))
  );

  // Ordering for the Step 5 audio table. Drag-and-drop writes an explicit
  // order; these are the one-click orderings on top of it.
  const sortVideoAudio = (mode) => {
    const idx = exportedTracks.map((_, i) => i);
    // Sorted on the filename, because that is the column on screen — sorting
    // by one string while displaying another reads as a broken sort.
    const nameOf = (i) => (exportedTracks[i]?.name || exportedTracks[i]?.title || "");
    const sorted = mode === "index"
      ? idx
      : [...idx].sort((a, b) => {
          const cmp = nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: "base" });
          // Ties keep export order, so equal titles don't shuffle between renders.
          return cmp !== 0 ? (mode === "title-desc" ? -cmp : cmp) : a - b;
        });
    setVideoAudioOrder(sorted);
    setAudioSortMode(mode);
  };

  // Tracks arrive in export order, which is the order they were cut from the
  // side — rarely the order anyone wants to look at them in. Sorted by title on
  // first sight of a new set, then left alone so a manual drag survives.
  const autoSortedTracksRef = useRef(0);
  useEffect(() => {
    if (exportedTracks.length === 0) { autoSortedTracksRef.current = 0; return; }
    if (autoSortedTracksRef.current === exportedTracks.length) return;
    autoSortedTracksRef.current = exportedTracks.length;
    if (audioSortMode === "manual") return;
    sortVideoAudio(audioSortMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportedTracks.length]);

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
  const handleAudioDragEnd = () => {
    // A hand-placed order is the user's, so stop re-sorting behind them.
    if (audioDragRef.current !== null) setAudioSortMode("manual");
    audioDragRef.current = null;
  };

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

  // Every image this page pulled from Discogs, so a release swap can clear
  // exactly those and leave anything the user added by hand in place.
  const removeDiscogsImages = () => {
    const doomed = videoImages.filter(im => im.source === "discogs");
    if (!doomed.length) return new Set();
    const ids = new Set(doomed.map(im => im.id));
    setVideoImages(prev => prev.filter(im => {
      if (!ids.has(im.id)) return true;
      if (im.thumbUrl) { try { URL.revokeObjectURL(im.thumbUrl); } catch {} }
      if (im.previewUrl) { try { URL.revokeObjectURL(im.previewUrl); } catch {} }
      return false;
    }));
    setSelectedVideoImages(prev => { const next = new Set(prev); ids.forEach(i => next.delete(i)); return next; });
    // Pins pointing at a removed image would leave those tracks on a dead id.
    setTrackImageAssign(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, imgId]) => !ids.has(imgId)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    setTrackTextOverrides(prev => prev);
    if (textPreviewImgId && ids.has(textPreviewImgId)) setTextPreviewImgId(null);
    return ids;
  };

  // `replace` is what a new Discogs release uses: drop the previous release's
  // art first, so the table shows this release rather than both.
  const fetchDiscogsImage = async ({ replace = false, release = null } = {}) => {
    const data = release || discogsData;
    const images = data?.images;
    if (!images?.length) { if (!release) setMessage("No Discogs images available"); return; }
    const removedIds = replace ? removeDiscogsImages() : new Set();
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
      await addImagesToVideo(fetchedFiles, {
        meta: { source: "discogs", releaseId: data.id ?? null },
        ignoreIds: removedIds,
      });
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
    const { w, h } = concatDimensions;
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

  // Rough peak-wasm-memory estimate so the user can predict whether ffmpeg.wasm will OOM.
  // Components: ffmpeg base runtime, biggest decoded source image (RGBA), x264 buffered yuv420 frames, mux/audio overhead.
  // The wasm single-threaded build ceiling is ~2 GB; we warn at ~1.5 GB.
  const WASM_MEMORY_LIMIT_MB = 2048;
  const WASM_MEMORY_WARN_MB = 1500;
  const estimateMemoryUsage = () => {
    const { w, h } = concatDimensions;
    const selectedImgs = videoImages.filter(img => selectedVideoImages.has(img.id));
    if (selectedImgs.length === 0) return null;
    const parsedMax = imageMaxDim === "auto" ? null : parseInt(imageMaxDim);
    const effectiveMaxDim = parsedMax === 0 ? Infinity
      : (parsedMax && parsedMax > 0 ? parsedMax : Math.round(Math.max(w, h) * 1.25));
    let largestSourceBytes = 0;
    for (const img of selectedImgs) {
      const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
      if (!nw || !nh) continue;
      const longest = Math.max(nw, nh);
      const scale = longest > effectiveMaxDim ? effectiveMaxDim / longest : 1;
      const eW = Math.max(1, Math.round(nw * scale)), eH = Math.max(1, Math.round(nh * scale));
      largestSourceBytes = Math.max(largestSourceBytes, eW * eH * 4);
    }
    const baseMB = 150;
    const sourceMB = (largestSourceBytes * 2) / (1024 * 1024);
    const isHighRes = (w * h) >= (2560 * 1440);
    const refFrames = isHighRes ? 4 : 8;
    const encoderMB = (w * h * 1.5 * refFrames) / (1024 * 1024);
    const muxMB = 80;
    // Each caption is an extra full-frame RGBA input alongside its image.
    const overlayMB = textOverlay.enabled ? (w * h * 4 * 2) / (1024 * 1024) : 0;
    const totalMB = baseMB + sourceMB + encoderMB + muxMB + overlayMB;
    return {
      totalMB, baseMB, sourceMB, encoderMB, muxMB, overlayMB,
      effectiveMaxDim,
      overLimit: totalMB > WASM_MEMORY_LIMIT_MB,
      nearLimit: totalMB > WASM_MEMORY_WARN_MB,
    };
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

  // Pre-shrink huge source images: a 7000+ px PNG decodes to >200 MB of RGBA in the wasm heap, which combined with x264's frame buffers exceeds the ~2 GB wasm ceiling.
  const downscaleImageForRender = async (file, maxDim) => {
    let perFile = downscaleCache.get(file);
    if (perFile?.has(maxDim)) return perFile.get(maxDim);
    const result = await computeDownscale(file, maxDim);
    if (!perFile) { perFile = new Map(); downscaleCache.set(file, perFile); }
    perFile.set(maxDim, result);
    return result;
  };

  // ---- Video Render ----
  // Freezes everything the encoder needs into a plain object. A queued job can
  // outlive the project it came from, so past this point the render must never
  // read component state — the user may have switched to another project by the
  // time it runs.
  //
  // Synchronous on purpose: the audio *bytes* are read later, by resolveSpecAudios
  // when the job actually starts. Reading them here meant the button did several
  // seconds of blob I/O before the job (and its progress bar) existed.
  const buildRenderSpec = () => {
    const audios = getOrderedAudios();
    const images = videoImages.filter(img => selectedVideoImages.has(img.id));
    if (audios.length === 0 || images.length === 0) return null;
    const resolvedAudios = audios.map(t => ({
      title: t.title, name: t.name, file: t.file, url: t.url,
      start: t.start, end: t.end,
      clipStart: t.clipStart, clipEnd: t.clipEnd, isClipped: t.isClipped,
    }));
    return {
      name: (videoOutputName || projectName || "album").replace(/[^a-zA-Z0-9 _\-]/g, "").trim().replace(/\s+/g, "_") || "album",
      audios: resolvedAudios,
      // `file` is a disk-backed File handle, so holding it costs nothing.
      images: images.map(img => ({
        id: img.id, file: img.file,
        stretchToFit: img.stretchToFit, useBlurBg: img.useBlurBg, bgBlur: img.bgBlur, paddingColor: img.paddingColor,
        motion: img.motion, motionSpeed: img.motionSpeed,
        bgMotion: img.bgMotion, bgMotionSpeed: img.bgMotionSpeed,
      })),
      timings: attachOverlayText(getEffectiveImageTimings(), audios),
      totalDur: audios.reduce((s, t) => s + (t.end - t.start), 0),
      w: concatDimensions.w,
      h: concatDimensions.h,
      bgColor: videoBgColor,
      imageMaxDim,
      motionFps,
      slideshowMode,
      loopInterval,
      textOverlay: { ...textOverlay },
      overlayTextVaries,
      // Captured for the post-render YouTube metadata fill-in, which also has
      // to work when the render finishes on a project that isn't open.
      ytMeta: { discogsData, ytTitleVariation, ytTimestampFormat, ytTimestampSeparator, ytIncludeTrackNums, ytDescSuffix },
    };
  };

  // A track's bytes. `file` is the Blob the export or the project restore kept
  // hold of; the object URL is only a fallback for older in-memory state, and
  // it can fail (net::ERR_UNEXPECTED) once the browser drops the blob — so the
  // failure names the track instead of surfacing as a bare "Failed to fetch".
  const readTrackBytes = async (t) => {
    const label = t.title || t.name || "a track";
    // 1. The Blob the export or the restore is holding. Always present for a
    //    track produced in this session, and the only source that can't fail.
    if (t.file) return t.file;

    // 2. IndexedDB. A restored project's blobs live there under a key derived
    //    from the track's position, so a page that lost its in-memory copy can
    //    still get the bytes back.
    const idx = exportedTracks.indexOf(t);
    const pid = activeProjectIdRef.current;
    if (pid && idx >= 0) {
      try {
        const stored = await getBlob(blobKey(pid, "track", idx));
        if (stored && stored.size > 0) {
          rlog("readTrackBytes: served from IndexedDB", { label, bytes: stored.size });
          return stored;
        }
      } catch (e) {
        rlog("readTrackBytes: IndexedDB read failed", { label, error: e?.message || String(e) });
      }
    }

    // 3. The object URL. Last because it goes through the network stack and is
    //    the one that fails (net::ERR_UNEXPECTED) when the browser can no
    //    longer serve the blob — out of disk, or over the storage quota.
    if (t.url) {
      try {
        const res = await fetch(t.url);
        if (res.ok) return await res.blob();
        rlog("readTrackBytes: blob URL returned a non-OK response", { label, status: res.status });
      } catch (e) {
        rlog("readTrackBytes: blob URL fetch threw", { label, error: e?.message || String(e) });
      }
    }

    throw new Error(`Could not read the audio for “${label}” — the browser dropped its data `
      + "and it isn't in storage either. This usually means the browser is out of disk space "
      + "or over its storage quota. Free some space, then re-export the tracks in Step 4.");
  };

  // Reads each track's bytes. Deferred to the moment a job starts so a queued
  // render doesn't pin hundreds of megabytes of audio while it waits its turn.
  const resolveSpecAudios = (audios) => Promise.all(
    audios.map(async (t) => ({ ...t, blob: await readTrackBytes(t) }))
  );

  // Pure with respect to component state: everything comes from `spec`, and all
  // output goes through `ctx` (supplied by the render queue).
  const runVideoRender = async (spec, ctx) => {
    const selectedAudioList = spec.audios;
    const selectedImageList = spec.images;
    const effectiveTimings = spec.timings;
    const appendVideoLog = ctx.onLog;
    const name = spec.name;
    const totalDur = spec.totalDur;
    const { imageMaxDim, motionFps, slideshowMode, loopInterval, textOverlay, overlayTextVaries } = spec;
    const videoBgColor = spec.bgColor;
    let ffV = null;
    const timer = createRenderTimer(appendVideoLog);
    try {
      ffV = new FFmpeg();
      ctx.registerFfmpeg(ffV);
      const oomState = { detected: false, lastSignal: "", encodeCompleted: false };
      // Progress window for the pass currently running. Loop mode renders in two
      // passes (build the image cycle, then repeat it over the audio), so each
      // pass maps its own time= readout onto a slice of the 0–1 bar.
      const prog = { dur: totalDur, base: 0, span: 1 };
      // "hard" patterns mean the encode definitely failed; "soft" (plain Aborted()) only counts if Lsize= never appeared.
      const HARD_OOM = /(malloc of size \d+ failed|Cannot enlarge memory|Out of memory|memory access out of bounds|Error submitting video frame to the encoder)/i;
      const SOFT_OOM = /Aborted\(\)/i;
      // A filtergraph this build won't accept (missing filter, unknown option,
      // bad expression) fails during graph init, before a single frame is
      // encoded. Catching it lets us retry without the motion effects instead
      // of losing the whole render.
      const GRAPH_ERROR = /(Error initializing filter|Error initializing complex filters|No such filter|Option '[^']*' not found|Error applying options to the filter|Invalid chars found in filter|Unable to parse graph)/i;
      const graphState = { error: "" };
      ffV.on("log", ({ message: msg }) => {
        appendVideoLog(msg);
        if (/Lsize=\s*\d+/.test(msg)) oomState.encodeCompleted = true;
        if (!graphState.error && GRAPH_ERROR.test(msg)) graphState.error = msg.trim();
        if (!oomState.detected && HARD_OOM.test(msg)) {
          oomState.detected = true;
          oomState.lastSignal = msg.trim();
        } else if (!oomState.detected && !oomState.encodeCompleted && SOFT_OOM.test(msg)) {
          oomState.detected = true;
          oomState.lastSignal = msg.trim();
        }
        // Parse time= from FFmpeg log for accurate 0–1 progress (progress event overshoots)
        const m = msg.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (m && prog.dur > 0) {
          const elapsed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          ctx.onProgress(Math.min(1, prog.base + prog.span * Math.min(1, elapsed / prog.dur)));
          // The rest of the same status line carries the rate-bearing fields.
          // Handing them to the timer is what lets the summary say whether a
          // slowdown tracks output growth, a frame-rate drop, or neither.
          const fps = msg.match(/fps=\s*([\d.]+)/)?.[1];
          const size = msg.match(/L?size=\s*(\S+)/)?.[1];
          const speed = msg.match(/speed=\s*([\d.]+x)/)?.[1];
          const q = msg.match(/\sq=\s*(-?[\d.]+)/)?.[1];
          timer.sample(elapsed, [
            fps && `fps ${fps}`, q && `q ${q}`, size && `out ${size}`, speed && `ffmpeg ${speed}`,
          ].filter(Boolean).join(" · "));
        }
      });
      await ffV.load(await loadFFmpegCore());
      timer.stage("ffmpeg core loaded");

      appendVideoLog(`Writing ${selectedAudioList.length} audio + ${selectedImageList.length} image file(s)…`);

      // Write audio files — use sanitized names for ffmpeg VFS
      const audioVfsNames = [];
      for (let i = 0; i < selectedAudioList.length; i++) {
        const t = selectedAudioList[i];
        const ext = (t.name || t.blob?.name || "audio").split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "wav";
        const vfsName = `audio${i}.${ext}`;
        audioVfsNames.push(vfsName);
        await ffV.writeFile(vfsName, await fetchFile(t.blob));
      }
      timer.stage(`wrote ${selectedAudioList.length} audio file(s) — `
        + `${(selectedAudioList.reduce((sum, t) => sum + (t.blob?.size || 0), 0) / 1048576).toFixed(1)} MB`);

      const w = spec.w, h = spec.h;

      const parsedMax = imageMaxDim === "auto" ? null : parseInt(imageMaxDim);
      const imgMaxDim = parsedMax === 0 ? Infinity
        : (parsedMax && parsedMax > 0 ? parsedMax : Math.round(Math.max(w, h) * 1.25));
      const resizedImageFiles = [];
      for (let i = 0; i < selectedImageList.length; i++) {
        const original = selectedImageList[i].file;
        const result = await downscaleImageForRender(original, imgMaxDim);
        if (result.resized) {
          appendVideoLog(`Pre-resized ${original.name}: ${result.original.w}×${result.original.h} → ${result.resizedTo.w}×${result.resizedTo.h}`);
        }
        resizedImageFiles.push(result.file);
      }
      timer.stage(`prepared ${resizedImageFiles.length} image(s) — `
        + `${(resizedImageFiles.reduce((sum, f) => sum + (f.size || 0), 0) / 1048576).toFixed(1)} MB, `
        + `max ${imgMaxDim === Infinity ? "unlimited" : `${imgMaxDim}px`}`);

      // Write image files (using resized versions where applicable)
      const imgVfsNames = [];
      for (let i = 0; i < resizedImageFiles.length; i++) {
        const f = resizedImageFiles[i];
        const ext = f.name.split(".").pop() || "jpg";
        const vfsName = `img${i}.${ext}`;
        imgVfsNames.push(vfsName);
        await ffV.writeFile(vfsName, await fetchFile(f));
      }
      timer.stage(`wrote ${imgVfsNames.length} image file(s) to the ffmpeg VFS`);
      const n = selectedAudioList.length;

      // ---- Slideshow segments ----------------------------------------------
      // One segment per image *occurrence*, not per image. Loop mode (and
      // per-track mode with more tracks than images) shows the same image
      // several times, so there are more segments than images.
      const imgIndexById = new Map(selectedImageList.map((img, i) => [img.id, i]));
      const evenDur = totalDur / selectedImageList.length;
      const timingSource = effectiveTimings.length
        ? effectiveTimings
        : selectedImageList.map((img, i) => ({ id: img.id, startTime: i * evenDur, endTime: (i + 1) * evenDur }));
      const usableSegments = timingSource
        .map(t => ({
          imgIdx: imgIndexById.get(t.id),
          dur: t.endTime - t.startTime,
          text: t.text || "",
          position: t.position || textOverlay.position,
        }))
        .filter(s => s.imgIdx !== undefined && s.dur > 0.02);
      // Degenerate timings (e.g. manual mode with everything zeroed) must not
      // produce concat=n=0 — fall back to one image for the whole video.
      const allSegments = usableSegments.length ? usableSegments : [{ imgIdx: 0, dur: totalDur, text: "", position: textOverlay.position }];
      // Segment map, so a slow band in the timing summary can be matched to the
      // image (and caption) that was on screen at that point in the video. Long
      // slideshows get the shape instead of every row — hundreds of lines here
      // would push the summary out of the log buffer.
      if (allSegments.length <= 40) {
        let at = 0;
        allSegments.forEach((seg, i) => {
          const from = at; at += seg.dur;
          appendVideoLog(`   seg ${i + 1}/${allSegments.length}: ${fmtClock(from)}–${fmtClock(at)} `
            + `(${seg.dur.toFixed(1)}s) img${seg.imgIdx}${seg.text ? ` · "${seg.text.slice(0, 40)}"` : ""}`);
        });
      } else {
        const durs = allSegments.map(sg => sg.dur);
        appendVideoLog(`   ${allSegments.length} segments, `
          + `${Math.min(...durs).toFixed(1)}–${Math.max(...durs).toFixed(1)}s each, `
          + `${new Set(allSegments.map(sg => sg.imgIdx)).size} distinct image(s)`);
      }
      timer.stage(`built ${allSegments.length} slideshow segment(s)`);

      // ---- Text overlays ----------------------------------------------------
      // Each distinct caption is rasterised once, at output resolution, into a
      // transparent PNG that gets composited over the finished segment. Doing it
      // in the browser (rather than with drawtext) means the preview and the
      // encode use the same renderer, and no font has to exist inside ffmpeg.
      // Keyed by text AND position: a per-track position override means the same
      // words can need two different PNGs.
      const overlayKey = (seg) => `${seg.position || textOverlay.position}\u0000${seg.text}`;
      const overlayVfsByText = new Map();
      if (textOverlay.enabled) {
        if (document.fonts?.ready) await document.fonts.ready;
        const uniq = new Map();
        for (const seg of allSegments) {
          if (!seg.text || !seg.text.trim()) continue;
          const k = overlayKey(seg);
          if (!uniq.has(k)) uniq.set(k, seg);
        }
        if (uniq.size) {
          appendVideoLog(`Rendering ${uniq.size} text overlay${uniq.size === 1 ? "" : "s"} at ${w}×${h}…`);
        }
        let i = 0;
        for (const [k, seg] of uniq) {
          const vfsName = `overlay${i++}.png`;
          const opts = { ...textOverlay, position: seg.position || textOverlay.position };
          const pngFile = await renderOverlayPngFile(seg.text, opts, w, h, vfsName);
          if (!pngFile) { appendVideoLog(`⚠ Could not rasterise overlay for "${seg.text}" — skipping it.`); continue; }
          await ffV.writeFile(vfsName, await fetchFile(pngFile));
          overlayVfsByText.set(k, vfsName);
        }
        if (uniq.size) timer.stage(`rasterised ${overlayVfsByText.size} text overlay PNG(s) at ${w}×${h}`);
      }
      // A caption with a zero-second window would only add an input and a filter
      // that hides it again, so drop it before it reaches the graph.
      const overlayFor = (seg) =>
        overlayVisibleFor(textOverlay, seg.dur) === 0 ? null : (overlayVfsByText.get(overlayKey(seg)) || null);

      const imageHasMotion = (img) => (img.motion && img.motion !== "none") || (img.useBlurBg && (img.bgMotion || "none") !== "none");
      // Mutable: if FFmpeg rejects the motion filtergraph we drop back to a
      // still slideshow and re-run, rather than failing the render outright.
      let motionEnabled = selectedImageList.some(imageHasMotion);
      // A motionless slideshow only needs a couple of frames per second; motion
      // has to be encoded at a real frame rate, which is far more expensive.
      let outFps = motionEnabled ? Math.max(2, Math.min(60, parseInt(motionFps) || 24)) : STILL_FPS;
      const anyMotion = motionEnabled;

      // zoompan over the *composed* canvas. The frame is upscaled first so the
      // crop comes out of a larger source instead of magnifying the finished
      // canvas. `d=1` makes zoompan emit one frame per input frame, so `on`
      // counts output frames within this segment.
      const motionFilter = (motion, frames, speed) => {
        if (!motion || motion === "none") return "";
        const z = MOTION_ZOOM;
        const sw = Math.round(w * z / 2) * 2, sh = Math.round(h * z / 2) * 2;
        const last = Math.max(1, frames - 1);
        // Frames per one-way sweep. At 1× that's the whole segment (so the move
        // finishes exactly as the image leaves); faster speeds sweep out and
        // back, slower ones only get partway. `p` is a 0→1→0 triangle over it.
        const sweep = Math.max(1, Math.round(last / clampMotionSpeed(speed)));
        const p = `abs(mod(on/${sweep}+1,2)-1)`;
        const cx = "iw/2-(iw/zoom/2)", cy = "ih/2-(ih/zoom/2)";
        const d = (z - 1).toFixed(5);
        let zExpr = String(z), xExpr = cx, yExpr = cy;
        if (motion === "zoom-in") zExpr = `1+${d}*${p}`;
        else if (motion === "zoom-out") zExpr = `${z}-${d}*${p}`;
        else if (motion === "pan-right") xExpr = `(iw-iw/zoom)*${p}`;
        else if (motion === "pan-left") xExpr = `(iw-iw/zoom)*(1-${p})`;
        else if (motion === "pan-down") yExpr = `(ih-ih/zoom)*${p}`;
        else if (motion === "pan-up") yExpr = `(ih-ih/zoom)*(1-${p})`;
        return `scale=w=${sw}:h=${sh},zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${w}x${h}:fps=${outFps},`;
      };

      // One image input (plus an optional text-overlay input) → one finished
      // segment of `dur` seconds.
      const buildSegmentChain = (img, inputIdx, dur, tag, overlayInputIdx = null) => {
        const bgHex = (img.paddingColor || videoBgColor).replace("#", "0x");
        const motion = motionEnabled ? (img.motion || "none") : "none";
        const bgMotion = (motionEnabled && img.useBlurBg) ? (img.bgMotion || "none") : "none";
        const frames = Math.max(2, Math.round(dur * outFps));
        // Image inputs are read at STILL_FPS; upsample here (cheap frame
        // duplication) rather than re-decoding the PNG at the output rate.
        const src = `[${inputIdx}:v]${outFps !== STILL_FPS ? `fps=${outFps},` : ""}`;
        let chain = "";
        if (img.useBlurBg) {
          // Box-blurring a full-res frame is fine at 2fps but crushing at 24+.
          // For motion renders, blur at ~480p and scale back up — through a
          // blur this heavy the difference isn't visible. Both paths take their
          // radius from the same percentage, so the two look alike.
          const blurPct = clampBgBlur(img.bgBlur);
          const blurTo = (tw, th) => outFps === STILL_FPS
            ? `scale=w=${tw}:h=${th}:force_original_aspect_ratio=increase${bgBlurFilter(tw, blurPct)}`
            : `scale=w=480:h=270:force_original_aspect_ratio=increase${bgBlurFilter(480, blurPct)},scale=w=${tw}:h=${th}:force_original_aspect_ratio=increase`;
          if (bgMotion === "drift") {
            // Oversized so there is room to drift, then a slowly circling crop.
            const bw = Math.round(w * BG_DRIFT_ZOOM), bh = Math.round(h * BG_DRIFT_ZOOM);
            // Travel is capped in pixels (not as a share of the slack) so the
            // drift stays equally gentle whatever the source image's aspect is.
            const ax = Math.round(w * BG_DRIFT_AMOUNT), ay = Math.round(h * BG_DRIFT_AMOUNT);
            // Background speed is its own knob — it scales the drift period and
            // is unaffected by the foreground's speed (and vice versa).
            const p = (BG_DRIFT_PERIOD / clampMotionSpeed(img.bgMotionSpeed)).toFixed(2);
            // crop has no `eval` option — its x/y expressions are already
            // re-evaluated for every frame, and `t` is available there.
            chain += `${src}${blurTo(bw, bh)},`
              + `crop=w=${w}:h=${h}:x='(iw-ow)/2+min((iw-ow)/2,${ax})*sin(2*PI*t/${p})':y='(ih-oh)/2+min((ih-oh)/2,${ay})*cos(2*PI*t/${p})',setsar=1[bg${tag}];`;
          } else {
            chain += `${src}${blurTo(w, h)},crop=${w}:${h}:(iw-${w})/2:(ih-${h})/2,setsar=1[bg${tag}];`;
          }
          chain += `${src}scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease,setsar=1[fg${tag}];`;
          chain += `[bg${tag}][fg${tag}]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1[c${tag}];`;
        } else {
          const scale = img.stretchToFit ? `scale=w=${w}:h=${h}` : `scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease`;
          const pad = img.stretchToFit ? "" : `,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${bgHex}`;
          chain += `${src}${scale}${pad},setsar=1[c${tag}];`;
        }
        // format is pinned so every segment reaches concat with identical props.
        // The caption is composited *after* motion so zoom/pan never drags the
        // text around or softens it.
        if (overlayInputIdx != null) {
          // `t` inside a segment chain is segment-local (each image input is its
          // own `-loop 1 -t D`), so gating on it hides the caption after N
          // seconds of *this* image rather than N seconds into the whole video.
          // The overlay input still spans the full segment so shortest=1 can't
          // truncate it.
          const visible = overlayVisibleFor(textOverlay, dur);
          const gate = visible == null ? "" : `:enable='lt(t,${visible.toFixed(3)})'`;
          chain += `[c${tag}]${motionFilter(motion, frames, img.motionSpeed)}format=yuv420p,setsar=1[m${tag}];`;
          chain += `[${overlayInputIdx}:v]${outFps !== STILL_FPS ? `fps=${outFps},` : ""}scale=w=${w}:h=${h},format=yuva420p,setsar=1[o${tag}];`;
          chain += `[m${tag}][o${tag}]overlay=0:0:shortest=1${gate},format=yuv420p,setsar=1[v${tag}];`;
        } else {
          chain += `[c${tag}]${motionFilter(motion, frames, img.motionSpeed)}format=yuv420p,setsar=1[v${tag}];`;
        }
        return chain;
      };

      // `-loop 1 … -t D` gives each segment exactly D seconds of its image (and
      // of its caption, when there is one).
      const buildVideoInputArgs = (segments) =>
        segments.flatMap(seg => {
          const args = ["-loop", "1", "-framerate", String(STILL_FPS), "-t", seg.dur.toFixed(3), "-i", imgVfsNames[seg.imgIdx]];
          const ov = overlayFor(seg);
          if (ov) args.push("-loop", "1", "-framerate", String(STILL_FPS), "-t", seg.dur.toFixed(3), "-i", ov);
          return args;
        });

      // Overlay inputs are interleaved with the image inputs, so indices have to
      // be walked rather than computed as `inputOffset + j`.
      const buildVideoFilter = (segments, inputOffset) => {
        let nextInput = inputOffset;
        return segments.map((seg, j) => {
          const imgInput = nextInput++;
          const ovInput = overlayFor(seg) ? nextInput++ : null;
          return buildSegmentChain(selectedImageList[seg.imgIdx], imgInput, seg.dur, j, ovInput);
        }).join("")
        + segments.map((_, j) => `[v${j}]`).join("")
        + `concat=n=${segments.length}:v=1:a=0,pad=ceil(iw/2)*2:ceil(ih/2)*2[v]`;
      };

      // Audio: per-input atrim when a clip range is set, then concat.
      const buildAudioFilter = (offset) => {
        const anyClipped = selectedAudioList.some(t => t.isClipped);
        if (n === 1) {
          const t = selectedAudioList[0];
          return t.isClipped
            ? `[${offset}:a]atrim=start=${t.clipStart.toFixed(3)}:end=${t.clipEnd.toFixed(3)},asetpts=PTS-STARTPTS[a]`
            : `[${offset}:a]acopy[a]`;
        }
        if (!anyClipped) {
          return selectedAudioList.map((_, i) => `[${offset + i}:a]`).join("") + `concat=n=${n}:v=0:a=1[a]`;
        }
        return selectedAudioList.map((t, i) => t.isClipped
          ? `[${offset + i}:a]atrim=start=${t.clipStart.toFixed(3)}:end=${t.clipEnd.toFixed(3)},asetpts=PTS-STARTPTS[a${i}];`
          : `[${offset + i}:a]anull[a${i}];`).join("")
          + selectedAudioList.map((_, i) => `[a${i}]`).join("") + `concat=n=${n}:v=0:a=1[a]`;
      };

      // At 1440p+, drop -tune stillimage and use -preset veryfast so x264's lookahead/ref/bframes buffers don't blow the wasm heap.
      const isHighRes = (w * h) >= (2560 * 1440);
      const x264Args = () => (isHighRes || motionEnabled)
        ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
        : ["-c:v", "libx264", "-tune", "stillimage", "-crf", "18"];

      // Runs one FFmpeg pass. If the build rejects the filtergraph (an unknown
      // filter or option — which fails during graph init, before any encoding),
      // fall back to a plain still slideshow and run it again so the user still
      // gets their video.
      // Shape of the work being handed to ffmpeg. A filtergraph that grows with
      // the number of segments is a prime suspect for a render that degrades as
      // it goes, so the numbers go in the log next to the timing.
      const passShape = (args) => {
        const inputs = args.filter(a => a === "-i").length;
        const fi = args.indexOf("-filter_complex");
        const filterLen = fi >= 0 ? (args[fi + 1] || "").length : 0;
        return `${inputs} input(s), ${filterLen ? `${filterLen}-char filtergraph` : "no filtergraph"}`;
      };

      const runPass = async (buildArgs, what) => {
        graphState.error = "";
        let args = buildArgs();
        timer.beginPass(what, prog.dur, passShape(args));
        let code = await ffV.exec(args);
        timer.endPass();
        const failed = typeof code === "number" && code !== 0;
        if (failed && graphState.error && motionEnabled) {
          appendVideoLog(`⚠ This FFmpeg build rejected the motion filters — ${graphState.error}`);
          appendVideoLog(`Retrying ${what} without motion effects…`);
          appendVideoLog("Motion effects aren't supported by this FFmpeg build — rendering without them.");
          motionEnabled = false;
          outFps = STILL_FPS;
          graphState.error = "";
          oomState.detected = false; oomState.encodeCompleted = false; oomState.lastSignal = "";
          args = buildArgs();
          timer.beginPass(`${what} (retry without motion)`, prog.dur, passShape(args));
          code = await ffV.exec(args);
          timer.endPass();
        }
        return code;
      };

      // In loop mode the slideshow is one repeating cycle, which would mean
      // hundreds of segments in a single filtergraph on a full-length album.
      // Instead encode one cycle and let ffmpeg loop that clip while muxing.
      const cycleInterval = Math.max(1, loopInterval);
      const cycleDur = cycleInterval * selectedImageList.length;
      // A per-track caption changes on a schedule the image cycle knows nothing
      // about, so the encode-one-cycle shortcut can't represent it — fall back
      // to the single-pass path whenever the text varies over time.
      const useCycleLoop = slideshowMode === "loop" && cycleDur < totalDur - 0.05 && !overlayTextVaries;

      let exitCode;
      if (useCycleLoop) {
        // Constant custom caption: it belongs on every segment of the cycle.
        const cycleText = textOverlay.enabled ? (textOverlay.customText || "") : "";
        const cycleSegments = selectedImageList.map((_, i) => ({ imgIdx: i, dur: cycleInterval, text: cycleText }));
        appendVideoLog(`Running FFmpeg (${w}×${h}, ${Math.ceil(totalDur)}s${isHighRes ? ", high-res preset" : ""}${anyMotion ? `, ${outFps}fps motion` : ""})…`);
        appendVideoLog(`Pass 1/2: building a ${Math.round(cycleDur)}s loop of ${cycleSegments.length} image(s) at ${cycleInterval}s each…`);
        prog.dur = cycleDur; prog.base = 0; prog.span = 0.85;
        const cycleExit = await runPass(() => [
          "-y",
          ...buildVideoInputArgs(cycleSegments),
          "-filter_complex", buildVideoFilter(cycleSegments, 0),
          "-map", "[v]",
          ...x264Args(),
          "-pix_fmt", "yuv420p",
          "-r", String(outFps),
          "-g", String(Math.max(1, Math.round(outFps * 2))),
          "cycle.mp4"
        ], "the image loop");
        if (typeof cycleExit === "number" && cycleExit !== 0) {
          throw new Error(graphState.error
            ? `FFmpeg rejected the video filters while building the image loop: ${graphState.error}`
            : `FFmpeg exited with code ${cycleExit} while building the image loop. See logs above.`);
        }
        if (oomState.detected && !oomState.encodeCompleted) {
          const err = new Error("__OOM__");
          err.oom = true; err.signal = oomState.lastSignal; err.dimensions = { w, h };
          throw err;
        }
        // Fresh OOM state for pass 2 — pass 1's Lsize= must not mask a failure here.
        oomState.detected = false; oomState.encodeCompleted = false; oomState.lastSignal = "";
        appendVideoLog(`Pass 2/2: repeating the loop across ${Math.ceil(totalDur)}s of audio…`);
        prog.dur = totalDur; prog.base = 0.85; prog.span = 0.15;
        exitCode = await runPass(() => [
          "-y",
          "-stream_loop", "-1", "-i", "cycle.mp4",
          ...audioVfsNames.flatMap(v => ["-i", v]),
          "-filter_complex", buildAudioFilter(1),
          "-map", "0:v", "-map", "[a]",
          "-c:v", "copy",
          "-c:a", "aac", "-b:a", "320k",
          "-movflags", "+faststart",
          "-t", totalDur.toFixed(3),
          `${name}.mp4`
        ], "the audio mux");
        // Stream-copying a looped input is the fast path but not universally
        // supported; re-encode rather than lose the render. Pointless if we ran
        // out of memory, so skip it in that case.
        if (typeof exitCode === "number" && exitCode !== 0 && !oomState.detected) {
          appendVideoLog("⚠ Stream-copy mux failed — retrying with the video re-encoded…");
          graphState.error = "";
          oomState.encodeCompleted = false; oomState.lastSignal = "";
          prog.dur = totalDur; prog.base = 0.85; prog.span = 0.15;
          exitCode = await runPass(() => [
            "-y",
            "-stream_loop", "-1", "-i", "cycle.mp4",
            ...audioVfsNames.flatMap(v => ["-i", v]),
            "-filter_complex", buildAudioFilter(1),
            "-map", "0:v", "-map", "[a]",
            ...x264Args(),
            "-c:a", "aac", "-b:a", "320k",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            "-t", totalDur.toFixed(3),
            `${name}.mp4`
          ], "the audio mux");
        }
        try { await ffV.deleteFile("cycle.mp4"); } catch {}
      } else {
        appendVideoLog(`Running FFmpeg (${w}×${h}, ${Math.ceil(totalDur)}s, ${allSegments.length} image segment(s)${isHighRes ? ", high-res preset" : ""}${anyMotion ? `, ${outFps}fps motion` : ""})…`);
        exitCode = await runPass(() => [
          "-y",
          ...audioVfsNames.flatMap(v => ["-i", v]),
          ...buildVideoInputArgs(allSegments),
          "-filter_complex", `${buildAudioFilter(0)};${buildVideoFilter(allSegments, n)}`,
          "-map", "[v]", "-map", "[a]",
          ...x264Args(),
          "-c:a", "aac", "-b:a", "320k",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart",
          "-r", String(outFps),
          "-t", totalDur.toFixed(3),
          `${name}.mp4`
        ], "the video");
      }

      // A rejected filtergraph also trips the soft-OOM heuristic (it aborts
      // before Lsize=), so report it as what it actually is.
      if (graphState.error) {
        throw new Error(`FFmpeg rejected the video filters: ${graphState.error}`);
      }

      // If a hard OOM was detected before encoding finished, bail out early.
      if (oomState.detected && !oomState.encodeCompleted) {
        const err = new Error("__OOM__");
        err.oom = true;
        err.signal = oomState.lastSignal;
        err.dimensions = { w, h };
        throw err;
      }

      // Try to read the output file. If encoding finished (Lsize= seen), trust it even if a
      // late Aborted() fired during ffmpeg's shutdown. If the read fails or the file is empty,
      // surface an OOM/render error.
      let data;
      try {
        data = await ffV.readFile(`${name}.mp4`);
      } catch (readErr) {
        if (oomState.detected || oomState.encodeCompleted) {
          const err = new Error("__OOM__");
          err.oom = true;
          err.signal = oomState.lastSignal || readErr?.message || "Could not read output file";
          err.dimensions = { w, h };
          throw err;
        }
        throw readErr;
      }
      if (!data || !data.byteLength) {
        const err = new Error("__OOM__");
        err.oom = true;
        err.signal = oomState.lastSignal || "Output file was empty";
        err.dimensions = { w, h };
        throw err;
      }
      if (typeof exitCode === "number" && exitCode !== 0 && !oomState.encodeCompleted) {
        throw new Error(`FFmpeg exited with code ${exitCode}. See logs above.`);
      }
      timer.stage(`read ${(data.byteLength / 1048576).toFixed(1)} MB of output out of the ffmpeg VFS`);
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      appendVideoLog("✓ Done!");

      // Pre-computed here so a render that finishes while another project is
      // open can still fill in its own YouTube metadata later. The title is
      // deliberately left out — it's bound to videoOutputName by a dedicated
      // effect, so a pick in the Output-name picker drives the YT title too.
      const { discogsData: dd, ytTitleVariation: ytv, ytTimestampFormat: ytf,
              ytTimestampSeparator: yts, ytIncludeTrackNums: ytn, ytDescSuffix: ytd } = spec.ytMeta;
      const trackTimestamps = selectedAudioList.map((t, i) => ({
        title: t.title,
        startOffset: i === 0 ? 0 : selectedAudioList.slice(0, i).reduce((s, x) => s + (x.end - x.start), 0),
      }));
      const autoDesc = buildTimestampDescription(trackTimestamps, {
        timestampFormat: ytf, separator: yts, includeTrackNumbers: ytn, suffix: ytd,
      });
      const defaultFilters = { artists: { enabled: true, sliderValue: 100 }, album: { enabled: true, sliderValue: 100 }, tracklist: { enabled: true, sliderValue: 100 }, combinations: { enabled: true, sliderValue: 100 }, credits: { enabled: false, sliderValue: 100 }, filenames: { enabled: false, sliderValue: 100 } };
      const autoTags = buildTagString(extractTagsFromDiscogs(dd), defaultFilters);

      return {
        blob,
        size: blob.size,
        fileName: `${name}.mp4`,
        titleSuggestions: generateVideoTitleRecommendations(dd, ytv),
        description: autoDesc.slice(0, YT_LIMITS.description),
        tags: autoTags,
      };
    } finally {
      // Runs on the failure paths too — a render that OOMs halfway is exactly
      // the one whose timing you want to read.
      timer.summary();
    }
  };

  // ---- Projects: snapshot / hydrate / switch --------------------------------

  const newProjectId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  // Stable per-asset id, so an autosave can tell "same file, still there"
  // from "different file re-exported into the same slot".
  const newAssetUid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  const refreshProjects = useCallback(async () => {
    try { setProjects(await storeListProjects()); } catch {}
    try { setStorageInfo(await estimateStorage()); } catch {}
  }, []);

  // Everything that isn't a Blob. Mirrors buildProgressPayload but covers the
  // whole route, since a project has to come back exactly as it was left.
  const collectSettings = () => ({
    step, audioMode, projectName, discogsUrl, discogsData, discogsInputMode,
    trackNames, manualTrackCount, tracks, duration,
    outputFormat, filenameFormat, volumeDb, riaaEnabled,
    silThresholdDb, silMinDur, silWindowMs, silMinTrackLen,
    selectedTracks: [...selectedTracks],
    videoWidth, videoHeight, videoBgColor, imageMaxDim,
    slideshowMode, loopInterval, motionFps, manualImageTimings,
    textOverlay, trackImageAssign,
    videoAudioOrder, trackClips,
    selectedVideoAudios: [...selectedVideoAudios],
    selectedVideoImages: [...selectedVideoImages],
    videoOutputName, ytUploadData, ytTitleVariation, ytTimestampFormat,
    ytTimestampSeparator, ytIncludeTrackNums, ytDescSuffix, ytTitleSuggestions,
    autoUploadYt, autoMatchImageRes, renderScale, batchSettings, trackTextOverrides,
  });

  // saveActiveProject is memoized on the blob-bearing state only, so the
  // collectSettings it closed over went stale for everything else — clip
  // ranges, ordering and captions were written as they had been at the last
  // re-memo, not as they are now. Refreshed every render, read at save time.
  const collectSettingsRef = useRef(collectSettings);
  collectSettingsRef.current = collectSettings;

  const applySettings = (s) => {
    if (!s) return;
    if (s.step) setStep(s.step);
    if (s.audioMode) setAudioMode(s.audioMode);
    setProjectName(s.projectName || "My Album");
    setDiscogsUrl(s.discogsUrl || "");
    setDiscogsData(s.discogsData || null);
    discogsArtReleaseRef.current = s.discogsData?.id ?? null;
    if (s.discogsInputMode) setDiscogsInputMode(s.discogsInputMode);
    setTrackNames(s.trackNames || []);
    setManualTrackCount(s.manualTrackCount || "");
    setTracks(s.tracks || []);
    if (s.duration != null) setDuration(s.duration);
    if (s.outputFormat) setOutputFormat(s.outputFormat);
    if (s.filenameFormat) setFilenameFormat(s.filenameFormat);
    if (s.volumeDb != null) setVolumeDb(s.volumeDb);
    if (s.riaaEnabled != null) setRiaaEnabled(s.riaaEnabled);
    if (s.silThresholdDb != null) setSilThresholdDb(s.silThresholdDb);
    if (s.silMinDur != null) setSilMinDur(s.silMinDur);
    if (s.silWindowMs != null) setSilWindowMs(s.silWindowMs);
    if (s.silMinTrackLen != null) setSilMinTrackLen(s.silMinTrackLen);
    setSelectedTracks(new Set(s.selectedTracks || []));
    if (s.videoWidth) setVideoWidth(s.videoWidth);
    if (s.videoHeight) setVideoHeight(s.videoHeight);
    if (s.videoBgColor) setVideoBgColor(s.videoBgColor);
    if (s.imageMaxDim !== undefined) setImageMaxDim(s.imageMaxDim);
    if (s.slideshowMode) setSlideshowMode(s.slideshowMode);
    if (s.loopInterval != null) setLoopInterval(s.loopInterval);
    if (s.motionFps != null) setMotionFps(s.motionFps);
    setManualImageTimings(s.manualImageTimings || {});
    setTextOverlay({ ...DEFAULT_TEXT_OVERLAY, ...(s.textOverlay || {}) });
    setTrackImageAssign(s.trackImageAssign || {});
    setVideoAudioOrder(s.videoAudioOrder || []);
    setTrackClips(s.trackClips || {});
    setSelectedVideoAudios(new Set(s.selectedVideoAudios || []));
    setSelectedVideoImages(new Set(s.selectedVideoImages || []));
    setVideoOutputName(s.videoOutputName || "");
    setYtUploadData(s.ytUploadData || { title: "", description: "", privacyStatus: "private", tags: "" });
    if (s.ytTitleVariation != null) setYtTitleVariation(s.ytTitleVariation);
    if (s.ytTimestampFormat) setYtTimestampFormat(s.ytTimestampFormat);
    if (s.ytTimestampSeparator != null) setYtTimestampSeparator(s.ytTimestampSeparator);
    if (s.ytIncludeTrackNums != null) setYtIncludeTrackNums(s.ytIncludeTrackNums);
    if (s.ytDescSuffix != null) setYtDescSuffix(s.ytDescSuffix);
    setYtTitleSuggestions(s.ytTitleSuggestions || []);
    if (s.autoUploadYt != null) setAutoUploadYt(s.autoUploadYt);
    if (s.autoMatchImageRes != null) setAutoMatchImageRes(s.autoMatchImageRes);
    if (s.batchSettings) {
      // Projects saved before the two render modes shared their settings kept
      // scale/resolution/text on batchSettings; carry the scale over and drop
      // the rest, which now come from the shared controls.
      const { scale, resolution, textMode, customText, ...batchOnly } = s.batchSettings;
      setBatchSettings(prev => ({ ...prev, ...batchOnly }));
      if (s.renderScale == null && scale != null) setRenderScale(scale);
    }
    if (s.renderScale != null) setRenderScale(s.renderScale);
    setTrackTextOverrides(s.trackTextOverrides || {});
  };

  // Writes the current project's blobs + record. Blobs are only rewritten when
  // their identity changed, so an autosave on a settings tweak doesn't re-copy
  // a gigabyte of audio.
  const saveActiveProject = useCallback(async ({ silent = true, overrides = {} } = {}) => {
    const id = activeProjectIdRef.current;
    if (!id) return null;
    if (!silent) setProjectBusy("saving");
    // Callers that save immediately after a setState pass the new value here,
    // since the state itself hasn't committed yet. `settings` is shallow-merged
    // over the collected snapshot for the same reason.
    const droppedAudioFiles_ = overrides.droppedAudioFiles ?? droppedAudioFiles;
    const exportedTracks_ = overrides.exportedTracks ?? exportedTracks;
    const videoImages_ = overrides.videoImages ?? videoImages;
    const settingsOverrides = overrides.settings || null;
    try {
      const prev = (await storeGetProject(id)) || {};
      const prevKeys = new Set([
        ...(prev.audioFiles || []).map(a => a.key),
        ...(prev.exportedTracks || []).map(t => t.key),
        ...(prev.images || []).map(i => i.key),
      ].filter(Boolean));
      const liveKeys = new Set();
      const bytes = { audio: 0, tracks: 0, images: 0, video: 0 };

      // Autosave runs on a 2.5s debounce, so re-writing every blob each time
      // would push hundreds of megabytes through IndexedDB on a settings tweak.
      // A slot is only rewritten when the file occupying it actually changed.
      // Identity has to be exact: a re-export can produce the same filename AND
      // the same byte count (PCM size is fixed by duration) yet different audio,
      // so tracks and images are matched on a stable uid rather than on name.
      const prevBySlot = new Map();
      for (const a of prev.audioFiles || []) if (a.key) prevBySlot.set(a.key, a);
      for (const t of prev.exportedTracks || []) if (t.key) prevBySlot.set(t.key, t);
      for (const i of prev.images || []) if (i.key) prevBySlot.set(i.key, i);
      const sameFile = (key, f) => {
        const p = prevBySlot.get(key);
        return !!p && p.name === f.name && p.size === f.size && p.lastModified === f.lastModified;
      };
      const sameUid = (key, uid) => {
        const p = prevBySlot.get(key);
        return !!p && !!uid && p.uid === uid;
      };

      const audioFiles = [];
      for (let i = 0; i < droppedAudioFiles_.length; i++) {
        const f = droppedAudioFiles_[i];
        const key = blobKey(id, "audio", i);
        liveKeys.add(key);
        if (!sameFile(key, f)) await putBlob(key, f);
        bytes.audio += f.size || 0;
        audioFiles.push({ key, name: f.name, size: f.size, type: f.type, lastModified: f.lastModified });
      }

      const exported = [];
      for (let i = 0; i < exportedTracks_.length; i++) {
        const t = exportedTracks_[i];
        const key = blobKey(id, "track", i);
        liveKeys.add(key);
        if (sameUid(key, t.uid)) {
          bytes.tracks += t.size || 0;
          exported.push({ key, uid: t.uid, copyOf: t.copyOf, name: t.name, title: t.title, index: t.index, size: t.size, start: t.start, end: t.end });
          continue;
        }
        const blob = t.file ? t.file : await (await fetch(t.url)).blob();
        await putBlob(key, blob);
        bytes.tracks += blob.size || 0;
        exported.push({ key, uid: t.uid, copyOf: t.copyOf, name: t.name, title: t.title, index: t.index, size: blob.size, start: t.start, end: t.end });
      }

      const images = [];
      for (let i = 0; i < videoImages_.length; i++) {
        const im = videoImages_[i];
        if (!im.file) continue;
        const key = blobKey(id, "image", i);
        liveKeys.add(key);
        if (!sameUid(key, im.id)) await putBlob(key, im.file);
        bytes.images += im.file.size || 0;
        images.push({
          key, uid: im.id, id: im.id, name: im.file.name, size: im.file.size, type: im.file.type,
          source: im.source ?? null, releaseId: im.releaseId ?? null,
          naturalWidth: im.naturalWidth, naturalHeight: im.naturalHeight,
          stretchToFit: im.stretchToFit, useBlurBg: im.useBlurBg, bgBlur: im.bgBlur, paddingColor: im.paddingColor,
          motion: im.motion, motionSpeed: im.motionSpeed, bgMotion: im.bgMotion, bgMotionSpeed: im.bgMotionSpeed,
        });
      }

      // Blobs from a previous save whose slot no longer exists (image deleted,
      // fewer tracks re-exported) would otherwise leak until the project is.
      for (const stale of prevKeys) if (!liveKeys.has(stale)) { try { await deleteBlob(stale); } catch {} }

      // Rendered output is owned by the render queue's onSettled, not by this
      // save — carry whatever is already on the record through untouched.
      const video = prev.video || null;
      if (video) bytes.video = video.size || 0;
      const batchVideos = prev.batchVideos || [];
      bytes.batch = batchVideos.reduce((sum, v) => sum + (v.size || 0), 0);

      const record = {
        id,
        name: projectName || "Untitled project",
        createdAt: prev.createdAt || Date.now(),
        updatedAt: Date.now(),
        settings: settingsOverrides ? { ...collectSettingsRef.current(), ...settingsOverrides } : collectSettingsRef.current(),
        audioFiles,
        activeAudioName: audioFile?.name || null,
        exportedTracks: exported,
        images,
        video,
        batchVideos,
        bytes: { ...bytes, total: bytes.audio + bytes.tracks + bytes.images + bytes.video + bytes.batch },
        trackCount: tracks.length,
      };
      await storePutProject(record);
      saveFailuresRef.current = 0;
      renderQueue.rename(id, record.name);
      await refreshProjects();
      return record;
    } catch (e) {
      if (isQuotaError(e)) {
        // Say what filled up and by how much, not just that something failed.
        let where = "";
        try {
          const est = await navigator.storage?.estimate?.();
          if (est?.quota) where = ` (using ${formatBytes(est.usage)} of ${formatBytes(est.quota)})`;
        } catch {}
        setMessage(`Out of browser storage${where} — this project could not be saved. `
          + "Delete an old project from the Projects panel, or free disk space. "
          + "Your work is still here in the page; don't reload until it saves.");
      } else {
        setMessage(`Could not save project: ${e?.message || e}`);
      }
      saveFailuresRef.current += 1;
      rlog("saveActiveProject: FAILED", {
        attempt: saveFailuresRef.current, quota: isQuotaError(e), error: e?.message || String(e),
      });
      if (saveFailuresRef.current >= SAVE_FAILURE_LIMIT && !isQuotaError(e)) {
        // "Internal error." from IndexedDB is what a browser says when its
        // storage backend is broken — usually no disk space, sometimes a
        // corrupted profile database.
        setMessage(`Saving is switched off after ${SAVE_FAILURE_LIMIT} failed attempts `
          + `(“${e?.message || e}”). Your work is still in the page and exports still run — `
          + "but nothing is being written to browser storage. Free disk space and reload to retry.");
      }
      return null;
    } finally {
      if (!silent) setProjectBusy("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedAudioFiles, exportedTracks, videoImages, projectName, audioFile, tracks, batchVideos, refreshProjects]);

  // Rebuilds live state (Files, object URLs, decoded waveform) from a record.
  const hydrateProject = async (rec) => {
    hydratingRef.current = true;
    setProjectBusy("loading");
    try {
      // Release the outgoing project's URLs first — but never the rendered
      // video of a project whose job is still running.
      exportedTracks.forEach(t => { try { URL.revokeObjectURL(t.url); } catch {} });
      videoImages.forEach(im => {
        if (im.thumbUrl) URL.revokeObjectURL(im.thumbUrl);
        if (im.previewUrl) URL.revokeObjectURL(im.previewUrl);
      });
      if (renderedVideoSrc) { try { URL.revokeObjectURL(renderedVideoSrc); } catch {} }
      setRenderedVideoSrc(null);
      batchVideos.forEach(v => { try { URL.revokeObjectURL(v.url); } catch {} });
      setBatchVideos([]);
      setChannelData(null);
      setExportedTracks([]);
      setVideoImages([]);
      setDroppedAudioFiles([]);
      setAudioFile(null);
      setPendingAudioFiles([]);
      setAudioDurationMap({});
      setSilenceRegions([]);
      setVolumeSuggestion(null);
      if (peaksRef.current) { try { peaksRef.current.destroy(); } catch {} peaksRef.current = null; }

      applySettings(rec.settings);

      const audios = [];
      for (const a of rec.audioFiles || []) {
        if (!a.key) continue;
        const f = await getFile(a.key, a.name, a.type);
        if (f) audios.push(f);
      }
      setDroppedAudioFiles(audios);
      // Setting audioFile kicks off the decode effect, which rebuilds the
      // waveform and peaks view for the restored split points.
      const active = audios.find(f => f.name === rec.activeAudioName) || audios[0] || null;
      setAudioFile(active || null);

      const tracksOut = [];
      for (const t of rec.exportedTracks || []) {
        const blob = await getBlob(t.key);
        if (!blob) continue;
        const file = new File([blob], t.name, { type: blob.type || "audio/flac" });
        const url = URL.createObjectURL(blob);
        // Tracks imported before the header probe existed were stored as 0
        // seconds long whenever the decode-to-measure step ran out of memory.
        // Re-read the header so an already-saved long rip repairs itself.
        let { start, end } = t;
        if (!(end - start > 0)) {
          const probed = await probeAudioDuration(url);
          if (probed > 0) { start = 0; end = probed; }
        }
        tracksOut.push({ uid: t.uid || newAssetUid(), copyOf: t.copyOf, index: t.index, name: t.name, title: t.title, size: blob.size, start, end, url, file });
      }
      setExportedTracks(tracksOut);

      const imgsOut = [];
      for (const im of rec.images || []) {
        const f = await getFile(im.key, im.name, im.type);
        if (!f) continue;
        const thumb = await createThumbnail(f, 160).catch(() => null);
        imgsOut.push({
          id: im.id, file: f,
          thumbUrl: thumb?.thumbUrl || URL.createObjectURL(f),
          previewUrl: thumb?.previewUrl || URL.createObjectURL(f),
          loading: false,
          naturalWidth: im.naturalWidth ?? thumb?.width, naturalHeight: im.naturalHeight ?? thumb?.height,
          width: im.naturalWidth ?? thumb?.width, height: im.naturalHeight ?? thumb?.height,
          source: im.source ?? null, releaseId: im.releaseId ?? null,
          stretchToFit: im.stretchToFit, useBlurBg: im.useBlurBg, bgBlur: im.bgBlur, paddingColor: im.paddingColor,
          motion: im.motion, motionSpeed: im.motionSpeed, bgMotion: im.bgMotion, bgMotionSpeed: im.bgMotionSpeed,
        });
      }
      setVideoImages(imgsOut);

      if (rec.video?.key) {
        const blob = await getBlob(rec.video.key);
        if (blob && blob.size > 0) setRenderedVideoSrc(URL.createObjectURL(blob));
      }

      const batch = [];
      for (const v of rec.batchVideos || []) {
        const blob = await getBlob(v.key);
        if (!blob || !blob.size) continue;
        batch.push({ ...v, url: URL.createObjectURL(blob) });
      }
      setBatchVideos(batch);
      setMessage(`Opened "${rec.name}"`);
    } catch (e) {
      setMessage(`Could not open project: ${e?.message || e}`);
    } finally {
      setProjectBusy("");
      // Let the state writes above commit before autosave is re-armed.
      setTimeout(() => { hydratingRef.current = false; }, 0);
    }
  };

  // A render needs a stable job key, not a project record. Returns the current
  // id, or mints one and persists it in the background — the write is allowed
  // to fail, because the work it gates does not depend on it. Synchronous on
  // purpose: the button must not wait on IndexedDB.
  const ensureActiveProjectId = () => {
    if (activeProjectIdRef.current) return activeProjectIdRef.current;
    const id = newProjectId();
    activeProjectIdRef.current = id;
    setActiveProjectId(id);
    try { localStorage.setItem(ACTIVE_PROJECT_KEY, id); } catch {}
    storePutProject({
      id, name: projectName || "My Album", createdAt: Date.now(), updatedAt: Date.now(),
      settings: null, audioFiles: [], exportedTracks: [], images: [], video: null,
      bytes: { audio: 0, tracks: 0, images: 0, video: 0, total: 0 }, trackCount: 0,
    }).then(() => refreshProjects()).catch((e) => {
      rlog("ensureActiveProjectId: could not persist the project record", e?.message || String(e));
      setMessage("Storage is unavailable, so this project can't be saved — the render will still run. "
        + "Free up disk space to restore saving.");
    });
    rlog("ensureActiveProjectId: created a project id on the fly", id);
    return id;
  };

  const openProject = async (id) => {
    if (id === activeProjectIdRef.current) { setShowHistory(false); return; }
    await saveActiveProject();
    const rec = await storeGetProject(id);
    if (!rec) { setMessage("That project is no longer stored."); await refreshProjects(); return; }
    setActiveProjectId(id);
    activeProjectIdRef.current = id;
    try { localStorage.setItem(ACTIVE_PROJECT_KEY, id); } catch {}
    await hydrateProject(rec);
    setShowHistory(false);
  };

  const startNewProject = async () => {
    await saveActiveProject();
    const id = newProjectId();
    hydratingRef.current = true;
    resetProjectState();
    const savedDefaults = loadSavedTextDefaults();
    if (savedDefaults) setTextOverlay(savedDefaults);
    setProjectName("New project");
    setActiveProjectId(id);
    activeProjectIdRef.current = id;
    try { localStorage.setItem(ACTIVE_PROJECT_KEY, id); } catch {}
    await storePutProject({
      id, name: "New project", createdAt: Date.now(), updatedAt: Date.now(),
      settings: null, audioFiles: [], exportedTracks: [], images: [], video: null,
      bytes: { audio: 0, tracks: 0, images: 0, video: 0, total: 0 }, trackCount: 0,
    });
    await refreshProjects();
    setShowHistory(false);
    setMessage("Started a new project.");
    setTimeout(() => { hydratingRef.current = false; }, 0);
  };

  const deleteProjectById = async (id) => {
    const job = renderQueue.getJob(id);
    if (job && (job.status === "running" || job.status === "queued")) {
      if (!window.confirm("That project has a render in progress. Delete it and cancel the render?")) return;
      renderQueue.cancel(id);
    } else if (!window.confirm("Delete this project and all of its stored files?")) return;
    const wasActive = id === activeProjectIdRef.current;
    // Drop the active pointer *before* opening a replacement: openProject and
    // startNewProject both save the outgoing project first, which would write
    // the record we just deleted straight back into the store.
    if (wasActive) { activeProjectIdRef.current = null; setActiveProjectId(null); }
    renderQueue.purgeProject(id);
    await storeDeleteProject(id);
    await refreshProjects();
    if (wasActive) {
      const remaining = await storeListProjects();
      if (remaining.length) await openProject(remaining[0].id);
      else await startNewProject();
    }
  };

  const freeUpProject = async (id) => {
    if (!window.confirm("Remove the source audio and rendered video for this project? Settings, splits and images are kept, so it can be re-rendered.")) return;
    await trimProjectAssets(id);
    if (id === activeProjectIdRef.current) {
      if (renderedVideoSrc) { try { URL.revokeObjectURL(renderedVideoSrc); } catch {} }
      setRenderedVideoSrc(null);
    }
    await refreshProjects();
  };

  // ---- Render queue wiring --------------------------------------------------

  useEffect(() => renderQueue.subscribe(setRenderJobs), []);

  // The open project's single "Render Video" job keys on the project id; its
  // batch jobs key on `${projectId}:batch:n` and are surfaced separately.
  // What the render will actually get, as opposed to what is ticked. These are
  // the numbers the buttons and the warning banner use, so the UI cannot offer
  // a render the spec builder will refuse.
  const renderableAudios = getOrderedAudios().length;
  const renderableImages = videoImages.filter(img => selectedVideoImages.has(img.id)).length;

  const activeRenderJob = renderJobs.find(j => j.jobId === activeProjectId) || null;
  const queueActive = renderJobs.filter(j => j.status === "running" || j.status === "queued");
  const activeBatchJobs = renderJobs.filter(j => j.batch && j.projectId === activeProjectId);
  const batchInFlight = activeBatchJobs.filter(j => j.status === "running" || j.status === "queued");
  // Finished renders the open project isn't already showing inline — its own
  // single render and its batch jobs both have their own UI below.
  const queueFinished = renderJobs.filter(j =>
    (j.status === "done" || j.status === "error") && j.projectId !== activeProjectId);

  // Mirror the active project's job into the step-5 render UI. Those state
  // variables are now a view of the queue rather than the source of truth.
  useEffect(() => {
    const job = activeRenderJob;
    setIsRenderingVideo(job?.status === "running" || job?.status === "queued");
    setVideoRenderProgress(job?.status === "running" ? job.progress : null);
    setVideoRenderStartTime(job?.startedAt ?? null);
    setVideoRenderLogs(job?.logs ?? []);
    if (!job || !job.error) { setVideoRenderError(null); return; }
    if (job.error.oom) {
      const dims = job.error.dimensions ? `${job.error.dimensions.w}×${job.error.dimensions.h}` : `${videoWidth}×${videoHeight}`;
      setVideoRenderError({
        kind: "oom", dims, signal: job.error.signal,
        tips: [
          "Lower the output resolution (e.g. 1080p instead of 4K).",
          "Use fewer images or shorten the total audio duration.",
          "Cap source images via the Image Settings panel above (very large PNGs decode to hundreds of MB each).",
        ],
      });
    } else {
      setVideoRenderError({ kind: "generic", message: job.error.message || "Render failed" });
    }
  }, [activeRenderJob, videoWidth, videoHeight]);

  // Queue a render for the current project. The spec is frozen up front, so the
  // user is free to switch projects — or edit this one — while it waits or runs.
  const startRender = async () => {
    const id = ensureActiveProjectId();
    rlog("startRender: clicked", {
      projectId: id,
      exportedTracks: exportedTracks.length,
      selectedVideoAudios: [...selectedVideoAudios],
      videoAudioOrder,
      orderedAudios: getOrderedAudios().length,
      videoImages: videoImages.length,
      selectedVideoImages: [...selectedVideoImages],
      renderableAudios, renderableImages,
    });
    if (!id) {
      rlog("startRender: ABORT — no active project id");
      setMessage("No active project to render into — reload the page if this persists.");
      return;
    }
    const existing = renderQueue.getJob(id);
    if (existing && (existing.status === "running" || existing.status === "queued")) {
      rlog("startRender: ABORT — a job for this project already exists",
        { status: existing.status, queuePosition: existing.queuePosition });
      setMessage(existing.status === "running"
        ? "A render for this project is already running."
        : `This project's render is already queued (#${existing.queuePosition} in line).`);
      return;
    }
    // Everything but the audio bytes is captured synchronously, so the job —
    // and its progress bar — exist the instant the button is pressed. Reading
    // the blobs and saving the project used to happen first, which is what left
    // the button looking dead for a couple of seconds on a long rip.
    const spec = buildRenderSpec();
    // Bailing silently here looked exactly like a render that started and did
    // nothing: the button is enabled off selectedVideoAudios, but the spec is
    // built from getOrderedAudios(), and the two can disagree.
    if (!spec) {
      const audios = getOrderedAudios().length;
      const images = videoImages.filter(img => selectedVideoImages.has(img.id)).length;
      rlog("startRender: ABORT — buildRenderSpec() returned null", {
        orderedAudios: audios, selectedImages: images, exportedTracks: exportedTracks.length,
      });
      setMessage(audios === 0
        ? (exportedTracks.length === 0
            ? "Nothing to render — there are no exported tracks. Run the export in Step 4 first."
            : "Nothing to render — no audio tracks are selected. Tick them in the audio table above.")
        : images === 0
          ? "Nothing to render — no images are selected."
          : "Nothing to render — check the audio and image selections above.");
      return;
    }
    setShowVideoLogs(true);
    const projectName_ = projectName || "Untitled project";
    rlog("startRender: spec built", {
      name: spec.name, audios: spec.audios.length, images: spec.images.length,
      timings: spec.timings.length, totalDur: spec.totalDur, w: spec.w, h: spec.h,
    });

    const queued = renderQueue.enqueue({
      projectId: id,
      projectName: projectName_,
      run: async (ctx) => {
        rlog("run: started, reading audio", spec.audios.map(a => ({ title: a.title, hasFile: !!a.file, hasUrl: !!a.url })));
        ctx.onLog(`Reading ${spec.audios.length} audio track(s)…`);
        try {
          const audios = await resolveSpecAudios(spec.audios);
          rlog("run: audio read ok", audios.map(a => a.blob?.size));
          return await runVideoRender({ ...spec, audios }, ctx);
        } catch (err) {
          rlog("run: THREW", err);
          ctx.onLog(`ERROR ${err?.message || err}`);
          throw err;
        }
      },
      onSettled: async (settled) => {
        rlog(`onSettled: ${settled.status}`, settled.error || undefined);
        if (settled.status !== "done") {
          if (settled.status === "error" && activeProjectIdRef.current === id) {
            setMessage(settled.error?.oom ? "Out of memory — try a lower resolution." : `Video render error: ${settled.error?.message}`);
          }
          return;
        }
        const { blob, size, titleSuggestions, description, tags } = settled.result;
        const key = blobKey(id, "video");
        try {
          await putBlob(key, blob);
          const rec = await storeGetProject(id);
          if (rec) {
            const bytes = { ...(rec.bytes || {}), video: size };
            bytes.total = (bytes.audio || 0) + (bytes.tracks || 0) + (bytes.images || 0) + size;
            await storePutProject({ ...rec, video: { key, size, name: settled.result.fileName }, bytes, updatedAt: Date.now() });
          }
        } catch (e) {
          if (activeProjectIdRef.current === id) setMessage(`Rendered, but could not save to storage: ${e?.message || e}`);
        }
        await refreshProjects();

        // Only touch page state if this project is still the one on screen.
        if (activeProjectIdRef.current !== id) return;
        const url = URL.createObjectURL(blob);
        setRenderedVideoSrc(prev => { if (prev) { try { URL.revokeObjectURL(prev); } catch {} } return url; });
        setYtTitleSuggestions(titleSuggestions);
        setYtUploadData(prev => ({
          ...prev,
          description: description,
          tags: prev.tags || tags,
        }));
        setMessage("Video rendered!");
        if (autoUploadYtRef.current) setTimeout(() => uploadToYouTube(url), 500);
      },
    });

    rlog("startRender: enqueued", queued);
    // Persist after queueing, not before — on a big project this write takes a
    // while, and the job is already safely on the queue.
    await saveActiveProject();
  };

  // ---- Batch render: one video per track ------------------------------------

  // Which tracks get their own video, and which image each one uses.
  const buildBatchPlan = () => {
    const audios = getOrderedAudios();
    const plan = [];
    audios.forEach((a, orderIdx) => {
      if (batchSettings.scope === "pinned" && !trackImageAssign[a._trackIdx]) return;
      const img = imageForTrack(orderIdx, a._trackIdx);
      if (!img) return;
      plan.push({ orderIdx, audio: a, img, pinned: !!trackImageAssign[a._trackIdx] });
    });
    return plan;
  };

  const batchPlan = buildBatchPlan();

  const batchOutputName = (item, total) => {
    const num = String(item.orderIdx + 1).padStart(String(total).length, "0");
    const raw = (batchSettings.nameTemplate || "%num% - %title%")
      .replace(/%num%/g, num)
      .replace(/%title%/g, item.audio.title || `Track ${item.orderIdx + 1}`)
      .replace(/%album%/g, projectName || "album")
      .replace(/%artist%/g, discogsData?.artists?.[0]?.name || "");
    return raw.replace(/[^a-zA-Z0-9 _\-]/g, "").trim().replace(/\s+/g, "_") || `track_${num}`;
  };

  // Single source of truth for a batch video's output size, so the settings
  // preview and the encoder can't disagree. Resolution mode and scale are the
  // shared ones, so a batch video is the concat video's size unless its own
  // image says otherwise.
  const batchDimensionsFor = (img) => {
    const auto = resolutionMode === "auto" && img?.naturalWidth && img?.naturalHeight;
    const baseW = auto ? img.naturalWidth : (parseInt(videoWidth) || 1920);
    const baseH = auto ? img.naturalHeight : (parseInt(videoHeight) || 1080);
    return { w: scaleDimension(baseW, renderScale), h: scaleDimension(baseH, renderScale) };
  };

  // What a batch video's caption will actually say, after mode + per-track override.
  const batchTextFor = (item) => {
    if (sharedTextMode === "off") return "";
    if (sharedTextMode === "custom") {
      const o = trackTextOverrides[item.audio._trackIdx];
      return (o && o.text != null && o.text !== "") ? o.text : textOverlay.customText;
    }
    return trackCaptionText(item.audio._trackIdx, item.audio.title);
  };

  // Everything a batch video needs except its audio blob. Reading the blob is
  // the slow part (a long rip is hundreds of MB), so it's deferred to when the
  // job actually starts — see startBatchRender. The rest is captured now, at
  // click time, so editing the settings mid-batch can't change videos that were
  // already queued.
  const buildBatchSpec = (item, total) => {
    const t = item.audio;
    const img = item.img;
    const dur = t.end - t.start;
    const { w, h } = batchDimensionsFor(img);
    const text = batchTextFor(item);
    const position = trackCaptionPosition(item.audio._trackIdx);
    return {
      name: batchOutputName(item, total),
      audios: [{
        title: t.title, name: t.name, file: t.file, url: t.url,
        start: t.start, end: t.end,
        clipStart: t.clipStart, clipEnd: t.clipEnd, isClipped: t.isClipped,
      }],
      images: [{
        id: img.id, file: img.file,
        stretchToFit: img.stretchToFit, useBlurBg: img.useBlurBg, bgBlur: img.bgBlur, paddingColor: img.paddingColor,
        motion: img.motion, motionSpeed: img.motionSpeed,
        bgMotion: img.bgMotion, bgMotionSpeed: img.bgMotionSpeed,
      }],
      // One image for the whole track — no cuts, so no boundary splitting.
      timings: [{ id: img.id, startTime: 0, endTime: dur, text, position }],
      totalDur: dur,
      w, h,
      bgColor: videoBgColor,
      imageMaxDim,
      motionFps,
      // Never "loop": the two-pass cycle path is meaningless for a single image
      // and would just add an encode.
      slideshowMode: "distribute",
      loopInterval,
      textOverlay: { ...textOverlay, enabled: sharedTextMode !== "off" && !!text.trim() },
      overlayTextVaries: false,
      ytMeta: { discogsData, ytTitleVariation, ytTimestampFormat, ytTimestampSeparator, ytIncludeTrackNums, ytDescSuffix },
    };
  };

  // Pins an image to every selected track, cycling through the selected images
  // in order. With one image per track this is a straight 1:1 mapping; with
  // fewer images they repeat, which is the same rule "Auto" already follows —
  // the difference is the pins become explicit and editable per row.
  const autoAssignTrackImages = () => {
    const selectedImgs = videoImages.filter(im => selectedVideoImages.has(im.id));
    if (!selectedImgs.length) { setMessage("Select at least one image below first."); return; }
    const audios = getOrderedAudios();
    if (!audios.length) { setMessage("Select at least one audio track first."); return; }
    const next = {};
    audios.forEach((a, i) => { next[a._trackIdx] = selectedImgs[i % selectedImgs.length].id; });
    setTrackImageAssign(next);
    if (slideshowMode !== "per-track") setSlideshowMode("per-track");
    setMessage(
      selectedImgs.length >= audios.length
        ? `Assigned one image to each of the ${audios.length} track${audios.length === 1 ? "" : "s"}.`
        : `Assigned ${selectedImgs.length} image${selectedImgs.length === 1 ? "" : "s"} across ${audios.length} tracks (repeating).`
    );
  };

  // Stops everything queued or running in this project's batch. Settings stay
  // editable throughout, so the flow is: stop → change settings → run again.
  const stopBatchRender = () => {
    const id = activeProjectIdRef.current;
    if (!id) return;
    const live = renderQueue.jobsForProject(id).filter(j => j.batch && (j.status === "running" || j.status === "queued"));
    if (!live.length) return;
    live.forEach(j => renderQueue.cancel(j.jobId));
    setMessage(`Stopped the batch (${live.length} render${live.length === 1 ? "" : "s"} cancelled). Change the settings and run it again when ready.`);
  };

  const startBatchRender = async () => {
    const id = ensureActiveProjectId();
    if (!id) { setMessage("No active project to render into — reload the page if this persists."); return; }
    const plan = buildBatchPlan();
    if (!plan.length) { setMessage("Nothing to batch render — select at least one audio track and one image."); return; }
    setShowVideoLogs(true);
    // Drop the previous run's finished/cancelled rows so the progress list shows
    // this batch only — a smaller plan would otherwise leave orphans behind.
    renderQueue.jobsForProject(id)
      .filter(j => j.batch && j.status !== "running" && j.status !== "queued")
      .forEach(j => renderQueue.clear(j.jobId));
    setMessage(`Queued ${plan.length} video${plan.length === 1 ? "" : "s"} — they render one at a time.`);

    // Enqueue synchronously, before any awaiting: the whole batch shows up in
    // the progress list the instant the button is pressed. Reading each track's
    // audio used to happen here first, so on a long rip the button looked dead
    // for however long that took.
    for (const item of plan) {
      const spec = buildBatchSpec(item, plan.length);
      const jobId = `${id}:batch:${item.orderIdx}`;
      const trackIdx = item.audio._trackIdx;
      renderQueue.enqueue({
        jobId,
        projectId: id,
        projectName: projectName || "Untitled project",
        label: item.audio.title || `Track ${item.orderIdx + 1}`,
        batch: true,
        run: async (ctx) => {
          const a = spec.audios[0];
          // Read here rather than at queue time so the batch doesn't hold every
          // track's audio in memory while it waits its turn.
          const blob = await readTrackBytes(a);
          return runVideoRender({ ...spec, audios: [{ ...a, blob }] }, ctx);
        },
        onSettled: async (settled) => {
          if (settled.status !== "done") return;
          const { blob, size, fileName } = settled.result;
          const key = blobKey(id, "batch", item.orderIdx);
          const meta = { key, jobId, trackIdx, orderIdx: item.orderIdx, title: item.audio.title, name: fileName, size };
          try {
            await putBlob(key, blob);
            const rec = await storeGetProject(id);
            if (rec) {
              const others = (rec.batchVideos || []).filter(v => v.key !== key);
              const batchVideos = [...others, meta].sort((a, b) => a.orderIdx - b.orderIdx);
              const bytes = { ...(rec.bytes || {}) };
              bytes.batch = batchVideos.reduce((s, v) => s + (v.size || 0), 0);
              bytes.total = (bytes.audio || 0) + (bytes.tracks || 0) + (bytes.images || 0) + (bytes.video || 0) + bytes.batch;
              await storePutProject({ ...rec, batchVideos, bytes, updatedAt: Date.now() });
            }
          } catch (e) {
            if (activeProjectIdRef.current === id) setMessage(`Rendered “${meta.title}”, but could not save it: ${e?.message || e}`);
          }
          await refreshProjects();
          if (activeProjectIdRef.current !== id) return;
          setBatchVideos(prev => {
            const others = prev.filter(v => v.key !== key);
            // Replacing an earlier render of the same track — release its URL.
            prev.filter(v => v.key === key).forEach(v => { try { URL.revokeObjectURL(v.url); } catch {} });
            return [...others, { ...meta, url: URL.createObjectURL(blob) }].sort((a, b) => a.orderIdx - b.orderIdx);
          });
        },
      });
    }
    // Persist after queueing, not before — on a big project this write takes a
    // while and there's no reason to make the user watch a dead button for it.
    await saveActiveProject();
  };

  const downloadBatchVideo = (v) => {
    const a = document.createElement("a");
    a.href = v.url; a.download = v.name || `${v.title || "video"}.mp4`; a.click();
  };

  const downloadBatchZip = async () => {
    if (!batchVideos.length) return;
    setMessage("Building ZIP…");
    try {
      const zip = new JSZip();
      for (const v of batchVideos) {
        const blob = await (await fetch(v.url)).blob();
        zip.file(v.name || `${v.title || "video"}.mp4`, blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(projectName || "album").replace(/[^a-zA-Z0-9 _\-]/g, "").trim().replace(/\s+/g, "_") || "album"}_videos.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage(`Zipped ${batchVideos.length} videos.`);
    } catch (e) {
      setMessage(`Could not build the ZIP: ${e?.message || e}`);
    }
  };

  const clearBatchVideos = async () => {
    if (!batchVideos.length) return;
    if (!window.confirm(`Delete all ${batchVideos.length} batch video${batchVideos.length === 1 ? "" : "s"} from browser storage? Download them first if you want to keep them.`)) return;
    const id = activeProjectIdRef.current;
    batchVideos.forEach(v => { try { URL.revokeObjectURL(v.url); } catch {} });
    const keys = batchVideos.map(v => v.key);
    const jobIds = batchVideos.map(v => v.jobId).filter(Boolean);
    setBatchVideos([]);
    jobIds.forEach(j => renderQueue.clear(j));
    try {
      for (const k of keys) await deleteBlob(k);
      if (id) {
        const rec = await storeGetProject(id);
        if (rec) {
          const bytes = { ...(rec.bytes || {}), batch: 0 };
          bytes.total = (bytes.audio || 0) + (bytes.tracks || 0) + (bytes.images || 0) + (bytes.video || 0);
          await storePutProject({ ...rec, batchVideos: [], bytes, updatedAt: Date.now() });
        }
      }
      await refreshProjects();
    } catch (e) {
      setMessage(`Removed from the page, but storage cleanup failed: ${e?.message || e}`);
      return;
    }
    setMessage("Deleted the batch videos.");
  };

  // ---- YouTube Upload ----
  const uploadToYouTube = async (videoUrlOverride) => {
    const log = (level, ...args) => { try { (console[level] || console.log)("[yt-upload]", ...args); } catch {} };
    const tStart = performance.now();
    const elapsed = () => `${Math.round(performance.now() - tStart)}ms`;
    const videoUrl = videoUrlOverride || renderedVideoSrc;
    if (!videoUrl || ytUploading) return;
    setYtUploading(true); setYtUploadProgress(0); setYtUploadError(""); setYtUploadAuthError(null); setYtUploadResult(null);
    try {
      log("info", `[${elapsed()}] requesting tokens via getTokensRef…`);
      const tokens = await getTokensRef.current?.getTokens();
      log("info", `[${elapsed()}] tokens received`, {
        hasTokens: !!tokens,
        hasAccessToken: !!tokens?.access_token,
        hasRefreshToken: !!tokens?.refresh_token,
        scope: tokens?.scope,
        expiresIn: tokens?.expires_in,
      });
      if (!tokens) { log("error", "no tokens returned by getTokens()"); setYtUploadError("Not signed in to YouTube."); setYtUploading(false); return; }
      const currentYtData = ytUploadDataRef.current;
      const name = (videoOutputName || projectName || "album").replace(/[^a-zA-Z0-9 _\-]/g, "").trim().replace(/\s+/g, "_");
      // Never upload with blank fields, and keep the on-screen fields in sync
      // with exactly what we send so they stay accurate.
      const finalTitle = (currentYtData.title || videoOutputName || projectName || "Untitled").slice(0, YT_LIMITS.title);
      const finalDescription = (currentYtData.description || (ytDescSuffix || "").replace(/^\s+/, "")).slice(0, YT_LIMITS.description);
      const finalTags = buildSafeTagString(currentYtData.tags || [videoOutputName || projectName, "full album", "vinyl rip"].filter(Boolean));
      if (finalTitle !== currentYtData.title || finalDescription !== currentYtData.description || finalTags !== currentYtData.tags) {
        setYtUploadData(prev => ({ ...prev, title: finalTitle, description: finalDescription, tags: finalTags }));
      }
      log("info", `[${elapsed()}] fetching rendered video blob…`, videoUrl);
      const videoBlob = await fetch(videoUrl).then(r => r.blob());
      const fd = new FormData();
      fd.append("video", videoBlob, `${finalTitle || name}.mp4`);
      fd.append("title", finalTitle || name);
      fd.append("description", finalDescription);
      fd.append("privacyStatus", currentYtData.privacyStatus || "private");
      // finalTags is already sanitized, but the user can type freely into the
      // tags field, so this is the last gate before the request goes out.
      const safeTags = buildSafeTagList(finalTags);
      log("info", `[${elapsed()}] tags: ${safeTags.length} keyword(s), `
        + `${safeTags.reduce((sum, t) => sum + youTubeTagCost(t), 0)}/${YT_LIMITS.tags} of YouTube's keyword budget`);
      fd.append("tags", safeTags.join(", "));
      fd.append("tokens", JSON.stringify(tokens));
      if (thumbnailFile) fd.append("thumbnail", thumbnailFile, thumbnailFile.name);
      const fileSizeMB = (videoBlob.size / (1024 * 1024)).toFixed(1);
      log("info", `[${elapsed()}] blob ready`, { sizeMB: fileSizeMB, sizeBytes: videoBlob.size, type: videoBlob.type });

      const maxSizeMB = 2048; // 2 GB server limit
      if (videoBlob.size > maxSizeMB * 1024 * 1024) {
        log("error", "video exceeds upload limit", { sizeMB: fileSizeMB, maxSizeMB });
        setYtUploadError(`Video file is ${fileSizeMB} MB — exceeds the ${maxSizeMB} MB upload limit. Try a lower resolution or shorter duration.`);
        setYtUploading(false);
        return;
      }

      const sessionEndpoint = `${apiBaseURL()}/youtube/createUploadSession`;
      log("info", `[${elapsed()}] POST ${sessionEndpoint} (init resumable session)`, {
        titleLen: (finalTitle || name).length,
        descLen: finalDescription.length,
        tagsLen: finalTags.length,
        privacyStatus: currentYtData.privacyStatus || "private",
        hasThumbnail: !!thumbnailFile,
        thumbnailSize: thumbnailFile?.size || 0,
        sizeBytes: videoBlob.size,
      });

      const sessionRes = await fetch(sessionEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokens,
          title: currentYtData.title || name,
          description: currentYtData.description || "",
          privacyStatus: currentYtData.privacyStatus || "private",
          tags: currentYtData.tags || "",
          fileSize: videoBlob.size,
          mimeType: videoBlob.type || "video/mp4",
        }),
      });
      if (!sessionRes.ok) {
        const errBody = await sessionRes.text();
        log("error", `[${elapsed()}] createUploadSession failed`, { status: sessionRes.status, body: errBody.slice(0, 300) });
        let errMsg;
        try { errMsg = JSON.parse(errBody).error; } catch { errMsg = errBody; }
        setYtUploadError(errMsg || `Failed to start upload session (${sessionRes.status})`);
        return;
      }
      const { uploadUrl } = await sessionRes.json();
      log("info", `[${elapsed()}] resumable session created`, { uploadUrl: uploadUrl?.slice(0, 80) + "…" });

      // Chunked PUT directly to YouTube. 8 MB chunks (must be a multiple of 256 KB; final chunk can be any size).
      const CHUNK_SIZE = 8 * 1024 * 1024;
      const total = videoBlob.size;
      let offset = 0;
      let aborted = false;
      let videoData = null;

      const putChunk = (start, end) => new Promise((resolve, reject) => {
        const chunk = videoBlob.slice(start, end);
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Range", `bytes ${start}-${end - 1}/${total}`);
        xhr.timeout = 10 * 60 * 1000;

        let lastBytes = 0;
        let lastProgressAt = Date.now();
        let stallWarned = false;
        const watchdog = setInterval(() => {
          const stuckSec = Math.round((Date.now() - lastProgressAt) / 1000);
          if (stuckSec >= 120) {
            log("error", `[${elapsed()}] chunk stalled ${stuckSec}s — aborting`, { start, lastBytes });
            try { xhr.abort(); } catch {}
            return;
          }
          if (stuckSec >= 30 && !stallWarned) {
            stallWarned = true;
            log("warn", `[${elapsed()}] chunk stalled ${stuckSec}s at ${(start + lastBytes)/1024/1024 | 0} MB`);
          }
        }, 5000);
        const cleanup = () => clearInterval(watchdog);

        xhr.upload.onprogress = e => {
          if (!e.lengthComputable) return;
          lastBytes = e.loaded;
          lastProgressAt = Date.now();
          stallWarned = false;
          const sent = start + e.loaded;
          setYtUploadProgress(Math.round((sent / total) * 100));
        };
        xhr.onload = () => {
          cleanup();
          // 308 Resume Incomplete — intermediate chunk accepted, body is empty,
          // Range header tells us the last byte received.
          if (xhr.status === 308) {
            let next = end;
            const range = xhr.getResponseHeader("Range");
            if (range) {
              const m = /bytes=\d+-(\d+)/.exec(range);
              if (m) next = parseInt(m[1], 10) + 1;
            }
            resolve({ next, done: false });
            return;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            // Final chunk — JSON video metadata
            try {
              const data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
              videoData = data;
              setYtUploadResult(data);
              resolve({ done: true });
            } catch (parseErr) {
              console.error("YouTube upload error — failed to parse final response. Status:", xhr.status, "Raw response:", xhr.responseText, parseErr);
              setYtUploadError(`Failed to parse server response (HTTP ${xhr.status})`);
              reject(parseErr);
            }
            return;
          }
          // Error path — try to parse JSON, fall back to text
          let data = null;
          try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch {}
          console.error("YouTube upload error — full server response:", data || xhr.responseText);
          const rawErr = data ? String(data.error || data.error_description || "") : (xhr.responseText || "");
          const looksLikeAuth =
            /invalid_grant|invalid_token|unauthorized_client|token has been expired|not signed in/i.test(rawErr) ||
            xhr.status === 401 || xhr.status === 403;
          if (looksLikeAuth) {
            try {
              localStorage.removeItem('youtube_tokens');
              localStorage.removeItem('youtube_auth_code');
              localStorage.removeItem('youtube_auth_scope');
              localStorage.removeItem('youtube_auth_set_time');
            } catch {}
            try { getTokensRef.current?.verifyTokens?.(); } catch {}
            setYtUploadAuthError({ reason: rawErr || `HTTP ${xhr.status}`, raw: data });
            setYtUploadError("");
          } else {
            let errMsg = rawErr || `Upload failed (${xhr.status})`;
            if (xhr.status === 413) errMsg = `File too large (${fileSizeMB} MB). Maximum upload size is ${maxSizeMB} MB. Try a lower resolution.`;
            else if (/invalid.*title|empty.*title/i.test(errMsg)) errMsg += " — Try shortening the title (max 100 characters).";
            else if (/description/i.test(errMsg)) errMsg += " — Try shortening the description (max 5,000 characters).";
            else if (/tag/i.test(errMsg)) errMsg += " — Try reducing tags (max 500 characters total, each tag max 30 chars).";
            setYtUploadError(errMsg);
          }
          reject(new Error(rawErr || `HTTP ${xhr.status}`));
        };
        xhr.onerror = () => { cleanup(); reject(new Error("Network error during chunk upload")); };
        xhr.onabort = () => { cleanup(); aborted = true; reject(new Error("Upload aborted (no progress)")); };
        xhr.ontimeout = () => { cleanup(); reject(new Error("Chunk upload timed out")); };
        xhr.send(chunk);
      });

      try {
        while (offset < total) {
          const end = Math.min(offset + CHUNK_SIZE, total);
          log("debug", `[${elapsed()}] PUT chunk ${offset}-${end - 1}/${total}`);
          const result = await putChunk(offset, end);
          if (result.done) break;
          offset = result.next ?? end;
        }
      } catch (err) {
        log("error", `[${elapsed()}] chunked upload failed`, err);
        setYtUploadError(aborted
          ? `Upload aborted — connection stalled. Try again or use a smaller video.`
          : `Upload failed: ${err.message}`);
        return;
      }

      if (!videoData) {
        setYtUploadError("Upload completed but YouTube didn't return video metadata.");
        return;
      }

      log("info", `[${elapsed()}] video upload complete`, { videoId: videoData.id });

      let thumbnailUploaded = false;
      if (thumbnailFile && videoData.id) {
        try {
          log("info", `[${elapsed()}] uploading thumbnail directly to YouTube`);
          const thumbRes = await fetch(
            `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoData.id)}&uploadType=media`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${tokens.access_token}`,
                "Content-Type": thumbnailFile.type || "image/jpeg",
              },
              body: thumbnailFile,
            }
          );
          if (thumbRes.ok) thumbnailUploaded = true;
          else log("warn", `[${elapsed()}] thumbnail upload failed`, { status: thumbRes.status, body: (await thumbRes.text()).slice(0, 200) });
        } catch (thumbErr) {
          log("warn", `[${elapsed()}] thumbnail upload threw`, thumbErr);
        }
      }

      setYtUploadResult({ id: videoData.id, title: videoData.snippet?.title, thumbnailUploaded });
    } catch (err) {
      log("error", `[${elapsed()}] uploadToYouTube threw`, err);
      setYtUploadError(err.message || "Upload failed");
    }
    finally {
      log("info", `[${elapsed()}] uploadToYouTube finally — clearing state`);
      setYtUploading(false); setYtUploadProgress(null);
    }
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

  // Keep the YouTube upload title bound to the Output name field. The Output
  // name is the user's chosen "canonical name" (set by typing or via the
  // Select… picker, which collects metadata from Discogs and dropped files),
  // and we want one source of truth for that name across the rendered file
  // and the YouTube video. Only sync when there's actually a value to copy
  // and the target differs, to avoid clobbering an explicit user edit with
  // an identical string or wiping the title when Output name is blanked.
  useEffect(() => {
    if (!videoOutputName) return;
    const next = videoOutputName.slice(0, YT_LIMITS.title);
    setYtUploadData(prev => (prev.title === next ? prev : { ...prev, title: next }));
  }, [videoOutputName]);

  const regenerateYtTags = () => {
    const extracted = extractTagsFromDiscogs(discogsData);
    const filters = { artists: { enabled: true, sliderValue: 100 }, album: { enabled: true, sliderValue: 100 }, tracklist: { enabled: true, sliderValue: 100 }, combinations: { enabled: true, sliderValue: 100 }, credits: { enabled: false, sliderValue: 100 }, filenames: { enabled: false, sliderValue: 100 } };
    const tags = buildTagString(extracted, filters);
    setYtUploadData(prev => ({ ...prev, tags }));
  };

  // Track last discogs URL and rendered video used to generate YouTube metadata
  const lastYtDiscogsUrlRef = useRef(null);
  const lastYtVideoSrcRef = useRef(null);

  // Pre-fill YouTube metadata when entering Step 5 or when discogs data / rendered video changes
  useEffect(() => {
    if (step !== 5) return;
    const discogsChanged = discogsData && discogsUrl && lastYtDiscogsUrlRef.current !== discogsUrl;
    const videoChanged = renderedVideoSrc && lastYtVideoSrcRef.current !== renderedVideoSrc;
    const needsTitle = !ytUploadData.title || discogsChanged;
    const needsDesc = !ytUploadData.description || discogsChanged || videoChanged;
    const needsTags = !ytUploadData.tags || discogsChanged;

    if (discogsChanged) lastYtDiscogsUrlRef.current = discogsUrl;
    if (videoChanged) lastYtVideoSrcRef.current = renderedVideoSrc;

    if (needsTitle && discogsData) {
      // Refresh the alternate-title dropdown options, but do NOT touch
      // ytUploadData.title here — that's now bound to videoOutputName by a
      // dedicated effect so the Output-name field is the single source of
      // truth for the YT title.
      const suggestions = generateVideoTitleRecommendations(discogsData, ytTitleVariation);
      setYtTitleSuggestions(suggestions);
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

    // Guarantee none of the upload fields are ever blank. Whatever is in these
    // fields is exactly what gets uploaded to YouTube, so fall back to sensible
    // defaults (never clobbering a value that's already there).
    const fallbackTitle = (videoOutputName || projectName || "Untitled").slice(0, YT_LIMITS.title);
    const fallbackDesc = (ytDescSuffix || "").replace(/^\s+/, "").slice(0, YT_LIMITS.description);
    const fallbackTags = buildSafeTagString([videoOutputName || projectName, "full album", "vinyl rip"].filter(Boolean));
    setYtUploadData(prev => {
      const title = prev.title || fallbackTitle;
      const description = prev.description || fallbackDesc;
      const tags = prev.tags || fallbackTags;
      if (title === prev.title && description === prev.description && tags === prev.tags) return prev;
      return { ...prev, title, description, tags };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, discogsData, renderedVideoSrc]);

  // ---- Derived ----
  // Every dropped file needs its duration read before Step 2 can show the
  // picker, and the selected file needs to be decoded before Step 3 has a
  // waveform. Advancing early left the next step looking broken while the work
  // it depended on was still running.
  const audioDurationsPending = droppedAudioFiles.filter(
    f => !(`${f.name}:${f.size}` in audioDurationMap)
  ).length;
  const audioPrepPending = !!audioPrepStatus || (!!audioFile && !channelData && !decodeFailedRef.current);
  const audioReady = !!audioFile && !audioPrepPending && audioDurationsPending === 0;
  const canGoStep2 = audioReady;
  const canGoStep3 = !!audioFile && (parseInt(manualTrackCount) > 0 || (discogsData?.tracklist?.length > 0));
  const canExport = tracks.length > 0 && !!audioFile;
  // True when nothing has been done yet — used to disable the "Start Over" button
  // so it isn't an actionable target on a brand-new / freshly reset session.
  // What the trash icon clears, per step. Scoped to the step you are looking at
  // — wiping the whole project from Step 5 because the images are wrong was
  // never what anyone meant by that button.
  const stepClearPlan = (() => {
    switch (step) {
      case 1: return {
        label: "input files",
        detail: "the dropped audio files and the loaded audio",
        empty: droppedAudioFiles.length === 0 && !audioFile,
        run: () => {
          if (audioUrlRef.current) { try { URL.revokeObjectURL(audioUrlRef.current); } catch {} }
          setAudioFile(null); setDroppedAudioFiles([]); setPendingAudioFiles([]);
          setAudioDurationMap({}); setExpandedFilenames(new Set()); setAudioPickConfirmed(false);
          setChannelData(null); setDuration(0); setTracks([]); setSilenceRegions([]);
        },
      };
      case 2: return {
        label: "release info",
        detail: "the Discogs release, track names and the manual track count",
        empty: !discogsData && !discogsUrl && trackNames.length === 0 && !manualTrackCount,
        run: () => {
          setDiscogsData(null); setDiscogsUrl(""); setDiscogsError("");
          setDiscogsSearchResults([]); setDiscogsSearchQuery(""); setDiscogsSearchError("");
          setTrackNames([]); setManualTrackCount("");
          discogsArtReleaseRef.current = null;
        },
      };
      case 3: return {
        label: "track markers",
        detail: `the ${tracks.length} split point${tracks.length === 1 ? "" : "s"} on the waveform`,
        empty: tracks.length === 0,
        run: () => {
          snapshotTracks();
          setTracks([]); syncPeaksToTracks([]); setSilenceRegions([]);
          setExportedTracks([]); autoSplitDoneRef.current = false;
        },
      };
      case 4: return {
        label: "exported tracks",
        detail: `the ${exportedTracks.length} exported file${exportedTracks.length === 1 ? "" : "s"}`,
        empty: exportedTracks.length === 0,
        run: () => {
          exportedTracks.forEach(t => { try { URL.revokeObjectURL(t.url); } catch {} });
          setExportedTracks([]);
          autoExportDoneRef.current = true; // don't immediately re-export what was just cleared
        },
      };
      default: return {
        label: "video tables",
        detail: "every audio track, image and rendered video on this step",
        empty: exportedTracks.length === 0 && videoImages.length === 0 && !renderedVideoSrc,
        run: () => clearAllVideoTables(),
      };
    }
  })();

  const clearCurrentStep = () => {
    if (stepClearPlan.empty) return;
    if (!window.confirm(`Clear ${stepClearPlan.detail}?\n\nOnly this step is affected — the rest of the project stays as it is.`)) return;
    stepClearPlan.run();
    setMessage(`Cleared ${stepClearPlan.label} on step ${step}.`);
  };

  const isFreshStart =
    step === 1 &&
    !audioFile &&
    droppedAudioFiles.length === 0 &&
    tracks.length === 0 &&
    exportedTracks.length === 0 &&
    videoImages.length === 0 &&
    !renderedVideoSrc &&
    !discogsData &&
    !discogsUrl &&
    !thumbnailFile &&
    (projectName === "My Album" || !projectName);

  // Candidate names for the Output-name picker: collected from Discogs data,
  // dropped/queued audio filenames, the project name, and any folder name
  // available via webkitRelativePath. Grouped + de-duped so the popup is
  // useful even with partial data.
  const buildOutputNameCandidates = () => {
    const groups = [];
    const seen = new Set();
    const add = (group, value) => {
      if (!value) return;
      const v = String(value).trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      group.items.push(v);
    };

    const projectGroup = { label: "Project", items: [] };
    add(projectGroup, projectName);

    const discogsGroup = { label: "Discogs", items: [] };
    if (discogsData) {
      const artist = discogsData.artists?.[0]?.name?.replace(/\s+\(\d+\)$/, "") || "";
      const albumTitle = discogsData.title || "";
      const year = discogsData.released ? discogsData.released.substring(0, 4) : (discogsData.year ? String(discogsData.year) : "");
      add(discogsGroup, albumTitle);
      add(discogsGroup, artist);
      if (artist && albumTitle) {
        add(discogsGroup, `${artist} - ${albumTitle}`);
        add(discogsGroup, `${albumTitle} - ${artist}`);
        if (year) {
          add(discogsGroup, `${artist} - ${albumTitle} (${year})`);
          add(discogsGroup, `${albumTitle} (${year})`);
        }
      }
      // Roll the auto-generated recommendations into the same group so the
      // user sees ready-to-use long-form titles too.
      try {
        for (let v = 0; v < 5; v++) {
          const recs = generateVideoTitleRecommendations(discogsData, v);
          recs.forEach(r => add(discogsGroup, r));
        }
      } catch {}
    }

    const fileGroup = { label: "Files", items: [] };
    // Each filename without its extension.
    const stripExt = (n) => n.replace(/\.[^./\\]+$/, "");
    const seenFolders = new Set();
    droppedAudioFiles.forEach(f => {
      add(fileGroup, stripExt(f.name));
      // webkitRelativePath captures the source folder when files arrive via
      // an <input type="file" webkitdirectory> or directory-aware drop.
      const rel = f.webkitRelativePath || "";
      if (rel.includes("/")) {
        const folder = rel.split("/")[0];
        if (folder && !seenFolders.has(folder)) {
          seenFolders.add(folder);
          add(fileGroup, folder);
        }
      }
    });
    // Common prefix across all filenames (often the album/release name when a
    // CD rip uses "01 - Album - Track.flac" style naming).
    if (droppedAudioFiles.length > 1) {
      const stems = droppedAudioFiles.map(f => stripExt(f.name));
      let prefix = stems[0];
      for (let i = 1; i < stems.length && prefix.length > 0; i++) {
        while (!stems[i].startsWith(prefix)) prefix = prefix.slice(0, -1);
      }
      // Trim trailing separators / track numbers so the suggestion is clean.
      prefix = prefix.replace(/[\s\-_.\d]+$/g, "").trim();
      if (prefix.length >= 3) add(fileGroup, prefix);
    }

    [projectGroup, discogsGroup, fileGroup].forEach(g => { if (g.items.length) groups.push(g); });
    return groups;
  };

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
            <h1 className={styles.title}>RipTag</h1>
          </div>
          <p className={styles.subtitle}>Record or upload vinyl audio → detect tracks → export with Discogs metadata</p>
        </div>
      </div>

      {showAuthPanel && (
        <div style={{
          margin: "0 1rem 1rem", padding: "0.75rem 1rem", border: "1px solid #444",
          borderRadius: 8, background: "rgba(0,0,0,0.35)", color: "#fff",
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem",
          fontSize: 14,
        }}>
          <strong>Cloud sync</strong>
          {!authUser ? (
            <>
              <span style={{ opacity: 0.8 }}>Sign in to save/restore project progress across devices.</span>
              <button
                onClick={handleCloudSignIn}
                disabled={!fb || authBusy}
                style={{ padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid #888", background: "#fff", color: "#111", cursor: "pointer", fontWeight: 600 }}
              >
                {fb ? "Sign in with Google" : "Loading…"}
              </button>
            </>
          ) : (
            <>
              <span>Signed in as <strong>{authUser.email || authUser.displayName}</strong></span>
              <button
                onClick={handleCloudSave}
                disabled={authBusy}
                style={{ padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid #888", background: "#fff", color: "#111", cursor: "pointer", fontWeight: 600 }}
              >
                Save progress to cloud
              </button>
              <button
                onClick={handleCloudLoad}
                disabled={authBusy}
                style={{ padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid #888", background: "#fff", color: "#111", cursor: "pointer", fontWeight: 600 }}
              >
                Load from cloud
              </button>
              <button
                onClick={handleCloudSignOut}
                disabled={authBusy}
                style={{ padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid #888", background: "transparent", color: "#fff", cursor: "pointer" }}
              >
                Sign out
              </button>
              {cloudSavedAt && (
                <span style={{ opacity: 0.7, fontSize: 12 }}>
                  Last cloud save: {new Date(cloudSavedAt).toLocaleString()}
                </span>
              )}
            </>
          )}
          <button
            onClick={() => setShowAuthPanel(false)}
            style={{ marginLeft: "auto", padding: "0.25rem 0.5rem", borderRadius: 6, border: "1px solid #666", background: "transparent", color: "#fff", cursor: "pointer" }}
            aria-label="Hide cloud sync panel"
            title="Hide (re-open with showauth() in the console)"
          >
            ✕
          </button>
          {cloudStatus && <span style={{ color: "#9f9", width: "100%" }}>{cloudStatus}</span>}
          {cloudError && <span style={{ color: "#f99", width: "100%" }}>{cloudError}</span>}
          <span style={{ width: "100%", fontSize: 11, opacity: 0.65 }}>
            Note: cloud sync stores project settings, track splits, Discogs metadata, and step state only. Audio files and rendered video stay on this device.
          </span>
        </div>
      )}

      {/* Project bar — which project is open, plus every render in flight */}
      <div className={styles.projectBar}>
        {/* The projects button is hidden — the 🗂 glyph rendered badly. The
            drawer and all of its state are untouched, so restoring it is a
            matter of putting a button back here that calls setShowHistory. */}
        {(queueActive.length > 0 || queueFinished.length > 0) && (
          <div className={styles.projectBarJobs}>
            {queueActive.map(job => (
              <button
                key={job.jobId}
                type="button"
                className={`${styles.jobChip} ${job.status === "running" ? styles.jobChipRunning : styles.jobChipQueued}`}
                onClick={() => openProject(job.projectId)}
                title={job.status === "running"
                  ? `Rendering ${job.label}${job.batch ? ` (${job.projectName})` : ""} — click to open that project`
                  : `Queued behind ${queueActive.length - 1} other render(s) — click to open that project`}
              >
                <span className={styles.jobChipDot} />
                {job.label}
                <span className={styles.jobChipPct}>
                  {job.status === "running"
                    ? (job.progress != null ? `${Math.round(job.progress * 100)}%` : "…")
                    : `#${job.queuePosition}`}
                </span>
              </button>
            ))}
            {/* A render that lands while you're in another project would
                otherwise finish silently — these stay until dismissed. */}
            {queueFinished.map(job => (
              <span
                key={job.jobId}
                className={`${styles.jobChip} ${job.status === "done" ? styles.jobChipDone : styles.jobChipFailed}`}
              >
                <button type="button" className={styles.jobChipOpen} onClick={() => openProject(job.projectId)}
                  title={`Open ${job.projectName}`}>
                  {job.status === "done" ? "✓" : "✕"} {job.label}
                </button>
                <button type="button" className={styles.jobChipX} onClick={() => renderQueue.clear(job.jobId)} aria-label="Dismiss">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Steps — sticky when rendering/uploading */}
      <div className={`${styles.stepBarWrap} ${(isRenderingVideo || ytUploading) ? styles.stepBarSticky : ""}`}>
        {/* Kept a sibling of .stepBar rather than a child: .stepBar scrolls
            horizontally on narrow viewports, which would clip the hover
            tooltip. Its own row, so it can never overlap the first step. */}
        <div className={styles.stepActionGroup}>
        <button
          type="button"
          className={styles.stepResetBtn}
          onClick={clearCurrentStep}
          disabled={stepClearPlan.empty}
          aria-label={stepClearPlan.empty ? "Clear this step (nothing to clear)" : `Clear this step — ${stepClearPlan.label}`}
          data-tooltip={stepClearPlan.empty ? "Nothing to clear on this step" : "Clear this step"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6M14 11v6"></path>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
          </svg>
        </button>
        <button
          type="button"
          className={styles.stepStartOverBtn}
          onClick={resetAll}
          disabled={isFreshStart}
          title={isFreshStart ? "Nothing to clear" : "Clear the whole project and go back to Step 1"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="1 4 1 10 7 10"></polyline>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
          </svg>
          Start over
        </button>
        </div>
        <div className={styles.stepBar}>
          {["Input", "Source", "Waveform", "Export", "Video"].map((label, i) => (
            <div key={`item-${i}`} className={`${styles.stepItem} ${step === i + 1 ? styles.stepActive : ""} ${step > i + 1 ? styles.stepDone : ""}`}
              onClick={() => setStep(i + 1)}
              style={{ cursor: "pointer" }}
            >
              <div className={styles.stepCircle}>{i + 1}</div>
              <span className={styles.stepLabel}>{label}</span>
              {i === 4 && isRenderingVideo && (
                <span className={styles.stepProgress}>{videoRenderProgress !== null ? ` ${(videoRenderProgress * 100).toFixed(0)}%` : " …"}</span>
              )}
              {i < 4 && <div className={styles.stepLine} />}
            </div>
          ))}
        </div>
        {(queueActive.length > 0 || ytUploading) && (() => {
          const running = queueActive.find(j => j.status === "running");
          const waiting = queueActive.length - (running ? 1 : 0);
          return (
            <div className={styles.renderingWarningBanner}>
              ⚠️ WARNING: {running
                ? `Rendering “${running.projectName}”${running.progress != null ? ` (${(running.progress * 100).toFixed(0)}%)` : ""}${waiting > 0 ? ` · ${waiting} queued` : ""}`
                : ytUploading
                  ? `Video is uploading${ytUploadProgress !== null ? ` (${ytUploadProgress}%)` : ""}`
                  : `${waiting} render${waiting === 1 ? "" : "s"} queued`}
              {" "}— do not navigate away from this page!
            </div>
          );
        })()}
        {ytUploadAuthError && !ytUploading && (
          <div className={styles.renderingWarningBanner} style={{animation:"none", background: "#fed7d7", color: "#742a2a"}}>
            ⚠️ YouTube sign-in expired — see the YouTube Upload Details panel below to sign in again.
          </div>
        )}
        {ytUploadError && !ytUploadAuthError && !ytUploading && (
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
              <h2 className={styles.cardTitle}>Step 1: Input</h2>
              <div className={styles.tabRow}>
                <button className={`${styles.tab} ${audioMode === "upload" ? styles.tabActive : ""}`} onClick={() => setAudioMode("upload")}>Upload File</button>
                <button className={`${styles.tab} ${audioMode === "record" ? styles.tabActive : ""}`} onClick={() => setAudioMode("record")}>Record Live</button>
              </div>

              {audioMode === "upload" ? (
                <div>
                  <div className={styles.dropZone} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
                    <div className={styles.dropIcon}>🎵</div>
                    <p className={styles.dropText}>Drop audio or image files here, or click to browse audio</p>
                    <p className={styles.dropHint}>Audio: WAV · FLAC · MP3 · AIFF · OGG · WebM · Images: PNG · JPG (auto-added to album art &amp; video)</p>
                    <input type="file" accept="audio/*,.flac,.wav,.aiff,.aif,.mp3,.ogg,.oga,.m4a,.aac,.webm" multiple onChange={handleFileInput} className={styles.fileInput} />
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

              {(() => {
                const hasFiles = droppedAudioFiles.length > 0 || videoImages.length > 0;
                const anyImageLoading = videoImages.some(img => img.loading);
                const audioReady = !audioFile || !!channelData;
                const allLoaded = hasFiles && !anyImageLoading && audioReady;
                if (!allLoaded) return null;
                return (
                  <div className={`${styles.fileInfo} ${styles.fileInfoAllReady}`}>
                    <span>✅ All files loaded</span>
                  </div>
                );
              })()}
              {droppedAudioFiles.length > 0 && (
                <div className={styles.uploadedFilesSection}>
                  <h3 className={styles.sectionTitle}>Audio Files ({droppedAudioFiles.length})</h3>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Filename</th>
                          <th>Size</th>
                          <th>Length</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {droppedAudioFiles.map((f, i) => {
                          const isDecoding = audioFile === f && !channelData;
                          const key = `${f.name}:${f.size}`;
                          const dur = audioDurationMap[key];
                          const isExpanded = expandedFilenames.has(key);
                          return (
                            <tr key={`${f.name}-${f.size}-${i}`}>
                              <td>{i + 1}</td>
                              <td
                                className={`${styles.filenameCell} ${isExpanded ? styles.filenameCellExpanded : ""}`}
                                title={f.name}
                                onClick={() => setExpandedFilenames(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; })}
                              >{f.name}</td>
                              <td>{formatBytes(f.size)}</td>
                              <td className={styles.timeCell}>
                                {dur == null ? <span className={styles.fileStatusIdle}>—</span> : formatTime(dur)}
                              </td>
                              <td>
                                {isDecoding ? (
                                  <span className={styles.fileStatusLoading}>
                                    <span className={styles.fileLoadingSpinner} />
                                    <span>Loading…</span>
                                  </span>
                                ) : (
                                  <span className={styles.fileStatusReady}>✓ Ready</span>
                                )}
                              </td>
                              <td>
                                <button
                                  className={styles.removeBtn}
                                  title="Remove this file"
                                  onClick={() => {
                                    setDroppedAudioFiles(prev => prev.filter(x => x !== f));
                                    setPendingAudioFiles(prev => prev.filter(x => x !== f));
                                    if (audioFile === f) {
                                      const next = droppedAudioFiles.find(x => x !== f) || null;
                                      setAudioFile(next);
                                      if (!next) { setChannelData(null); setDuration(0); }
                                    }
                                  }}
                                >×</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {videoImages.length > 0 && (
                <div className={styles.uploadedFilesSection}>
                  <h3 className={styles.sectionTitle}>Image Files ({videoImages.length})</h3>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th></th>
                          <th>Filename</th>
                          <th>Size</th>
                          <th>Resolution</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {videoImages.map((img) => {
                          const key = `${img.file.name}:${img.file.size}`;
                          const isExpanded = expandedFilenames.has(key);
                          return (
                          <tr key={img.id}>
                            <td>
                              {img.loading || !img.thumbUrl ? (
                                <div className={styles.uploadedThumbPlaceholder}>
                                  <span className={styles.fileLoadingSpinner} />
                                </div>
                              ) : (
                                <img src={img.thumbUrl} alt="" className={styles.uploadedThumb} />
                              )}
                            </td>
                            <td
                              className={`${styles.filenameCell} ${isExpanded ? styles.filenameCellExpanded : ""}`}
                              title={img.file.name}
                              onClick={() => setExpandedFilenames(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; })}
                            >{img.file.name}</td>
                            <td>{formatBytes(img.file.size)}</td>
                            <td className={styles.timeCell}>
                              {img.width && img.height ? `${img.width} × ${img.height}` : <span className={styles.fileStatusIdle}>—</span>}
                            </td>
                            <td>
                              {img.loading ? (
                                <span className={styles.fileStatusLoading}>
                                  <span className={styles.fileLoadingSpinner} />
                                  <span>Loading…</span>
                                </span>
                              ) : (
                                <span className={styles.fileStatusReady}>✓ Ready</span>
                              )}
                            </td>
                            <td>
                              <button
                                className={styles.removeBtn}
                                title="Remove this image"
                                onClick={() => {
                                  removeVideoImage(img.id);
                                  if (embedArtFile === img.file) {
                                    if (embedArtPreview) URL.revokeObjectURL(embedArtPreview);
                                    setEmbedArtFile(null);
                                    setEmbedArtPreview(null);
                                  }
                                }}
                              >×</button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {message && <p className={styles.msg}>{message}</p>}

              {/* YouTube sign-in (optional, for upload later) */}
              <div style={{ marginTop: 16, padding: '12px 16px', border: `1px solid ${darkMode ? '#444' : '#e2e8f0'}`, borderRadius: 8, background: darkMode ? '#252538' : '#f8f9fa' }}>
                <p style={{ margin: '0 0 8px 0', fontSize: 13, color: darkMode ? '#ffffff' : '#000000' }}>
                  Sign in now if you want to upload to YouTube later.
                </p>
                <YouTubeAuth compact={true} returnUrl="/riptag" darkMode={darkMode} getTokensRef={getTokensRef} onAuthStateChange={setYtAuthState} />
              </div>

              {/* Real progress, not a spinner: the read is a byte count, and the
                  stages after it are named as they happen. */}
              {audioFile && (audioPrepPending || audioDurationsPending > 0) && (
                <div className={styles.audioPrepBar}>
                  <div className={styles.audioPrepHead}>
                    <span>{audioPrepStatus?.label || `Reading track lengths — ${droppedAudioFiles.length - audioDurationsPending}/${droppedAudioFiles.length}`}</span>
                    <span className={styles.audioPrepPct}>
                      {audioPrepStatus
                        ? `${audioPrepStatus.pct}%`
                        : `${Math.round(((droppedAudioFiles.length - audioDurationsPending) / Math.max(1, droppedAudioFiles.length)) * 100)}%`}
                    </span>
                  </div>
                  <div className={styles.audioPrepTrack}>
                    <div className={styles.audioPrepFill} style={{
                      width: `${audioPrepStatus
                        ? audioPrepStatus.pct
                        : Math.round(((droppedAudioFiles.length - audioDurationsPending) / Math.max(1, droppedAudioFiles.length)) * 100)}%`,
                    }} />
                  </div>
                  <span className={styles.audioPrepHint}>
                    {audioFile.name} · {formatBytes(audioFile.size)} — the next step needs this finished.
                  </span>
                </div>
              )}

              <div className={styles.stepNav}>
                <button className={styles.nextBtn} disabled={!canGoStep2} onClick={() => setStep(2)}>
                  {!audioFile ? "Next: Source →"
                    : audioPrepPending ? `Preparing audio… ${audioPrepStatus?.pct ?? 0}%`
                    : audioDurationsPending > 0 ? `Reading ${audioDurationsPending} more file${audioDurationsPending === 1 ? "" : "s"}…`
                    : "Next: Source →"}
                </button>
              </div>
            </div>
          )}

          {/* ---- STEP 2 ---- */}
          {step === 2 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Step 2: Tracks</h2>

              {droppedAudioFiles.length > 1 && !audioPickConfirmed && (
                <div className={styles.audioPickerCard}>
                  <div className={styles.audioPickerHeader}>
                    📂 You uploaded {droppedAudioFiles.length} audio files — which one do you want to edit?
                  </div>
                  <div className={styles.audioPickerList}>
                    {droppedAudioFiles.map((f, i) => (
                      <button
                        key={`${f.name}-${f.size}-${i}`}
                        type="button"
                        className={`${styles.audioPickerItem} ${audioFile === f ? styles.audioPickerItemActive : ""}`}
                        onClick={() => {
                          setAudioFile(f);
                          setMessage("");
                        }}
                      >
                        <span className={styles.audioPickerName}>{f.name}</span>
                        <span className={styles.audioPickerSize}>{formatBytes(f.size)}</span>
                        {audioFile === f && <span className={styles.audioPickerBadge}>Selected</span>}
                      </button>
                    ))}
                  </div>
                  <div className={styles.audioPickerActions}>
                    <button
                      type="button"
                      className={styles.selectBtn}
                      disabled={!audioFile}
                      onClick={() => { setPendingAudioFiles([]); setAudioPickConfirmed(true); }}
                    >
                      Confirm selection
                    </button>
                    <button
                      type="button"
                      className={styles.skipBtn}
                      onClick={() => { setPendingAudioFiles([]); setAudioPickConfirmed(true); }}
                    >
                      Skip editing
                    </button>
                    <button
                      type="button"
                      className={styles.skipBtn}
                      onClick={() => { setAudioFile(null); setPendingAudioFiles([]); setStep(1); }}
                    >
                      Drop different files
                    </button>
                  </div>
                </div>
              )}
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
                <button
                  className={styles.skipBtn}
                  onClick={() => setStep(3)}
                  title="Skip tracks setup and go straight to the waveform"
                >
                  Skip →
                </button>
                <button className={styles.nextBtn} disabled={!canGoStep3} onClick={() => setStep(3)}>Next: Waveform →</button>
              </div>
            </div>
          )}

          {/* ---- STEP 3 ---- (always mounted to preserve waveform) */}
          <div className={styles.card} style={{ display: step === 3 ? undefined : "none" }}>
              <h2 className={styles.cardTitle}>Step 3: Waveform</h2>

              {droppedAudioFiles.length > 1 && (
                <div className={styles.audioSwitcher}>
                  <span className={styles.audioSwitcherLabel}>Editing:</span>
                  <div className={styles.audioSwitcherList}>
                    {droppedAudioFiles.map((f, i) => (
                      <button
                        key={`${f.name}-${f.size}-${i}`}
                        type="button"
                        className={`${styles.audioSwitcherItem} ${audioFile === f ? styles.audioSwitcherItemActive : ""}`}
                        title={f.name}
                        onClick={() => {
                          if (audioFile === f) return;
                          if (tracks.length > 0 && !window.confirm(`Switch to "${f.name}"? Your current track markers will be cleared.`)) return;
                          setAudioFile(f);
                        }}
                      >
                        <span className={styles.audioSwitcherName}>{f.name}</span>
                        {audioFile === f && <span className={styles.audioSwitcherBadge}>✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Toolbar */}
              <div className={styles.waveToolbar}>
                <div className={styles.tbGroup}>
                  <button className={styles.playBtnSmall} onClick={togglePlay} disabled={!duration}>{isPlaying ? "⏸" : "▶"}</button>
                  {(() => {
                    const durStr = formatTime(duration);
                    const slotWidth = `${Math.max(durStr.length, 7)}ch`;
                    return (
                      <span className={styles.timeLabel}>
                        <span className={styles.timeCurrent} style={{ minWidth: slotWidth }}>{formatTime(currentTime)}</span>
                        <span className={styles.timeSep}>/</span>
                        <span className={styles.timeDuration}>{durStr}</span>
                      </span>
                    );
                  })()}
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
                <div className={styles.tbSep} />
                <div className={styles.tbGroup}>
                  <button
                    type="button"
                    className={`${styles.tbBtn} ${showMarkerJson ? styles.tbBtnActive : ""}`}
                    aria-expanded={showMarkerJson}
                    title="Marker JSON — copy the track start/end times out, or paste a saved set back in"
                    onClick={() => setShowMarkerJson(v => {
                      const next = !v;
                      // Reopening always starts from the live markers rather
                      // than whatever was left in the box last time.
                      if (next) { setMarkerJsonDirty(false); setMarkerJsonDraft(buildMarkerJson()); }
                      return next;
                    })}
                  >⚙</button>
                </div>
              </div>

              {/* Marker JSON — portable track boundaries */}
              {showMarkerJson && (
                <div className={styles.markerJsonPanel}>
                  <div className={styles.markerJsonHead}>
                    <strong>Marker JSON</strong>
                    <span className={styles.settingHelp}>
                      The start and end of every track, as text. Copy it to keep a backup, or paste a saved set
                      over it and press <b>Apply</b> to put those positions onto this audio file. Times are in
                      seconds, and only line up against the same recording.
                    </span>
                  </div>
                  <textarea
                    className={styles.markerJsonBox}
                    spellCheck={false}
                    value={markerJsonDraft}
                    onChange={e => { setMarkerJsonDirty(true); setMarkerJsonDraft(e.target.value); }}
                    placeholder={'{\n  "tracks": [\n    { "start": 0, "end": 187.4, "name": "Track One" }\n  ]\n}'}
                  />
                  <div className={styles.markerJsonActions}>
                    <button type="button" className={styles.fetchBtn} onClick={applyMarkerJson} disabled={!markerJsonDraft.trim()}>
                      Apply to waveform
                    </button>
                    <button type="button" className={styles.clearBtn} onClick={copyMarkerJson} disabled={!markerJsonDraft.trim()}>
                      Copy
                    </button>
                    <button type="button" className={styles.clearBtn} onClick={downloadMarkerJson} disabled={!markerJsonDraft.trim()}>
                      Download .json
                    </button>
                    {markerJsonDirty && (
                      <>
                        <button type="button" className={styles.linkBtn} onClick={resetMarkerJson}>
                          Reset to current markers
                        </button>
                        <span className={styles.markerJsonDirtyTag}>Edited — not applied yet</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Controls / Keybinds help */}
              <div className={styles.controlsHelpBox}>
                <strong>Keybinds/Shortcuts:</strong>
                <span><kbd>Space</kbd> Play / Pause</span>
                <span className={styles.controlsSep}>|</span>
                <span><kbd>←</kbd> / <kbd>→</kbd> Skip 5s</span>
                <span className={styles.controlsSep}>|</span>
                <span><kbd>Shift</kbd>+<kbd>←</kbd> / <kbd>→</kbd> Prev / Next track boundary</span>
                <span className={styles.controlsSep}>|</span>
                <span><kbd>↑</kbd> / <kbd>↓</kbd> Zoom in / out</span>
              </div>

              {/* peaks.js Waveform */}
              <div className={styles.waveContainer}>
                {isLoadingWaveform && (
                  <div className={styles.waveLoading}><div className={styles.spinner} /><span>{waveformLoadStatus || "Loading waveform…"}</span></div>
                )}
                <div className={styles.zoomviewWrap}>
                  <div ref={zoomviewRef} className={styles.zoomview} />
                  {/* Boundary handles overlay (above the waveform) */}
                  {(() => {
                    const range = viewRange.end - viewRange.start;
                    if (!range || !zoomviewWidth || tracks.length === 0) return null;
                    const timeToX = (t) => ((t - viewRange.start) / range) * zoomviewWidth;
                    // Read live segment times from peaks during a drag, falling back to React state
                    const liveTime = (trackId, field) => {
                      const seg = peaksRef.current?.segments?.getSegment?.(trackId);
                      if (seg) return field === 'endTime' ? seg.endTime : seg.startTime;
                      const t = tracks.find(x => x.id === trackId);
                      return t ? t[field] : 0;
                    };
                    const EPS = 0.02;
                    const handles = [];
                    for (let i = 0; i < tracks.length - 1; i++) {
                      const a = tracks[i];
                      const b = tracks[i + 1];
                      const aEnd = liveTime(a.id, 'endTime');
                      const bStart = liveTime(b.id, 'startTime');
                      const shared = Math.abs(aEnd - bStart) < EPS;
                      if (shared) {
                        const x = timeToX(aEnd);
                        if (x < -20 || x > zoomviewWidth + 20) continue;
                        const ds = dragStateRef.current;
                        const isDragging = ds && ds.idxLeft === i && ds.idxRight === i + 1;
                        const splitDir = isDragging && ds.mode === 'joint-split' ? ds.splitDir : null;
                        handles.push(
                          <div key={`joint-${a.id}-${b.id}`} className={styles.boundaryHandle} style={{ left: x }}>
                            <div
                              className={styles.boundaryBar}
                              title="Drag to move both boundaries together"
                              onMouseDown={(ev) => beginBoundaryDrag(ev, 'joint-move', i, i + 1)}
                            />
                            <div
                              className={`${styles.boundaryLeg} ${splitDir === 'left' ? styles.boundaryLegLeft : ''} ${splitDir === 'right' ? styles.boundaryLegRight : ''}`}
                              title="Drag left/right to split into separate start/end"
                              onMouseDown={(ev) => beginBoundaryDrag(ev, 'joint-split', i, i + 1)}
                            />
                          </div>
                        );
                      } else {
                        // Two separate handles
                        const xL = timeToX(aEnd);
                        const xR = timeToX(bStart);
                        if (xL >= -20 && xL <= zoomviewWidth + 20) {
                          handles.push(
                            <div key={`solo-end-${a.id}`} className={`${styles.boundaryHandle} ${styles.boundarySolo}`} style={{ left: xL }}>
                              <div
                                className={styles.boundaryBar}
                                title={`Drag to move "${a.name}" end`}
                                onMouseDown={(ev) => beginBoundaryDrag(ev, 'solo-end', i, null)}
                              />
                              <div className={styles.boundaryLeg} onMouseDown={(ev) => beginBoundaryDrag(ev, 'solo-end', i, null)} />
                            </div>
                          );
                        }
                        if (xR >= -20 && xR <= zoomviewWidth + 20) {
                          handles.push(
                            <div key={`solo-start-${b.id}`} className={`${styles.boundaryHandle} ${styles.boundarySolo}`} style={{ left: xR }}>
                              <div
                                className={styles.boundaryBar}
                                title={`Drag to move "${b.name}" start`}
                                onMouseDown={(ev) => beginBoundaryDrag(ev, 'solo-start', null, i + 1)}
                              />
                              <div className={styles.boundaryLeg} onMouseDown={(ev) => beginBoundaryDrag(ev, 'solo-start', null, i + 1)} />
                            </div>
                          );
                        }
                      }
                    }
                    return <div className={styles.boundaryOverlay}>{handles}</div>;
                  })()}
                </div>
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
                      ) : (
                        <>⚡ Click to auto find all silences (ignore track count)</>
                      )}
                    </button>
                    {isAnalyzing && (
                      <button className={styles.cancelBtn} onClick={() => { cancelRef.current = true; setIsAnalyzing(false); setMessage("Cancelled"); }}>Cancel</button>
                    )}
                  </div>
                  <span className={styles.autoSplitHint}>
                    Will place a split at every detected silence
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
                  <label className={styles.silenceParamLabel}>
                    Min track length
                    <input type="number" className={styles.silenceParamInput} value={silMinTrackLen} onChange={e => setSilMinTrackLen(Math.max(0, parseFloat(e.target.value) || 0))} min="0" max="600" step="1" />
                    <span className={styles.silenceParamUnit}>sec</span>
                  </label>
                  <span className={styles.silenceParamHint}>Lower threshold = quieter silence. Increase min silence or min track length for fewer splits.</span>
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
                <button
                  className={styles.skipBtn}
                  onClick={() => setStep(4)}
                  title="Skip the waveform editor and go straight to the audio step"
                >
                  Skip →
                </button>
                <button className={styles.nextBtn} disabled={!canExport} onClick={() => setStep(4)}>Next: Export →</button>
              </div>
          </div>

          {/* ---- STEP 4 ---- */}
          {step === 4 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Step 4: Export</h2>

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
                            <td onClick={e => e.stopPropagation()}>
                              <input
                                type="text"
                                className={styles.trackNameInput}
                                value={trackNames[i] ?? track.name ?? ""}
                                onChange={e => {
                                  const v = e.target.value;
                                  setTrackNames(prev => {
                                    const n = [...prev];
                                    while (n.length <= i) n.push("");
                                    n[i] = v;
                                    return n;
                                  });
                                }}
                              />
                            </td>
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
              {/* Track export spins up its own FFmpeg instance. It's audio-only
                  and far lighter than a video encode, so it isn't queued — but
                  say so, since both are competing for the same wasm heap. */}
              {queueActive.some(j => j.status === "running") && !isExporting && (
                <div className={styles.renderWarning} style={{background: darkMode ? "#3a2a1a" : "#fffaf0", borderColor: darkMode ? "#6b4d2d" : "#fbd38d", color: darkMode ? "#fbd38d" : "#c05621"}}>
                  A video render is running in the background. Exporting now is usually fine (audio export uses far less memory), but a very long rip may run the browser out of memory — wait for the render if you hit an error.
                </div>
              )}
              <div className={styles.exportRow}>
                <button className={styles.exportBtn} onClick={exportTracks} disabled={isExporting || !canExport || selectedTracks.size === 0}>
                  {isExporting ? "Exporting…" : `Export ${outputFormat.toUpperCase()} (${selectedTracks.size}/${tracks.length})`}
                </button>
                {isExporting && <button className={styles.cancelBtn} onClick={cancelExport}>Cancel</button>}
                {exportedFiles.length > 0 && (
                  <button className={styles.zipBtn} onClick={downloadZip}>Download as ZIP ({exportedFiles.length})</button>
                )}
              </div>
              <p className={styles.exportHint}>Export audio first before you use it to render a video.</p>

              {/* Progress */}
              {(progress !== null || exportProgress) && (
                <div className={styles.exportProg}>
                  {exportProgress && <p className={styles.exportProgLabel}>{exportProgress.name} ({exportProgress.current}/{exportProgress.total})</p>}
                  {progress !== null && <div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progress * 100}%` }} /></div>}
                </div>
              )}
              {message && <p className={styles.msg}>{message}</p>}

              {/* Exported grid — copies made in Step 5 share a source file, so
                  they aren't separate downloads here. */}
              {exportedFiles.length > 0 && (
                <div className={styles.exportGrid}>
                  {exportedFiles.map(t => (
                    <div key={t.uid || t.index} className={styles.exportCard}>
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
                <button className={styles.backBtn} onClick={() => setStep(3)}>← Back to Waveform</button>
                <button className={styles.nextBtn} onClick={() => setStep(5)}>Next: Video →</button>
              </div>
            </div>
          )}

          {/* ---- STEP 5 ---- */}
          {step === 5 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Step 5: Video</h2>

              {/* Nothing on this step works without exported audio, and the
                  step bar lets you jump straight here — so say what's missing
                  rather than showing an empty audio table. */}
              {exportedTracks.length === 0 && (
                <div className={styles.renderWarning} style={{
                  background: darkMode ? "#3a2a1a" : "#fffaf0",
                  borderColor: darkMode ? "#6b4d2d" : "#fbd38d",
                  color: darkMode ? "#fbd38d" : "#c05621",
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                }}>
                  <span>
                    <b>No exported audio yet.</b> Go back to Step 4 and run the export
                    {outputFormat === "flac" ? " (FLAC)" : ` (${outputFormat.toUpperCase()})`} —
                    the video is built from those track files.
                  </span>
                  <button type="button" className={styles.fetchBtn} onClick={() => setStep(4)}>
                    ← Back to Step 4
                  </button>
                </div>
              )}

              {/* Bulk clears — each section also has its own button; this row
                  is the one place that can wipe everything at once. */}
              {(exportedTracks.length > 0 || videoImages.length > 0 || renderedVideoSrc) && (
                <div className={styles.clearBar}>
                  <span className={styles.clearBarLabel}>Clear:</span>
                  <button type="button" className={styles.clearBtn}
                    onClick={clearAllVideoTables}
                    disabled={exportedTracks.length === 0 && videoImages.length === 0}
                    title="Remove every audio track and image from this video">
                    All tables
                  </button>
                  <button type="button" className={styles.clearBtn}
                    onClick={clearVideoAudioTable}
                    disabled={exportedTracks.length === 0}
                    title="Remove every audio track from this video">
                    Audio tracks{exportedTracks.length > 0 ? ` (${exportedTracks.length})` : ""}
                  </button>
                  <button type="button" className={styles.clearBtn}
                    onClick={clearVideoImageTable}
                    disabled={videoImages.length === 0}
                    title="Remove every image from this video">
                    Images{videoImages.length > 0 ? ` (${videoImages.length})` : ""}
                  </button>
                  <button type="button" className={`${styles.clearBtn} ${styles.clearBtnDanger}`}
                    onClick={clearRenderedVideo}
                    disabled={!renderedVideoSrc}
                    title="Delete the rendered .mp4 from browser storage">
                    Rendered video
                  </button>
                </div>
              )}

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
                <div className={styles.sectionTitleRow}>
                  <h3 className={styles.sectionTitle}>Audio Tracks ({selectedVideoAudios.size}/{exportedTracks.length} selected)</h3>
                  {exportedTracks.length > 0 && (
                    <div className={styles.audioSortRow}>
                      <label className={styles.audioSortLabel}>
                        Sort
                        <select className={styles.inputSmall} style={{ width: 150, textAlign: "left" }}
                          value={audioSortMode}
                          onChange={e => sortVideoAudio(e.target.value)}>
                          <option value="title-asc">Filename (A→Z)</option>
                          <option value="title-desc">Filename (Z→A)</option>
                          <option value="index">Export order</option>
                          <option value="manual" disabled>Manual (dragged)</option>
                        </select>
                      </label>
                      <button type="button" className={styles.clearBtn} onClick={clearVideoAudioTable}>Clear table</button>
                    </div>
                  )}
                </div>
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
                          <th>#</th>
                          <th
                            className={styles.sortableTh}
                            title="Sort by filename"
                            onClick={() => sortVideoAudio(audioSortMode === "title-asc" ? "title-desc" : "title-asc")}
                          >
                            Filename{audioSortMode === "title-asc" ? " ▲" : audioSortMode === "title-desc" ? " ▼" : ""}
                          </th>
                          <th>Duration</th>
                          <th title="Pin an image to this track. The image then covers exactly this track's start → end on the timeline.">Image</th>
                          <th style={{width:90}}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(videoAudioOrder.length === exportedTracks.length ? videoAudioOrder : exportedTracks.map((_, i) => i)).map((trackIdx, orderIdx) => {
                          const t = exportedTracks[trackIdx];
                          const range = getTrackClipRange(trackIdx) || { fullDur: t.end - t.start, durKnown: t.end - t.start > 0, clipStart: 0, clipEnd: t.end - t.start, clipDur: t.end - t.start, isClipped: false };
                          const isExpanded = expandedAudioRows.has(trackIdx);
                          return (
                            <React.Fragment key={trackIdx}>
                              <tr
                                draggable
                                onDragStart={() => handleAudioDragStart(orderIdx)}
                                onDragOver={e => handleAudioDragOver(e, orderIdx)}
                                onDragEnd={handleAudioDragEnd}
                                className={`${styles.clickableRow} ${styles.draggableRow} ${!selectedVideoAudios.has(trackIdx) ? styles.rowDimmed : ""}`}
                                onClick={e => { if (e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON") toggleVideoAudio(trackIdx); }}
                              >
                                <td className={styles.dragHandle} onClick={e => e.stopPropagation()}>⠿</td>
                                <td className={styles.chkCol} onClick={e => e.stopPropagation()}>
                                  <input type="checkbox" checked={selectedVideoAudios.has(trackIdx)} onChange={() => toggleVideoAudio(trackIdx)} />
                                </td>
                                <td>{orderIdx + 1}</td>
                                <td className={styles.audioFilenameCell} title={t.title && t.title !== t.name ? `Track title: ${t.title}` : t.name}>
                                  {t.name || t.title}
                                  {t.copyOf && <span className={styles.copyBadge} title="A copy of another row — same audio file, its own clip range and image"> · copy</span>}
                                  {range.isClipped && <span className={styles.clipBadge} title={`Clipped to ${formatTime(range.clipStart)} – ${formatTime(range.clipEnd)}`}> · clip</span>}
                                </td>
                                <td>
                                  {!range.durKnown
                                    ? <span className={styles.durUnknown} title="Couldn't read this file's length from its header. Type a start and end time to clip it anyway.">unknown</span>
                                    : range.isClipped ? `${formatTime(range.clipDur)} / ${formatTime(range.fullDur)}` : formatTime(range.fullDur)}
                                </td>
                                <td onClick={e => e.stopPropagation()}>
                                  {(() => {
                                    const pickable = videoImages.filter(im => selectedVideoImages.has(im.id));
                                    const assignedId = trackImageAssign[trackIdx] || "";
                                    const assigned = pickable.find(im => im.id === assignedId);
                                    return (
                                      <div className={styles.trackImagePick}>
                                        {assigned?.thumbUrl && !assigned.loading && <img src={assigned.thumbUrl} alt="" className={styles.trackImagePickThumb} />}
                                        <select
                                          className={styles.inputSmall}
                                          style={{ width: 130, textAlign: "left" }}
                                          value={assigned ? assignedId : ""}
                                          disabled={pickable.length === 0}
                                          title={pickable.length === 0 ? "Select at least one image below first" : "Show this image for this track only"}
                                          onChange={e => {
                                            const v = e.target.value;
                                            setTrackImageAssign(prev => {
                                              const next = { ...prev };
                                              if (v) next[trackIdx] = v; else delete next[trackIdx];
                                              return next;
                                            });
                                            // Pinning an image only means anything when images follow
                                            // the tracks, so switch the slideshow over automatically.
                                            if (v && slideshowMode !== "per-track") setSlideshowMode("per-track");
                                          }}
                                        >
                                          <option value="">Auto</option>
                                          {pickable.map((im, k) => (
                                            <option key={im.id} value={im.id}>{k + 1}. {im.file.name}</option>
                                          ))}
                                        </select>
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td onClick={e => e.stopPropagation()}>
                                  <div className={styles.rowActions}>
                                    <button
                                      type="button"
                                      className={styles.expandRowBtn}
                                      onClick={() => duplicateAudioRow(trackIdx, orderIdx)}
                                      title="Copy this row — same audio file, its own clip range and image, so you can render several videos from one file"
                                      aria-label="Copy this row"
                                    >⧉</button>
                                    <button
                                      type="button"
                                      className={`${styles.expandRowBtn} ${styles.removeRowBtn}`}
                                      onClick={() => removeAudioRow(trackIdx)}
                                      title="Remove this row from the video"
                                      aria-label="Remove this row"
                                    >×</button>
                                    <button
                                      type="button"
                                      className={styles.expandRowBtn}
                                      onClick={() => setExpandedAudioRows(prev => { const n = new Set(prev); n.has(trackIdx) ? n.delete(trackIdx) : n.add(trackIdx); return n; })}
                                      title={isExpanded ? "Hide clip controls" : "Set clip range"}
                                      aria-label={isExpanded ? "Hide clip controls" : "Set clip range"}
                                    >{isExpanded ? "▾" : "▸"}</button>
                                  </div>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className={styles.clipPanelRow}>
                                  <td colSpan={7} onClick={e => e.stopPropagation()}>
                                    <TrackClipPanel
                                      track={t}
                                      range={range}
                                      onChange={(start, end) => setTrackClips(prev => ({ ...prev, [trackIdx]: { start, end } }))}
                                      onReset={() => setTrackClips(prev => { const n = { ...prev }; delete n[trackIdx]; return n; })}
                                    />
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
                {exportedTracks.length > 0 && (
                  <p className={styles.hintText} style={{ marginTop: 6 }}>
                    Use ⧉ to copy a row. The copy points at the same audio file but keeps its own clip range,
                    image and caption — that&apos;s how you get several videos out of one long recording.
                  </p>
                )}
                {exportedTracks.length > 0 && (() => {
                  // A pin whose image was deselected or removed is inert, so only
                  // count the ones that actually affect the timeline.
                  const livePins = Object.values(trackImageAssign).filter(id => selectedVideoImages.has(id)).length;
                  const pickableCount = videoImages.filter(im => selectedVideoImages.has(im.id)).length;
                  return (
                  <div style={{ marginTop: 8 }}>
                    <div className={styles.pinActionsRow}>
                      <button
                        type="button"
                        className={styles.clearBtn}
                        onClick={autoAssignTrackImages}
                        disabled={pickableCount === 0 || exportedTracks.length === 0}
                        title={pickableCount === 0
                          ? "Select at least one image below first"
                          : "Pin an image to every selected track, cycling through the selected images in order"}
                      >
                        Auto-assign images
                      </button>
                      {livePins > 0 && (
                        <button type="button" className={styles.clearBtn} onClick={() => setTrackImageAssign({})}>
                          Clear all pins
                        </button>
                      )}
                    </div>
                    <p className={styles.hintText} style={{ marginTop: 6 }}>
                      {livePins > 0 ? (
                        <>
                          {livePins} track{livePins === 1 ? " has" : "s have"} a pinned image — each pinned image is shown for exactly that track&apos;s start → end.
                          {slideshowMode !== "per-track" && " Switch Slideshow to “Sync with tracks” for pins to take effect."}
                        </>
                      ) : (
                        "Set a track's Image to pin it — that image then covers exactly that track on the timeline. Leave it on Auto to keep cycling through the selected images."
                      )}
                    </p>
                  </div>
                  );
                })()}
              </div>

              {/* Images */}
              <div className={styles.videoSection}>
                <div className={styles.sectionTitleRow}>
                  <h3 className={styles.sectionTitle}>Images ({selectedVideoImages.size}/{videoImages.length} selected)</h3>
                  {videoImages.length > 0 && (
                    <button type="button" className={styles.clearBtn} onClick={clearVideoImageTable}>Clear table</button>
                  )}
                </div>
                <div className={styles.videoImgActions}>
                  <button className={styles.fetchBtn} onClick={() => setShowImageModal(true)}>+ Add Image</button>
                  {discogsData?.images?.length > 0 && (
                    <button className={styles.fetchBtn} onClick={fetchDiscogsImage} disabled={!!discogsArtStatus}>
                      {discogsArtStatus ? "Fetching…" : `Use Discogs Art (${discogsData.images.length})`}
                    </button>
                  )}
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
                {/* Timing / motion controls — these drive the columns below, so they
                    sit directly on top of the table rather than off in the button row. */}
                <div className={styles.slideshowBar}>
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
                  {/* Bulk motion — per-image motion lives under each image's preview */}
                  <label className={styles.videoCheckLabel} style={{display:"flex",alignItems:"center",gap:4}}>
                    Motion (all):
                    <select className={styles.inputSmall}
                      value={videoImages.length > 0 && videoImages.every(im => (im.motion || "none") === (videoImages[0].motion || "none")) ? (videoImages[0].motion || "none") : ""}
                      onChange={e => { const v = e.target.value; if (v) setVideoImages(prev => prev.map(im => ({ ...im, motion: v }))); }}
                      style={{minWidth:150}}
                    >
                      <option value="" disabled>Mixed…</option>
                      {IMAGE_MOTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </label>
                  {anySelectedImageMotion && (
                    <label className={styles.videoCheckLabel} style={{display:"flex",alignItems:"center",gap:4}} title="Motion has to be encoded at a real frame rate. Lower = much faster render.">
                      Motion fps:
                      <select className={styles.inputSmall} value={motionFps} onChange={e => setMotionFps(parseInt(e.target.value) || 24)} style={{width:70}}>
                        {[12, 15, 24, 30].map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                {anySelectedImageMotion && (
                  <p className={styles.hintText} style={{marginTop:6}}>
                    Motion effects encode every frame at {motionFps} fps instead of 2 — expect a noticeably longer render.
                    {slideshowMode === "loop" && " In loop mode only one cycle is encoded and then repeated, so this stays cheap."}
                  </p>
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
                          // First slot the image occupies — in loop mode it gets several.
                          const timing = rowTimings.find(t => t.id === img.id);
                          const showCount = rowTimings.filter(t => t.id === img.id).length;
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
                                <td>
                                  {/* The row is inserted as soon as the file is
                                      picked, before its thumbnail exists — render
                                      a spinner rather than a broken <img>. */}
                                  {img.loading || !img.thumbUrl ? (
                                    <div className={styles.videoThumbPlaceholder}>
                                      <span className={styles.fileLoadingSpinner} style={{ borderTopColor: "#48bb78" }} />
                                    </div>
                                  ) : (
                                    <img src={img.thumbUrl} alt={img.file.name} className={styles.videoThumb} />
                                  )}
                                </td>
                                <td className={styles.filenameCell}>
                                  <div>{img.file.name}</div>
                                  <div style={{ fontSize: "0.72rem", opacity: 0.7, marginTop: 2 }}>
                                    {img.loading ? (
                                      <span className={styles.fileStatusLoading}>
                                        <span className={styles.fileLoadingSpinner} />
                                        <span>Loading…</span>
                                      </span>
                                    ) : (
                                      <>
                                        {img.file.size ? formatBytes(img.file.size) : "—"}
                                        {(img.naturalWidth && img.naturalHeight) ? ` · ${img.naturalWidth}×${img.naturalHeight}` : ""}
                                        {showCount > 1 ? ` · shown ${showCount}×` : ""}
                                        {(img.motion && img.motion !== "none") ? ` · ${IMAGE_MOTIONS.find(m => m.value === img.motion)?.short} ${clampMotionSpeed(img.motionSpeed)}×` : ""}
                                        {(img.useBlurBg && (img.bgMotion || "none") !== "none") ? ` · ${BG_MOTIONS.find(m => m.value === img.bgMotion)?.short} ${clampMotionSpeed(img.bgMotionSpeed)}×` : ""}
                                      </>
                                    )}
                                  </div>
                                </td>
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
                                  {/* Always render the padding controls so the column keeps a
                                      constant width. When padding doesn't apply (blur bg or
                                      stretch), dim + disable them instead of collapsing to "—",
                                      which would reflow the whole table. */}
                                  {(() => {
                                    const disabled = img.useBlurBg || img.stretchToFit;
                                    return (
                                      <div
                                        className={styles.paddingColorRow}
                                        style={disabled ? { opacity: 0.35, pointerEvents: "none" } : undefined}
                                        aria-disabled={disabled}
                                      >
                                        <input type="color" value={img.paddingColor} disabled={disabled} onChange={e => updateVideoImage(img.id, "paddingColor", e.target.value)} className={styles.colorPicker} />
                                        {["#000000", "#ffffff", "#1a1a2e", "#16213e", "#0f3460"].map(c => (
                                          <span key={c} onClick={() => !disabled && updateVideoImage(img.id, "paddingColor", c)} title={c}
                                            className={styles.colorSwatch}
                                            style={{ background: c, border: img.paddingColor === c ? "2px solid #4299e1" : "1px solid #718096" }} />
                                        ))}
                                      </div>
                                    );
                                  })()}
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
                              {expandedImgPreviews.has(img.id) && (() => {
                                const motion = img.motion || "none";
                                const bgMotion = img.bgMotion || "none";
                                const motionSpeed = clampMotionSpeed(img.motionSpeed);
                                const bgSpeed = clampMotionSpeed(img.bgMotionSpeed);
                                const bgBlur = clampBgBlur(img.bgBlur);
                                // Animate the preview over the segment's real on-screen
                                // duration so what you see matches what gets rendered.
                                const segDur = Math.min(20, Math.max(2, timing ? timing.endTime - timing.startTime : 6));
                                const motionClass = MOTION_PREVIEW_CLASS[motion];
                                return (
                                <tr>
                                  <td colSpan={12} className={styles.imgPreviewRow}>
                                    {/* Shaped by the output resolution rather than the
                                        table width — a 1:1 sleeve rendered into a 16:9
                                        video looked nothing like this preview when the
                                        preview was simply as wide as the table. */}
                                    <div className={styles.imgPreviewFrame}>
                                      <div
                                        className={styles.imgPreviewWrap}
                                        style={{
                                          aspectRatio: `${concatDimensions.w} / ${concatDimensions.h}`,
                                          background: img.useBlurBg ? "transparent" : (img.paddingColor || videoBgColor),
                                        }}
                                      >
                                      <div
                                        className={`${styles.motionStage} ${motionClass ? styles[motionClass] : ""}`}
                                        style={motionClass ? {
                                          animationDuration: `${(segDur / motionSpeed).toFixed(2)}s`,
                                          // Above 1× the render sweeps back within the
                                          // segment; at or below it never reverses.
                                          animationDirection: motionSpeed > 1 ? "alternate" : "normal",
                                        } : undefined}
                                      >
                                        {img.useBlurBg && (
                                          <div
                                            className={`${styles.imgPreviewBlurBg} ${bgMotion === "drift" ? styles.bgDrift : ""}`}
                                            style={{
                                              backgroundImage: `url(${img.previewUrl})`,
                                              // Proportional to the render's blur so the slider visibly does
                                              // the same thing here as it does in the output.
                                              filter: `blur(${(18 * bgBlur / 100).toFixed(1)}px) brightness(0.7)`,
                                              ...(bgMotion === "drift" ? { animationDuration: `${(BG_DRIFT_PERIOD / bgSpeed).toFixed(2)}s` } : {}),
                                            }}
                                          />
                                        )}
                                        <img
                                          src={img.previewUrl}
                                          alt={img.file.name}
                                          className={styles.imgPreviewImg}
                                          style={{ objectFit: img.stretchToFit ? "fill" : "contain" }}
                                        />
                                        </div>
                                      </div>
                                      <div className={styles.imgPreviewFrameCap}>
                                        Output frame — {concatDimensions.w}×{concatDimensions.h}
                                        {img.naturalWidth ? ` · source ${img.naturalWidth}×${img.naturalHeight}` : ""}
                                      </div>
                                    </div>
                                    {/* Movement options — foreground and background are
                                        separate groups so changing one never touches the other. */}
                                    <div className={styles.motionControls} onClick={e => e.stopPropagation()}>
                                      <div className={styles.motionGroup}>
                                        <span className={styles.motionGroupTitle}>Image movement</span>
                                        <div className={styles.motionGroupRow}>
                                          <label className={styles.motionControlLabel}>
                                            Movement
                                            <select className={styles.inputSmall} value={motion}
                                              onChange={e => updateVideoImage(img.id, "motion", e.target.value)}>
                                              {IMAGE_MOTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                            </select>
                                          </label>
                                          <label className={styles.motionControlLabel} title="1× completes the move exactly as the image leaves the screen. Higher sweeps back and forth; lower covers less ground.">
                                            Speed — {motionSpeed}×
                                            <input type="range" className={styles.motionSlider}
                                              min={MOTION_SPEED_MIN} max={MOTION_SPEED_MAX} step={MOTION_SPEED_STEP}
                                              value={motionSpeed} disabled={motion === "none"}
                                              onChange={e => updateVideoImage(img.id, "motionSpeed", clampMotionSpeed(e.target.value))} />
                                          </label>
                                          <button type="button" className={styles.applyAllBtn}
                                            title="Apply this image movement + speed to every image (leaves backgrounds alone)"
                                            onClick={() => setVideoImages(prev => prev.map(im => ({ ...im, motion, motionSpeed })))}
                                          >Apply to all</button>
                                        </div>
                                      </div>
                                      {img.useBlurBg && (
                                        <div className={styles.motionGroup}>
                                          <span className={styles.motionGroupTitle}>Blurred background</span>
                                          <div className={styles.motionGroupRow}>
                                            <label className={styles.motionControlLabel}>
                                              Movement
                                              <select className={styles.inputSmall} value={bgMotion}
                                                onChange={e => updateVideoImage(img.id, "bgMotion", e.target.value)}>
                                                {BG_MOTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                              </select>
                                            </label>
                                            <label className={styles.motionControlLabel} title={`Drift cycle: ${(BG_DRIFT_PERIOD / bgSpeed).toFixed(0)}s. Independent of the image movement speed.`}>
                                              Speed — {bgSpeed}×
                                              <input type="range" className={styles.motionSlider}
                                                min={MOTION_SPEED_MIN} max={MOTION_SPEED_MAX} step={MOTION_SPEED_STEP}
                                                value={bgSpeed} disabled={bgMotion === "none"}
                                                onChange={e => updateVideoImage(img.id, "bgMotionSpeed", clampMotionSpeed(e.target.value))} />
                                            </label>
                                            <button type="button" className={styles.applyAllBtn}
                                              title="Apply this background movement + speed to every image (leaves image movement alone)"
                                              onClick={() => setVideoImages(prev => prev.map(im => ({ ...im, bgMotion, bgMotionSpeed: bgSpeed })))}
                                            >Apply to all</button>
                                          </div>
                                          <div className={styles.motionGroupRow}>
                                            <label className={styles.motionControlLabel}
                                              title="How hard the background copy is blurred. 0 leaves it sharp, which turns the backdrop into a zoomed-in crop of the image.">
                                              Blur — {bgBlur === 0 ? "off" : `${bgBlur}%`}
                                              <input type="range" className={styles.motionSlider}
                                                min="0" max={BG_BLUR_MAX} step="5" value={bgBlur}
                                                onChange={e => updateVideoImage(img.id, "bgBlur", clampBgBlur(e.target.value))} />
                                            </label>
                                            <button type="button" className={styles.applyAllBtn}
                                              title="Apply this blur amount to every image"
                                              onClick={() => setVideoImages(prev => prev.map(im => ({ ...im, bgBlur })))}
                                            >Apply to all</button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                    <p className={styles.hintText} style={{marginTop:4}}>
                                      {img.useBlurBg ? `Blur background · ${bgBlur === 0 ? "no blur" : `${bgBlur}% blur`}` : img.stretchToFit ? "Stretch to fit" : `Letterbox · padding: ${img.paddingColor || videoBgColor}`}
                                      {motion !== "none" && ` · ${IMAGE_MOTIONS.find(m => m.value === motion)?.label.toLowerCase()} at ${motionSpeed}× over ${Math.round(segDur)}s`}
                                      {img.useBlurBg && bgMotion === "drift" && ` · background drifts on a ${(BG_DRIFT_PERIOD / bgSpeed).toFixed(0)}s cycle`}
                                    </p>
                                  </td>
                                </tr>
                                );
                              })()}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Text overlay — burned into the video over each image */}
              <div className={styles.videoSection}>
                <h3 className={styles.sectionTitle}>Text Overlay</h3>
                {/* The one text switch for the whole step. The batch panel shows
                    this same control, bound to this same state, so the concat
                    render and the batch videos always say the same thing. */}
                <label className={styles.settingLabel} style={{ maxWidth: 380 }}>
                  Text on the video
                  <select className={styles.input} value={sharedTextMode} onChange={e => setSharedTextMode(e.target.value)}>
                    {TEXT_MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <span className={styles.settingHelp}>
                    Applies to both render modes — the concat video and every batch video.
                  </span>
                </label>
                {!textOverlay.enabled && (
                  <p className={styles.hintText} style={{ marginTop: 6 }}>
                    Burns the song name (or any text you choose) into the video over each image.
                  </p>
                )}
                {textOverlay.enabled && (() => {
                  const set = (key) => (value) => setTextOverlay(o => ({ ...o, [key]: value }));
                  const num = (key, parse = parseFloat) => (e) => {
                    const v = parse(e.target.value);
                    setTextOverlay(o => ({ ...o, [key]: isNaN(v) ? o[key] : v }));
                  };
                  const orderedAudios = getOrderedAudios();
                  const pickableImgs = videoImages.filter(im => selectedVideoImages.has(im.id));
                  return (
                    <>
                      <div className={styles.overlayGrid}>
                        {textOverlay.source === "custom" && (
                          <label className={styles.settingLabel} style={{ gridColumn: "span 2" }}>
                            Custom text
                            <input
                              type="text"
                              className={styles.input}
                              value={textOverlay.customText}
                              placeholder={projectName || "Your text here"}
                              onChange={e => set("customText")(e.target.value)}
                            />
                          </label>
                        )}
                        <label className={styles.settingLabel}>
                          Font
                          <select className={styles.input} value={textOverlay.fontFamily} onChange={e => set("fontFamily")(e.target.value)}>
                            {OVERLAY_FONTS.map(f => <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
                          </select>
                        </label>
                        <label className={styles.settingLabel}>
                          Size — {textOverlay.fontSize}% of height ({Math.round((textOverlay.fontSize / 100) * (parseInt(videoHeight) || 1080))}px)
                          <input type="range" min="1" max="20" step="0.25" value={textOverlay.fontSize} onChange={num("fontSize")} />
                        </label>
                        <label className={styles.settingLabel}>
                          Weight
                          <select className={styles.input} value={textOverlay.fontWeight} onChange={num("fontWeight", v => parseInt(v, 10))}>
                            <option value={300}>Light</option>
                            <option value={400}>Regular</option>
                            <option value={600}>Semibold</option>
                            <option value={700}>Bold</option>
                            <option value={900}>Black</option>
                          </select>
                        </label>
                        <label className={styles.settingLabel}>
                          Text color
                          <input type="color" className={styles.colorPicker} value={textOverlay.color} onChange={e => set("color")(e.target.value)} />
                        </label>
                        <label className={styles.settingLabel}>
                          Position
                          <select className={styles.input} value={textOverlay.position} onChange={e => set("position")(e.target.value)}>
                            {OVERLAY_POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                          </select>
                        </label>
                        <label className={styles.settingLabel}>
                          Edge margin — {textOverlay.marginX}% / {textOverlay.marginY}%
                          <div style={{ display: "flex", gap: 6 }}>
                            <input type="range" min="0" max="25" step="0.5" value={textOverlay.marginX} onChange={num("marginX")} title="Horizontal margin" />
                            <input type="range" min="0" max="25" step="0.5" value={textOverlay.marginY} onChange={num("marginY")} title="Vertical margin" />
                          </div>
                        </label>
                        <label className={styles.settingLabel}>
                          Max text width — {textOverlay.maxWidthPct}%
                          <input type="range" min="20" max="100" step="1" value={textOverlay.maxWidthPct} onChange={num("maxWidthPct")} />
                        </label>
                        <label className={styles.settingLabel}>
                          Show text for
                          <select className={styles.input} value={textOverlay.durationMode} onChange={e => set("durationMode")(e.target.value)}>
                            <option value="full">The whole time the image is up</option>
                            <option value="seconds">Only the first few seconds</option>
                          </select>
                          <span className={styles.settingHelp}>
                            {textOverlay.durationMode === "full"
                              ? (overlayTextVaries
                                  ? "Each song's name stays up for that whole track."
                                  : "The text stays up for the whole video.")
                              : "Counted from the moment each image appears, then the text disappears."}
                          </span>
                        </label>
                        {textOverlay.durationMode === "seconds" && (
                          <label className={styles.settingLabel}>
                            Seconds visible
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input
                                type="number"
                                className={styles.inputSmall}
                                style={{ width: 90 }}
                                min="0.5"
                                max="600"
                                step="0.5"
                                value={textOverlay.durationSeconds}
                                onChange={e => {
                                  const v = parseFloat(e.target.value);
                                  setTextOverlay(o => ({ ...o, durationSeconds: isNaN(v) ? o.durationSeconds : Math.min(600, Math.max(0.5, v)) }));
                                }}
                              />
                              <span style={{ fontSize: "0.78rem", opacity: 0.75, fontWeight: 400 }}>seconds</span>
                            </div>
                            <span className={styles.settingHelp}>
                              {(() => {
                                // Show it against the shortest segment, since that's
                                // where a long window silently becomes "full".
                                const durs = rowTimings.map(t => t.endTime - t.startTime).filter(d => d > 0);
                                const shortest = durs.length ? Math.min(...durs) : null;
                                if (shortest == null) return "Applies to every image in the video.";
                                return textOverlay.durationSeconds >= shortest
                                  ? `Longer than the shortest image slot (${formatTime(shortest)}), so there the text stays up the whole time.`
                                  : `Shortest image slot is ${formatTime(shortest)}, so the text clears well before it ends.`;
                              })()}
                            </span>
                          </label>
                        )}
                      </div>

                      <div className={styles.overlayGrid} style={{ marginTop: 4 }}>
                        <label className={styles.settingLabel}>
                          Background box
                          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
                            <input type="checkbox" checked={textOverlay.bgEnabled} onChange={e => set("bgEnabled")(e.target.checked)} />
                            <input type="color" className={styles.colorPicker} value={textOverlay.bgColor} disabled={!textOverlay.bgEnabled} onChange={e => set("bgColor")(e.target.value)} />
                          </span>
                        </label>
                        <label className={styles.settingLabel}>
                          Background opacity — {Math.round(textOverlay.bgOpacity * 100)}%
                          <input type="range" min="0" max="1" step="0.05" value={textOverlay.bgOpacity} disabled={!textOverlay.bgEnabled} onChange={num("bgOpacity")} />
                        </label>
                        <label className={styles.settingLabel}>
                          Box padding — {textOverlay.bgPadX}% / {textOverlay.bgPadY}%
                          <div style={{ display: "flex", gap: 6 }}>
                            <input type="range" min="0" max="8" step="0.1" value={textOverlay.bgPadX} disabled={!textOverlay.bgEnabled} onChange={num("bgPadX")} title="Horizontal padding" />
                            <input type="range" min="0" max="8" step="0.1" value={textOverlay.bgPadY} disabled={!textOverlay.bgEnabled} onChange={num("bgPadY")} title="Vertical padding" />
                          </div>
                        </label>
                        <label className={styles.settingLabel}>
                          Box corner radius — {textOverlay.bgRadius}%
                          <input type="range" min="0" max="6" step="0.1" value={textOverlay.bgRadius} disabled={!textOverlay.bgEnabled} onChange={num("bgRadius")} />
                        </label>
                        <label className={styles.settingLabel}>
                          Outline — {textOverlay.outlineWidth}%
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input type="range" min="0" max="12" step="0.5" value={textOverlay.outlineWidth} onChange={num("outlineWidth")} />
                            <input type="color" className={styles.colorPicker} value={textOverlay.outlineColor} onChange={e => set("outlineColor")(e.target.value)} />
                          </span>
                        </label>
                        <div className={styles.settingLabel}>
                          Style
                          <span style={{ display: "flex", gap: 12, fontWeight: 400, flexWrap: "wrap" }}>
                            <label className={styles.videoCheckLabel} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <input type="checkbox" checked={textOverlay.shadow} onChange={e => set("shadow")(e.target.checked)} /> Shadow
                            </label>
                            <label className={styles.videoCheckLabel} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <input type="checkbox" checked={textOverlay.italic} onChange={e => set("italic")(e.target.checked)} /> Italic
                            </label>
                            <label className={styles.videoCheckLabel} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <input type="checkbox" checked={textOverlay.uppercase} onChange={e => set("uppercase")(e.target.checked)} /> UPPERCASE
                            </label>
                          </span>
                        </div>
                      </div>

                      {/* Save / reset the look */}
                      <div className={styles.overlayDefaultsRow}>
                        <button type="button" className={styles.clearBtn} onClick={saveTextDefaults}
                          title="Remember these text settings and apply them to new projects">
                          Save as default
                        </button>
                        <button type="button" className={styles.clearBtn} onClick={resetTextToDefaults}
                          title={hasSavedTextDefaults ? "Go back to your saved default" : "Go back to the built-in default"}>
                          Reset to default
                        </button>
                        {hasSavedTextDefaults && (
                          <button type="button" className={styles.linkBtn} onClick={clearTextDefaults}
                            title="Forget your saved default and restore the built-in one">
                            Clear saved default
                          </button>
                        )}
                        <span className={styles.settingHelp}>
                          {hasSavedTextDefaults
                            ? "New projects start from your saved default."
                            : "New projects start from the built-in default."}
                        </span>
                      </div>

                      {/* Per-track text + position overrides */}
                      {(() => {
                        const ordered = getOrderedAudios();
                        if (!ordered.length) return null;
                        const overrideCount = ordered.filter(a => trackTextOverrides[a._trackIdx]).length;
                        return (
                          <div className={styles.perTrackTextBlock}>
                            <div className={styles.pinActionsRow}>
                              <button type="button" className={styles.clearBtn} onClick={() => setShowTextPerTrack(v => !v)}>
                                {showTextPerTrack ? "Hide per-track text" : "Edit text per track"}
                              </button>
                              {overrideCount > 0 && (
                                <button type="button" className={styles.clearBtn} onClick={() => setTrackTextOverrides({})}>
                                  Reset all {overrideCount} override{overrideCount === 1 ? "" : "s"}
                                </button>
                              )}
                              <span className={styles.settingHelp}>
                                Applies to both the concat render and batch videos.
                              </span>
                            </div>
                            {showTextPerTrack && (
                              <div className={styles.tableWrap} style={{ marginTop: 8 }}>
                                <table className={styles.table}>
                                  <thead>
                                    <tr><th>#</th><th>Track</th><th>Text</th><th>Position</th><th></th></tr>
                                  </thead>
                                  <tbody>
                                    {ordered.map((a, i) => {
                                      const ov = trackTextOverrides[a._trackIdx] || {};
                                      const fallback = textOverlay.source === "custom" ? (textOverlay.customText || "") : (a.title || "");
                                      return (
                                        <tr key={a._trackIdx}>
                                          <td>{i + 1}</td>
                                          <td className={styles.filenameCell}>{a.title}</td>
                                          <td>
                                            <input
                                              type="text"
                                              className={styles.input}
                                              style={{ minWidth: 200 }}
                                              value={ov.text ?? ""}
                                              placeholder={fallback || "(no text)"}
                                              onChange={e => setTrackCaption(a._trackIdx, { text: e.target.value })}
                                            />
                                          </td>
                                          <td>
                                            <select
                                              className={styles.inputSmall}
                                              style={{ width: 140, textAlign: "left" }}
                                              value={ov.position || ""}
                                              onChange={e => setTrackCaption(a._trackIdx, { position: e.target.value || undefined })}
                                            >
                                              <option value="">Default ({OVERLAY_POSITIONS.find(x => x.value === textOverlay.position)?.label})</option>
                                              {OVERLAY_POSITIONS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                                            </select>
                                          </td>
                                          <td>
                                            <button type="button" className={styles.jobChipX}
                                              disabled={!trackTextOverrides[a._trackIdx]}
                                              onClick={() => setTrackTextOverrides(prev => { const n = { ...prev }; delete n[a._trackIdx]; return n; })}
                                              aria-label="Reset this track">×</button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Preview */}
                      <div className={styles.overlayPreviewBar}>
                        <button type="button" className={styles.fetchBtn} onClick={runOverlayPreview} disabled={pickableImgs.length === 0}>
                          {textPreviewBusy ? "Rendering…" : showTextPreview ? "Refresh preview" : "Render preview"}
                        </button>
                        {showTextPreview && (
                          <button type="button" className={styles.linkBtn} onClick={() => setShowTextPreview(false)}>Hide</button>
                        )}
                        {pickableImgs.length > 1 && (
                          <label className={styles.videoCheckLabel} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            Image:
                            <select className={styles.inputSmall} style={{ width: 150, textAlign: "left" }}
                              value={textPreviewImgId ?? ""}
                              onChange={e => setTextPreviewImgId(e.target.value || null)}>
                              <option value="">First selected</option>
                              {pickableImgs.map((im, k) => <option key={im.id} value={im.id}>{k + 1}. {im.file.name}</option>)}
                            </select>
                          </label>
                        )}
                        {textOverlay.source === "track" && orderedAudios.length > 1 && (
                          <label className={styles.videoCheckLabel} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            Track:
                            <select className={styles.inputSmall} style={{ width: 150, textAlign: "left" }}
                              value={textPreviewTrackIdx ?? ""}
                              onChange={e => setTextPreviewTrackIdx(e.target.value === "" ? null : parseInt(e.target.value, 10))}>
                              <option value="">First track</option>
                              {orderedAudios.map((a, k) => <option key={a._trackIdx} value={a._trackIdx}>{k + 1}. {a.title}</option>)}
                            </select>
                          </label>
                        )}
                        {pickableImgs.length === 0 && (
                          <span className={styles.hintText}>Select an image above to preview.</span>
                        )}
                      </div>
                      {showTextPreview && (
                        <div className={styles.overlayPreviewWrap}>
                          <canvas ref={textPreviewCanvasRef} className={styles.overlayPreviewCanvas} />
                          <p className={styles.hintText} style={{ marginTop: 6 }}>
                            Rendered at {videoWidth}×{videoHeight} with the same code the encoder uses — what you see here is what gets burned in.
                            {textOverlay.durationMode === "seconds" && ` This is a still frame: in the video the text shows for the first ${textOverlay.durationSeconds}s of each image, then disappears.`}
                          </p>
                        </div>
                      )}
                      {overlayTextVaries && slideshowMode === "loop" && (
                        <p className={styles.hintText} style={{ marginTop: 6 }}>
                          Per-track text can&apos;t reuse the looped image cycle, so the render encodes the full timeline — expect it to take longer than a plain loop.
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Video Timeline */}
              {(() => {
                const orderedAudios = getOrderedAudios();
                const totalVideoDur = orderedAudios.reduce((s, t) => s + (t.end - t.start), 0);
                // Loop mode can produce hundreds of slots; past a few hundred the
                // blocks are sub-pixel anyway, so cap what the timeline draws.
                const MAX_TIMELINE_BLOCKS = 300;
                const imgTimings = rowTimings.length > MAX_TIMELINE_BLOCKS ? rowTimings.slice(0, MAX_TIMELINE_BLOCKS) : rowTimings;
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

              {/* Image Settings — controls how source images are pre-processed before render */}
              {videoImages.length > 0 && (() => {
                const { w, h } = concatDimensions;
                const parsedMax = imageMaxDim === "auto" ? null : parseInt(imageMaxDim);
                const effectiveMaxDim = parsedMax === 0 ? Infinity
                  : (parsedMax && parsedMax > 0 ? parsedMax : Math.round(Math.max(w, h) * 1.25));
                const selectedImgs = videoImages.filter(img => selectedVideoImages.has(img.id));
                const oversized = selectedImgs.filter(img => Math.max(img.naturalWidth || 0, img.naturalHeight || 0) > effectiveMaxDim);
                const maxDimLabel = effectiveMaxDim === Infinity ? "no" : `${effectiveMaxDim}px`;
                return (
                  <div className={styles.videoSettings} style={{ marginBottom: 16 }}>
                    <h3 className={styles.sectionTitle}>Image Settings</h3>
                    <div className={styles.videoSettingsGrid}>
                      <label className={styles.settingLabel}>
                        Max source image size
                        <select
                          className={styles.input}
                          value={imageMaxDim}
                          onChange={e => setImageMaxDim(e.target.value)}
                          title="Source images will be downscaled to this max dimension before rendering. Reduces memory use."
                        >
                          <option value="auto">Auto ({effectiveMaxDim}px — 1.25× output)</option>
                          <option value="480">480px (lowest memory)</option>
                          <option value="720">720px</option>
                          <option value="1080">1080px</option>
                          <option value="1440">1440px</option>
                          <option value="1920">1920px</option>
                          <option value="2560">2560px</option>
                          <option value="3840">3840px</option>
                          <option value="0">No limit (use originals)</option>
                        </select>
                      </label>
                      <div className={styles.settingLabel} style={{ alignSelf: "end" }}>
                        <span style={{ fontSize: "0.78rem", opacity: 0.75 }}>
                          {effectiveMaxDim === Infinity
                            ? `Source images will be passed to ffmpeg at full resolution. Large images may exhaust browser memory.`
                            : oversized.length > 0
                              ? `${oversized.length} of ${selectedImgs.length} selected image${selectedImgs.length === 1 ? "" : "s"} will be shrunk to ${maxDimLabel} before render.`
                              : `All ${selectedImgs.length} selected image${selectedImgs.length === 1 ? "" : "s"} are within the ${maxDimLabel} limit — no resizing needed.`}
                        </span>
                        {/* Capping below the output size means ffmpeg upscales a
                            shrunk source back up, which visibly softens the video. */}
                        {effectiveMaxDim !== Infinity && effectiveMaxDim < Math.max(w, h) && (
                          <span style={{ fontSize: "0.78rem", marginTop: 4, color: darkMode ? "#fbd38d" : "#c05621" }}>
                            ⚠️ {maxDimLabel} is below the {w}×{h} output — images get scaled back up and will look soft. Use it to get a render through when memory is tight.
                          </span>
                        )}
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
                                    // Choosing a preset is an explicit manual
                                    // pick, so it releases the auto-match lock
                                    // instead of being silently overridden.
                                    onClick={() => { setAutoMatchImageRes(false); setVideoWidth(String(p.w)); setVideoHeight(String(p.h)); setAspectDropdownOpen(false); }}
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
                      <label className={styles.autoMatchLabel}
                        title="Keep the output resolution locked to the image the video opens with — the first track's pinned image, or the first selected image. Batch renders match each track's own image.">
                        <input type="checkbox" checked={autoMatchImageRes} onChange={e => setAutoMatchImageRes(e.target.checked)} />
                        Auto match image
                      </label>
                      {videoImages.map((img, i) => (
                        <button key={img.id} className={styles.presetMatchBtn} onClick={() => applyImageResolution(img)}
                          disabled={autoMatchImageRes || img.loading || !img.naturalWidth}
                          title={autoMatchImageRes ? "Turn off Auto match image to set the resolution from a specific image"
                            : img.loading ? `Still reading ${img.file.name}…`
                            : `Set resolution to match ${img.file.name}`}>
                          {img.loading || !img.thumbUrl
                            ? <span className={`${styles.presetMatchThumb} ${styles.presetMatchThumbLoading}`}><span className={styles.fileLoadingSpinner} /></span>
                            : <img src={img.thumbUrl} alt="" className={styles.presetMatchThumb} />}
                          <span>{i + 1}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {autoMatchImageRes && (
                    <p className={styles.hintText} style={{ marginTop: 6 }}>
                      {autoMatchSourceImage
                        ? <>Resolution follows <b>{autoMatchSourceImage.file.name}</b> ({autoMatchSourceImage.naturalWidth}×{autoMatchSourceImage.naturalHeight}) and updates when the opening image changes.</>
                        : "No selected image has readable dimensions yet — the resolution below stays as-is until one does."}
                    </p>
                  )}
                </div>

                <div className={styles.videoSettingsGrid}>
                  <label className={styles.settingLabel}>
                    Output name
                    <div className={styles.outputNameRow}>
                      <input type="text" className={styles.input} value={videoOutputName} onChange={e => setVideoOutputName(e.target.value)} placeholder={projectName || "album"} />
                      <button
                        type="button"
                        className={styles.outputNamePickerBtn}
                        onClick={() => setShowOutputNamePicker(true)}
                        title="Choose from collected names"
                      >
                        Select…
                      </button>
                    </div>
                  </label>
                  <div className={styles.settingLabel}>
                    Resolution{autoMatchImageRes ? " (auto)" : ""}
                    <div className={styles.dimensionRow} style={autoMatchImageRes ? { opacity: 0.55 } : undefined}>
                      <input type="number" className={styles.dimensionInput} value={videoWidth} onChange={e => setVideoWidth(e.target.value)} min="1" max="3840" placeholder="W" title={autoMatchImageRes ? "Set by Auto match image" : "Width"} disabled={autoMatchImageRes} />
                      <span className={styles.dimensionX}>×</span>
                      <input type="number" className={styles.dimensionInput} value={videoHeight} onChange={e => setVideoHeight(e.target.value)} min="1" max="2160" placeholder="H" title={autoMatchImageRes ? "Set by Auto match image" : "Height"} disabled={autoMatchImageRes} />
                    </div>
                  </div>
                  <label className={styles.settingLabel}>
                    Scale — {renderScale}×
                    <select className={styles.input} value={renderScale}
                      onChange={e => setRenderScale(parseFloat(e.target.value) || 1)}>
                      {RENDER_SCALES.map(v => (
                        <option key={v} value={v}>{v}× {v < 1 ? "(smaller)" : v > 1 ? "(larger)" : "(original)"}</option>
                      ))}
                    </select>
                    <span className={styles.settingHelp}>
                      Applied on top of the resolution, to the concat render and every batch video — output {concatDimensions.w}×{concatDimensions.h}.
                      {renderScale < 1 && " Smaller renders are much faster and far less likely to run out of memory."}
                      {renderScale > 1 && " Upscaling won't add detail and makes each render slower."}
                    </span>
                  </label>
                  <label className={styles.settingLabel}>
                    Background color
                    <input type="color" value={videoBgColor} onChange={e => setVideoBgColor(e.target.value)} style={{ width: 44, height: 34, padding: 2, borderRadius: 4, border: "1px solid #cbd5e0", cursor: "pointer" }} />
                  </label>
                  <div className={styles.settingLabel}>
                    Background blur — {defaultBgBlur === 0 ? "off" : `${defaultBgBlur}%`}
                    <div className={styles.blurSettingRow}>
                      <input type="range" min="0" max={BG_BLUR_MAX} step="5" value={defaultBgBlur}
                        onChange={e => setDefaultBgBlur(clampBgBlur(e.target.value))} />
                      <button type="button" className={styles.applyAllBtn}
                        disabled={videoImages.length === 0}
                        title="Set every image in the table to this blur amount"
                        onClick={() => {
                          setVideoImages(prev => prev.map(im => ({ ...im, bgBlur: defaultBgBlur })));
                          setMessage(`Background blur set to ${defaultBgBlur}% on ${videoImages.length} image(s).`);
                        }}
                      >Apply to all</button>
                    </div>
                    <span className={styles.settingHelp}>
                      Used by images that have <b>Blur background</b> on. New images start here; each row can
                      override it, and <b>Apply to all</b> pushes this value onto every image. 100% is the
                      original strength — the scale runs to {BG_BLUR_MAX}% for a softer backdrop.
                    </span>
                  </div>
                </div>
                {/* Video estimate */}
                {(() => {
                  const est = estimateVideoSize();
                  if (!est) return null;
                  return (
                    <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 6, fontSize: "0.82rem",
                      background: est.overLimit ? (darkMode ? "#5a1a1a" : "#fff5f5") : (darkMode ? "#252538" : "#f7fafc"),
                      border: `1px solid ${est.overLimit ? (darkMode ? "#822727" : "#fc8181") : est.nearLimit ? "#fbd38d" : (darkMode ? "#444" : "#e2e8f0")}`,
                      color: darkMode ? "#fff" : "#2d3748"
                    }}>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                        <span>Duration: <strong>{formatTime(est.totalDur)}</strong></span>
                        <span>Resolution: <strong>{concatDimensions.w}×{concatDimensions.h}</strong>{renderScale !== 1 && <> ({videoWidth}×{videoHeight} × {renderScale})</>}</span>
                        <span>Est. size: <strong>{est.totalMB < 1024 ? `${est.totalMB.toFixed(0)} MB` : `${(est.totalMB/1024).toFixed(1)} GB`}</strong></span>
                        <span>Upload limit: <strong>{YT_UPLOAD_LIMIT_MB / 1024} GB</strong></span>
                      </div>
                      {est.overLimit && <div style={{ marginTop: 6, color: darkMode ? "#fc8181" : "#c53030", fontWeight: 700 }}>⚠️ Estimated size exceeds the upload limit. Lower the resolution or shorten the audio.</div>}
                      {!est.overLimit && est.nearLimit && <div style={{ marginTop: 6, color: darkMode ? "#fbd38d" : "#c05621" }}>⚠️ Approaching upload limit — consider a lower resolution.</div>}
                      {est.overDuration && <div style={{ marginTop: 6, color: darkMode ? "#fc8181" : "#c53030", fontWeight: 700 }}>⚠️ Duration exceeds YouTube&apos;s 12-hour limit.</div>}
                    </div>
                  );
                })()}

                {/* Memory estimate */}
                {(() => {
                  const mem = estimateMemoryUsage();
                  if (!mem) return null;
                  const fmt = (mb) => mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
                  const tone = mem.overLimit ? "danger" : mem.nearLimit ? "warn" : "ok";
                  const bgByTone = {
                    ok:     darkMode ? "#252538" : "#f7fafc",
                    warn:   darkMode ? "#3a2a1a" : "#fffaf0",
                    danger: darkMode ? "#5a1a1a" : "#fff5f5",
                  };
                  const borderByTone = {
                    ok:     darkMode ? "#444"    : "#e2e8f0",
                    warn:   "#fbd38d",
                    danger: darkMode ? "#822727" : "#fc8181",
                  };
                  const pct = Math.min(100, (mem.totalMB / WASM_MEMORY_LIMIT_MB) * 100);
                  return (
                    <div style={{
                      marginTop: 12, padding: "10px 14px", borderRadius: 6, fontSize: "0.82rem",
                      background: bgByTone[tone], border: `1px solid ${borderByTone[tone]}`,
                      color: darkMode ? "#fff" : "#2d3748"
                    }}>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                        <span>Est. peak browser memory: <strong>{fmt(mem.totalMB)}</strong></span>
                        <span style={{ opacity: 0.7 }}>(limit ≈ {fmt(WASM_MEMORY_LIMIT_MB)})</span>
                        <span title="Largest source image after downscale (×2 for decode + filter)">sources <strong>{fmt(mem.sourceMB)}</strong></span>
                        <span title="x264 frame buffers at this output resolution">encoder <strong>{fmt(mem.encoderMB)}</strong></span>
                      </div>
                      <div style={{ marginTop: 8, height: 6, background: darkMode ? "#444" : "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${pct}%`,
                          background: tone === "danger" ? (darkMode ? "#fc8181" : "#c53030") : tone === "warn" ? "#dd6b20" : (darkMode ? "#48bb78" : "#38a169"),
                          transition: "width 0.2s"
                        }} />
                      </div>
                      {mem.overLimit && (
                        <div style={{ marginTop: 8, color: darkMode ? "#fc8181" : "#c53030", fontWeight: 700 }}>
                          ⚠️ Estimated memory exceeds the ~2 GB browser ceiling — this render will likely fail. Lower the resolution or reduce the max source image size in Image Settings.
                        </div>
                      )}
                      {!mem.overLimit && mem.nearLimit && (
                        <div style={{ marginTop: 8, color: darkMode ? "#fbd38d" : "#c05621" }}>
                          ⚠️ Estimated memory is close to the browser limit — render may fail. Consider lowering the resolution or shrinking source images.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Render */}
              {/* Counted the way buildRenderSpec counts, not from the selection
                  sets. The button used to enable on selectedVideoAudios.size
                  while the spec was built from getOrderedAudios() — so a
                  selection holding indices for tracks that no longer existed
                  gave an enabled button and a render that produced nothing. */}
              {(renderableImages === 0 || renderableAudios === 0) && !isRenderingVideo && (
                <div className={styles.renderWarning} style={{background: darkMode ? "#3a2a1a" : "#fffaf0", borderColor: darkMode ? "#6b4d2d" : "#fbd38d", color: darkMode ? "#fbd38d" : "#c05621"}}>
                  {renderableImages === 0 && renderableAudios === 0
                    ? "Add at least one image and select at least one audio track to render."
                    : renderableImages === 0
                      ? "Add or select at least one image above to render the video."
                      : exportedTracks.length === 0
                        ? "No exported audio yet — run the export in Step 4, then select the tracks here."
                        : "Select at least one audio track above to render the video."}
                </div>
              )}
              {/* The two render modes, side by side so the choice is obvious:
                  one video with everything joined, or one video per track. */}
              <div className={styles.renderModeRow}>
                <div className={styles.renderModeCol}>
                  <button className={styles.exportBtn} onClick={startRender}
                    disabled={isRenderingVideo || renderableImages === 0 || renderableAudios === 0}
                    style={!isRenderingVideo && (renderableImages === 0 || renderableAudios === 0) ? {background:"#cbd5e0",cursor:"not-allowed"} : undefined}>
                    {activeRenderJob?.status === "queued" ? `Queued — #${activeRenderJob.queuePosition} in line`
                      : isRenderingVideo ? "Rendering Concat…"
                      : renderableImages === 0 ? "Render Concat — no images selected"
                      : renderableAudios === 0 ? "Render Concat — no audio selected"
                      : `Render Concat (${renderableImages} image${renderableImages !== 1 ? "s" : ""}, ${renderableAudios} track${renderableAudios !== 1 ? "s" : ""})`}
                  </button>
                  <span className={styles.renderModeHint}>One video — every track joined end to end, images following the slideshow settings.</span>
                  {/* Auto-drawn opening frame, so the button shows what it makes. */}
                  {concatPreviewImage ? (
                    <figure className={styles.renderModePreview}>
                      <canvas ref={concatPreviewCanvasRef} className={styles.renderModePreviewCanvas} />
                      <figcaption className={styles.renderModePreviewCap}>
                        {concatPreviewImage.loading ? <>Reading {concatPreviewImage.file?.name}…</> : (
                          <>
                            Opening frame — {concatDimensions.w}×{concatDimensions.h}
                            {getOrderedAudios().length > 1 && <>, then {getOrderedAudios().length - 1} more track{getOrderedAudios().length === 2 ? "" : "s"}</>}
                          </>
                        )}
                      </figcaption>
                    </figure>
                  ) : (
                    <div className={styles.renderModePreviewEmpty}>Select an image to see a preview of the first frame.</div>
                  )}
                </div>
                <span className={styles.renderModeOr}>or</span>
                <div className={styles.renderModeCol}>
                  <button
                    type="button"
                    className={styles.batchBtn}
                    onClick={startBatchRender}
                    disabled={batchPlan.length === 0 || batchInFlight.length > 0}
                    title={batchPlan.length === 0
                      ? "Select audio tracks and at least one image first"
                      : `Queue one video per track (${batchPlan.length})`}
                  >
                    {batchInFlight.length > 0
                      ? `Rendering Batch — ${activeBatchJobs.filter(j => j.status === "done").length}/${activeBatchJobs.length} done`
                      : batchPlan.length === 0
                        ? "Render Batch — nothing to render"
                        : `Render Batch (${batchPlan.length} video${batchPlan.length === 1 ? "" : "s"}, ${batchPlan.length} track${batchPlan.length === 1 ? "" : "s"})`}
                  </button>
                  <span className={styles.renderModeHint}>Separate videos — one per track, each with its own image.</span>
                </div>
              </div>
              <div className={styles.exportRow}>
                {isRenderingVideo && (
                  <button className={styles.cancelBtn} onClick={() => {
                    renderQueue.cancel(activeProjectId);
                    setMessage("Render cancelled");
                  }}>Cancel Concat</button>
                )}
                {batchInFlight.length > 0 && (
                  <button type="button" className={styles.cancelBtn} onClick={stopBatchRender}>Stop Batch</button>
                )}
              </div>
              {activeRenderJob?.status === "queued" && (
                <div className={styles.renderWarning}>
                  Waiting for {renderJobs.find(j => j.status === "running")?.projectName || "another render"} to finish — only one render runs at a time so they don&apos;t exhaust browser memory. This one starts automatically.
                </div>
              )}
              {activeRenderJob?.status === "running" && (
                <div className={styles.renderWarning}>
                  Rendering in browser — you can keep working, switch projects, or start a new one. The render continues as long as this tab stays open.
                </div>
              )}

              {/* Batch render — one video per track, each with that track's image */}
              <div className={styles.batchBlock}>
                <div className={styles.batchHeadRow}>
                  <b style={{ fontSize: "0.9rem" }}>Render Batch settings</b>
                  <button type="button" className={styles.clearBtn} onClick={() => setShowBatchSettings(v => !v)}>
                    {showBatchSettings ? "Hide settings" : "Show settings"}
                  </button>
                  {batchInFlight.length > 0 && (
                    <button type="button" className={styles.cancelBtn} onClick={stopBatchRender}>
                      Stop batch
                    </button>
                  )}
                </div>

                {/* Plain-language summary of exactly what pressing the button does */}
                <ul className={styles.batchSummary}>
                  <li><b>{batchPlan.length}</b> video{batchPlan.length === 1 ? "" : "s"} — one per {batchSettings.scope === "pinned" ? "track that has a pinned image" : "selected track"}</li>
                  <li>Each video is <b>one track&apos;s audio</b> over <b>one still image</b> (its pinned image, or the cycling image if unpinned)</li>
                  <li>Resolution: {resolutionMode === "auto"
                    ? <b>each video matches its own image</b>
                    : <>fixed at <b>{videoWidth}×{videoHeight}</b></>}
                    {renderScale !== 1 && <>, scaled <b>{renderScale}×</b></>}</li>
                  <li>Text: {sharedTextMode === "off"
                    ? <b>none</b>
                    : sharedTextMode === "custom"
                      ? <>the same custom text on every video — <b>{textOverlay.customText || "(empty — nothing will be drawn)"}</b></>
                      : <b>each track&apos;s song name</b>}
                    {sharedTextMode !== "off" && (
                      textOverlay.durationMode === "seconds"
                        ? ` — shown for the first ${textOverlay.durationSeconds}s of each video, styled by the Text Overlay section above`
                        : " — shown for the whole video, styled by the Text Overlay section above"
                    )}</li>
                  <li>Runs <b>one at a time</b> in the background — you can keep working, and stop the batch at any point</li>
                </ul>

                {showBatchSettings && (() => {
                  const setB = (key) => (value) => setBatchSettings(o => ({ ...o, [key]: value }));
                  const pinnedCount = getOrderedAudios().filter(a => selectedVideoImages.has(trackImageAssign[a._trackIdx])).length;
                  return (
                    <div className={styles.batchSettingsPanel}>
                      {batchInFlight.length > 0 && (
                        <div className={styles.batchEditNotice}>
                          A batch is already queued with the old settings — changes here apply to the <b>next</b> run.
                          <button type="button" className={styles.cancelBtn} onClick={stopBatchRender}>Stop batch to apply now</button>
                        </div>
                      )}
                      <div className={styles.overlayGrid}>
                        <label className={styles.settingLabel}>
                          Which tracks get a video
                          <select className={styles.input} value={batchSettings.scope} onChange={e => setB("scope")(e.target.value)}>
                            <option value="selected">Every selected track ({getOrderedAudios().length})</option>
                            <option value="pinned">Only tracks with a pinned image ({pinnedCount})</option>
                          </select>
                          <span className={styles.settingHelp}>
                            Pin an image to a track in the Audio Tracks table above.
                          </span>
                        </label>
                        {/* Resolution, scale and text are the same settings the
                            concat render uses — changing them here changes them
                            in Video Settings / Text Overlay too, and vice versa. */}
                        <label className={styles.settingLabel}>
                          Video resolution
                          <select className={styles.input} value={resolutionMode} onChange={e => setAutoMatchImageRes(e.target.value === "auto")}>
                            <option value="auto">Match each track&apos;s image</option>
                            <option value="fixed">Fixed — {videoWidth}×{videoHeight}</option>
                          </select>
                          <span className={styles.settingHelp}>
                            {resolutionMode === "auto"
                              ? "Each video comes out at its own image's pixel size (rounded to even numbers)."
                              : "Every video uses the size set in Video Settings, letterboxing images that don't fit."}
                            {" "}Shared with <b>Auto match image</b> in Video Settings.
                          </span>
                        </label>
                        <label className={styles.settingLabel}>
                          Scale — {renderScale}×
                          <select className={styles.input} value={renderScale}
                            onChange={e => setRenderScale(parseFloat(e.target.value) || 1)}>
                            {RENDER_SCALES.map(v => (
                              <option key={v} value={v}>{v}× {v < 1 ? "(smaller)" : v > 1 ? "(larger)" : "(original)"}</option>
                            ))}
                          </select>
                          <span className={styles.settingHelp}>
                            Applied on top of the resolution above. Shared with <b>Scale</b> in Video Settings, so the concat render uses it too.
                            {renderScale < 1 && " Smaller renders are much faster and far less likely to run out of memory."}
                            {renderScale > 1 && " Upscaling won't add detail and makes each render slower."}
                          </span>
                        </label>
                        <label className={styles.settingLabel}>
                          Text on the video
                          <select className={styles.input} value={sharedTextMode} onChange={e => setSharedTextMode(e.target.value)}>
                            {TEXT_MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <span className={styles.settingHelp}>
                            The same switch as the <b>Text Overlay</b> section above, which is also where font, size, colour, background and position come from.
                          </span>
                        </label>
                        {sharedTextMode === "custom" && (
                          <label className={styles.settingLabel}>
                            Custom text
                            <input type="text" className={styles.input} value={textOverlay.customText}
                              placeholder={projectName || "Your text here"}
                              onChange={e => setTextOverlay(o => ({ ...o, customText: e.target.value }))} />
                          </label>
                        )}
                        <label className={styles.settingLabel} style={{ gridColumn: "span 2" }}>
                          File name pattern
                          <input type="text" className={styles.input} value={batchSettings.nameTemplate}
                            onChange={e => setB("nameTemplate")(e.target.value)}
                            placeholder="%num% - %title%" />
                          <span className={styles.settingHelp}>
                            %num% · %title% · %album% · %artist% — anything else is kept, punctuation is stripped.
                          </span>
                        </label>
                      </div>

                      {/* Exactly what will be produced, row by row */}
                      {batchPlan.length > 0 && (
                        <div className={styles.tableWrap} style={{ marginTop: 12 }}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>#</th><th>Track</th><th>Image</th><th>Size</th><th>Text</th><th>Position</th><th>Output file</th>
                              </tr>
                            </thead>
                            <tbody>
                              {batchPlan.map(item => {
                                const { w, h } = batchDimensionsFor(item.img);
                                const ov = trackTextOverrides[item.audio._trackIdx] || {};
                                const fallbackText = sharedTextMode === "custom"
                                  ? (textOverlay.customText || "")
                                  : (item.audio.title || "");
                                return (
                                  <tr key={item.orderIdx}>
                                    <td>{item.orderIdx + 1}</td>
                                    <td className={styles.filenameCell}>{item.audio.title}</td>
                                    <td>
                                      <span className={styles.batchPlanImg}>
                                        {item.img.thumbUrl && !item.img.loading
                                          ? <img src={item.img.thumbUrl} alt="" className={styles.trackImagePickThumb} />
                                          : <span className={styles.trackImagePickThumb} />}
                                        {item.pinned
                                          ? <span className={styles.batchPinTag}>pinned</span>
                                          : <span className={styles.batchAutoTag}>auto</span>}
                                      </span>
                                    </td>
                                    <td>{w}×{h}</td>
                                    <td>
                                      {sharedTextMode === "off" ? <span style={{ opacity: 0.5 }}>—</span> : (
                                        <input
                                          type="text"
                                          className={styles.input}
                                          style={{ minWidth: 180 }}
                                          value={ov.text ?? ""}
                                          placeholder={fallbackText || "(no text)"}
                                          onChange={e => setTrackCaption(item.audio._trackIdx, { text: e.target.value })}
                                          title="Overrides the text for this video only"
                                        />
                                      )}
                                    </td>
                                    <td>
                                      {sharedTextMode === "off" ? <span style={{ opacity: 0.5 }}>—</span> : (
                                        <select
                                          className={styles.inputSmall}
                                          style={{ width: 130, textAlign: "left" }}
                                          value={ov.position || ""}
                                          onChange={e => setTrackCaption(item.audio._trackIdx, { position: e.target.value || undefined })}
                                        >
                                          <option value="">Default</option>
                                          {OVERLAY_POSITIONS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                                        </select>
                                      )}
                                    </td>
                                    <td className={styles.filenameCell}>{batchOutputName(item, batchPlan.length)}.mp4</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {activeBatchJobs.length > 0 && (
                  <div className={styles.batchJobList}>
                    {activeBatchJobs.map(j => (
                      <div key={j.jobId} className={styles.batchJobRow}>
                        <span className={styles.batchJobName} title={j.label}>{j.label}</span>
                        <span className={styles.batchJobStatus}>
                          {j.status === "running" ? `${j.progress != null ? Math.round(j.progress * 100) : 0}%`
                            : j.status === "queued" ? `queued #${j.queuePosition}`
                            : j.status === "done" ? "✓ done"
                            : j.status === "error" ? `✕ ${j.error?.oom ? "out of memory" : "failed"}`
                            : j.status === "cancelled" ? "stopped"
                            : j.status}
                        </span>
                        {(j.status === "running" || j.status === "queued")
                          ? <button type="button" className={styles.jobChipX} onClick={() => renderQueue.cancel(j.jobId)} aria-label="Cancel">×</button>
                          : <button type="button" className={styles.jobChipX} onClick={() => renderQueue.clear(j.jobId)} aria-label="Dismiss">×</button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Batch render output */}
              {batchVideos.length > 0 && (
                <div className={styles.videoSection}>
                  <div className={styles.sectionTitleRow}>
                    <h3 className={styles.sectionTitle}>Batch Videos ({batchVideos.length})</h3>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className={styles.zipBtn} onClick={downloadBatchZip}>Download all as ZIP</button>
                      <button type="button" className={`${styles.clearBtn} ${styles.clearBtnDanger}`} onClick={clearBatchVideos}>Delete all</button>
                    </div>
                  </div>
                  <div className={styles.batchVideoGrid}>
                    {batchVideos.map(v => (
                      <div key={v.key} className={styles.batchVideoCard}>
                        <video src={v.url} controls preload="metadata" className={styles.batchVideoPlayer} />
                        <div className={styles.batchVideoMeta}>
                          <b className={styles.batchVideoTitle} title={v.title}>{v.title}</b>
                          <span className={styles.batchVideoSize}>{formatBytes(v.size)}</span>
                        </div>
                        <button type="button" className={styles.dlBtnCard} onClick={() => downloadBatchVideo(v)} title={`Download ${v.name}`}>↓</button>
                      </div>
                    ))}
                  </div>
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

              {/* Render error banner */}
              {videoRenderError && (
                <div role="alert" style={{
                  marginTop: 16, padding: "14px 16px", borderRadius: 8,
                  background: darkMode ? "#3a1a1a" : "#fff5f5",
                  border: `1px solid ${darkMode ? "#822727" : "#fc8181"}`,
                  color: darkMode ? "#feb2b2" : "#742a2a",
                }}>
                  {videoRenderError.kind === "oom" ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                          ⚠️ Render failed: ran out of memory at {videoRenderError.dims}
                        </div>
                        <button onClick={() => setVideoRenderError(null)} style={{
                          background: "transparent", border: "none", color: "inherit",
                          cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0
                        }} aria-label="Dismiss">×</button>
                      </div>
                      <p style={{ margin: "8px 0 6px", fontSize: "0.88rem" }}>
                        FFmpeg runs in your browser (WebAssembly) and is capped at about 2 GB of memory. This job exceeded the limit, so the encoder aborted before producing a usable video.
                      </p>
                      <p style={{ margin: "10px 0 4px", fontSize: "0.85rem", fontWeight: 600 }}>Try one or more of:</p>
                      <ul style={{ margin: "0 0 8px 20px", fontSize: "0.85rem", lineHeight: 1.5 }}>
                        {videoRenderError.tips.map((tip, i) => <li key={i}>{tip}</li>)}
                      </ul>
                      {videoRenderError.signal && (
                        <p style={{ margin: "8px 0 0", fontSize: "0.75rem", opacity: 0.75, fontFamily: "monospace" }}>
                          ffmpeg signal: {videoRenderError.signal}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: "1rem" }}>⚠️ Render failed</div>
                        <button onClick={() => setVideoRenderError(null)} style={{
                          background: "transparent", border: "none", color: "inherit",
                          cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0
                        }} aria-label="Dismiss">×</button>
                      </div>
                      <p style={{ margin: "8px 0 0", fontSize: "0.88rem", fontFamily: "monospace" }}>
                        {videoRenderError.message}
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* FFmpeg log output */}
              {videoRenderLogs.length > 0 && (
                <div className={styles.videoLogWrap}>
                  <div className={styles.videoLogHeadRow}>
                    <button className={styles.analyzeLogToggle} onClick={() => setShowVideoLogs(v => !v)}>
                      {showVideoLogs ? "▼" : "▶"} FFmpeg Logs ({videoRenderLogs.length} lines)
                      {isRenderingVideo && <span className={styles.spinnerInline} style={{ marginLeft: 8 }} />}
                    </button>
                    {/* The timing summary is the point of the ⏱ lines — make it
                        one click to get the whole log somewhere readable. */}
                    <button type="button" className={styles.linkBtn}
                      onClick={() => {
                        navigator.clipboard?.writeText(videoRenderLogs.join("\n"))
                          .then(() => setMessage(`Copied ${videoRenderLogs.length} log lines to the clipboard.`))
                          .catch(() => setMessage("Could not copy the logs — the browser blocked clipboard access."));
                      }}>
                      Copy logs
                    </button>
                  </div>
                  {showVideoLogs && (
                    <div className={styles.videoLogBox}>
                      {videoRenderLogs.map((line, i) => (
                        <div key={i} className={`${styles.videoLogLine} ${
                          line.startsWith("ERROR") ? styles.videoLogError
                            : line.startsWith("✓") ? styles.videoLogDone
                            : line.startsWith("⏱") ? styles.videoLogTiming : ""}`}>{line}</div>
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
                  <div className={styles.videoPreviewActions}>
                    <button className={styles.dlAllBtn} onClick={() => { const a = document.createElement("a"); a.href = renderedVideoSrc; a.download = `${videoOutputName || projectName || "album"}.mp4`; a.click(); }}>Download Video</button>
                    <button type="button" className={`${styles.clearBtn} ${styles.clearBtnDanger}`} onClick={clearRenderedVideo}>
                      Delete Video
                    </button>
                  </div>
                </div>
              )}

              {message && <p className={styles.msg}>{message}</p>}

              {/* YouTube Upload Details (open by default) */}
              <details className={styles.ytDetailsBlock} open>
                <summary className={styles.ytDetailsSummary}>
                  <span style={{color:"#ff0000",marginRight:6}}>▶</span>
                  YouTube Upload Details
                  {/* Always-visible "Queue upload" toggle. preventDefault keeps a
                      click here from collapsing the <details> panel. */}
                  <button
                    type="button"
                    onClick={e => {
                      e.preventDefault(); e.stopPropagation();
                      if (!ytAuthState.canAuth) return;
                      autoUploadUserSetRef.current = true;
                      setAutoUploadYt(v => !v);
                    }}
                    disabled={!ytAuthState.canAuth}
                    aria-pressed={autoUploadYt}
                    title={ytAuthState.canAuth
                      ? "When on, the video uploads to YouTube automatically as soon as it finishes rendering"
                      : "Sign in to YouTube to enable auto-upload"}
                    style={{
                      marginLeft: "auto",
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "0.3rem 0.7rem", borderRadius: 6,
                      fontSize: 13, fontWeight: 600, cursor: ytAuthState.canAuth ? "pointer" : "not-allowed",
                      border: `1px solid ${autoUploadYt ? "#38a169" : "#718096"}`,
                      background: !ytAuthState.canAuth ? "#cbd5e0" : autoUploadYt ? "#38a169" : "transparent",
                      color: !ytAuthState.canAuth ? "#4a5568" : autoUploadYt ? "#fff" : "inherit",
                      opacity: ytAuthState.canAuth ? 1 : 0.7,
                    }}
                  >
                    {autoUploadYt ? "✓ Queue upload: ON" : "Queue upload: OFF"}
                  </button>
                </summary>
                <div className={styles.ytSection}>
                  <YouTubeAuth compact={true} returnUrl="/riptag" darkMode={darkMode} getTokensRef={getTokensRef} onAuthStateChange={setYtAuthState} />
                  {ytAuthState.canAuth && (() => {
                    const titleLen = ytUploadData.title.length;
                    const descLen = ytUploadData.description.length;
                    // Counted the way YouTube counts, not by raw string length:
                    // a multi-word keyword is stored quoted and those two quotes
                    // count, so a 500-character tag string is really over budget.
                    // Measuring the text was why uploads failed with "invalid
                    // video keywords" while the counter still read green.
                    const tagsLen = (ytUploadData.tags || "")
                      .split(",")
                      .map(t => sanitizeYouTubeTag(t))
                      .filter(Boolean)
                      .reduce((sum, t) => sum + youTubeTagCost(t), 0);
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
                          <span
                            className={`${styles.ytCharCount} ${tagsOver ? styles.ytCharOver : ""}`}
                            title={"YouTube's keyword budget. A tag with a space in it counts two extra characters "
                              + "for the quotes YouTube stores it with. Anything over the limit is dropped whole at "
                              + "upload time — never cut mid-word."}
                          >{tagsLen}/{YT_LIMITS.tags}</span>
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
                        <button
                          onClick={() => uploadToYouTube()}
                          disabled={ytUploading || !renderedVideoSrc || anyOver}
                          className={styles.exportBtn}
                          style={{
                            width: "100%",
                            background: ytUploading
                              ? undefined
                              : (anyOver || !renderedVideoSrc)
                                ? "#cbd5e0"
                                : "#ff0000",
                          }}
                        >
                          {ytUploading
                            ? (ytUploadProgress < 100 ? `Uploading… ${ytUploadProgress}%` : <span className={styles.ytProcessing}>Processing</span>)
                            : !renderedVideoSrc
                              ? (isRenderingVideo
                                  ? (autoUploadYt
                                      ? `Rendering — will auto-upload when ready${videoRenderProgress !== null ? ` (${(videoRenderProgress * 100).toFixed(0)}%)` : ""}`
                                      : `Rendering${videoRenderProgress !== null ? ` (${(videoRenderProgress * 100).toFixed(0)}%)` : "…"} — turn on "Queue upload" to auto-upload`)
                                  : "No video rendered yet")
                              : "Upload to YouTube now"}
                        </button>
                        {isRenderingVideo && !renderedVideoSrc && autoUploadYt && (
                          <div style={{ fontSize: 12, color: "#3182ce", marginTop: 6, textAlign: "center" }}>
                            Queued — upload will start automatically once the video finishes rendering. Toggle the Queue upload button above to cancel.
                          </div>
                        )}
                      </div>
                      {ytUploading && (
                        <div style={{gridColumn:"1/-1"}}>
                          <div className={styles.progressBar}><div className={styles.progressFill} style={{width:`${ytUploadProgress ?? 0}%`,background: ytUploadProgress < 100 ? "#ff0000" : "#48bb78"}} /></div>
                        </div>
                      )}
                      {ytUploadAuthError && (
                        <div className={styles.ytAuthErrorCard} style={{gridColumn:"1/-1"}}>
                          <div className={styles.ytAuthErrorTitle}>
                            ⚠️ YouTube sign-in expired — upload was rejected
                          </div>
                          <div className={styles.ytAuthErrorBody}>
                            Google rejected the upload because your stored YouTube credentials are no longer valid
                            <span className={styles.ytAuthErrorReason}> ({ytUploadAuthError.reason})</span>.
                            This usually happens after a long break, a password change, or if you revoked access from your
                            Google account. <strong>Your video was not uploaded.</strong>
                          </div>
                          <ul className={styles.ytAuthErrorList}>
                            <li>Click <em>Sign in to YouTube again</em> below to refresh your credentials.</li>
                            <li>Make sure to grant the same YouTube upload permission when prompted.</li>
                            <li>Once you're signed in again, return here and click <em>Upload to YouTube</em>.</li>
                          </ul>
                          <div className={styles.ytAuthErrorActions}>
                            <button
                              className={styles.ytAuthErrorPrimaryBtn}
                              onClick={async () => {
                                try {
                                  const res = await fetch(`${apiBaseURL()}/youtube/getAuthUrl`, { credentials: 'include' });
                                  if (res.ok) {
                                    const data = await res.json();
                                    if (data?.url) {
                                      try { localStorage.setItem('youtube_auth_return_url', '/riptag'); } catch {}
                                      // Open in a popup so this render page (and all its
                                      // in-memory audio/image state) is never unloaded. Falls
                                      // back to a same-tab redirect if the popup is blocked.
                                      try { localStorage.setItem('youtube_auth_popup_flow', '1'); } catch {}
                                      const w = 500, h = 650;
                                      const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
                                      const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
                                      let popup = null;
                                      try { popup = window.open(data.url, 'youtube_oauth', `width=${w},height=${h},left=${left},top=${top}`); } catch { popup = null; }
                                      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
                                        try { localStorage.removeItem('youtube_auth_popup_flow'); } catch {}
                                        window.location.href = data.url;
                                      }
                                      return;
                                    }
                                  }
                                  setYtUploadError('Could not fetch the YouTube sign-in URL. Try the Sign in button above.');
                                } catch (e) {
                                  setYtUploadError(`Could not start YouTube sign-in: ${e.message}`);
                                }
                              }}
                            >
                              Sign in to YouTube again
                            </button>
                            <button
                              className={styles.ytAuthErrorSecondaryBtn}
                              onClick={() => setYtUploadAuthError(null)}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}
                      {ytUploadError && !ytUploadAuthError && (
                        <div className={styles.ytErrorCard} style={{gridColumn:"1/-1"}}>
                          <div className={styles.ytErrorTitle}>Upload failed</div>
                          <div className={styles.ytErrorBody}>{ytUploadError}</div>
                          <div className={styles.ytErrorHint}>
                            If you keep seeing this, try clearing your YouTube auth and signing in again.
                          </div>
                        </div>
                      )}
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
              </details>

              <div className={styles.stepNav}>
                <button className={styles.backBtn} onClick={() => setStep(4)}>← Back to Audio</button>
              </div>
            </div>
          )}

        </div>

          {/* Image Add Modal */}
          {showOutputNamePicker && (() => {
            const groups = buildOutputNameCandidates();
            const isEmpty = groups.length === 0;
            return (
              <div
                className={styles.imageModalBackdrop}
                onClick={() => setShowOutputNamePicker(false)}
              >
                <div
                  className={styles.imageModal}
                  onClick={e => e.stopPropagation()}
                  style={{ width: 480 }}
                >
                  <div className={styles.imageModalHeader}>
                    <h2 className={styles.imageModalTitle}>Choose output name</h2>
                    <button
                      type="button"
                      className={styles.imageModalClose}
                      onClick={() => setShowOutputNamePicker(false)}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                  <div className={styles.outputNamePickerBody}>
                    {isEmpty && (
                      <p className={styles.hintText} style={{ padding: "8px 4px" }}>
                        No collected metadata yet. Drop audio files in Step 1 or paste a Discogs URL to populate this list.
                      </p>
                    )}
                    {groups.map(g => (
                      <div key={g.label} className={styles.outputNamePickerGroup}>
                        <div className={styles.outputNamePickerGroupLabel}>{g.label}</div>
                        <ul className={styles.outputNamePickerList}>
                          {g.items.map((name, i) => {
                            const selected = name === videoOutputName;
                            return (
                              <li key={`${g.label}-${i}`}>
                                <button
                                  type="button"
                                  className={`${styles.outputNamePickerItem} ${selected ? styles.outputNamePickerItemActive : ""}`}
                                  onClick={() => {
                                    setVideoOutputName(name);
                                    setShowOutputNamePicker(false);
                                  }}
                                >
                                  <span className={styles.outputNamePickerItemText}>{name}</span>
                                  {selected && <span className={styles.outputNamePickerCheck} aria-hidden="true">✓</span>}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

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
                          {img.loading || !img.thumbUrl
                            ? <span className={`${styles.imageModalThumb} ${styles.imageModalThumbLoading}`}><span className={styles.fileLoadingSpinner} /></span>
                            : <img src={img.thumbUrl} alt={img.file.name} className={styles.imageModalThumb} />}
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

        {/* Projects sidebar */}
        {showHistory && (
          <div className={styles.historySidebar}>
            <div className={styles.historyHead}>
              <h3 className={styles.historyTitle}>
                Projects
                <span className={styles.historyCurrent} title={projectName}>
                  {projectBusy === "loading" ? "Opening…" : projectBusy === "saving" ? "Saving…" : (projectName || "Untitled project")}
                </span>
              </h3>
              <div className={styles.historyHeadBtns}>
                {projects.length > 0 && (
                  <button className={styles.clearHistoryBtn} onClick={() => { if (window.confirm("Delete every saved project and all of their files?")) clearAllHistory(); }}>Clear All</button>
                )}
                <button className={styles.closeHistory} onClick={() => setShowHistory(false)}>×</button>
              </div>
            </div>

            <button className={styles.newProjectBtn} onClick={startNewProject} disabled={!!projectBusy}>
              + New project
            </button>

            {storageInfo && (
              <div className={styles.storageMeter}>
                <div className={styles.storageMeterHead}>
                  <span>Browser storage</span>
                  <span>{formatBytes(storageInfo.usage)} / {formatBytes(storageInfo.quota)}</span>
                </div>
                <div className={styles.storageMeterBar}>
                  <div
                    className={styles.storageMeterFill}
                    style={{
                      width: `${Math.min(100, storageInfo.pct * 100)}%`,
                      background: storageInfo.pct > 0.9 ? "#e53e3e" : storageInfo.pct > 0.75 ? "#dd6b20" : "#48bb78",
                    }}
                  />
                </div>
                {storageInfo.pct > 0.75 && (
                  <p className={styles.storageMeterHint}>
                    Running low — use “Free up” on a finished project to drop its source audio and rendered video while keeping its settings and images.
                  </p>
                )}
              </div>
            )}

            {projects.length === 0 ? (
              <p className={styles.historyEmpty}>No projects yet.</p>
            ) : (
              <div className={styles.projectList}>
                {projects.map(p => {
                  const jobs = renderJobs.filter(j => j.projectId === p.id);
                  const isActive = p.id === activeProjectId;
                  const total = p.bytes?.total || 0;
                  return (
                    <div key={p.id} className={`${styles.projectCard} ${isActive ? styles.projectCardActive : ""}`}>
                      <div className={styles.projectMeta}>
                        <b className={styles.projectName}>{p.name}{isActive && <span className={styles.projectOpenTag}>open</span>}</b>
                        <span className={styles.projectDate}>{new Date(p.updatedAt || p.createdAt).toLocaleString()}</span>
                        <span className={styles.projectDetails}>
                          {p.trackCount || 0} tracks · {(p.images || []).length} image{(p.images || []).length === 1 ? "" : "s"}
                          {p.video ? " · has video" : ""}
                        </span>
                        <span className={styles.projectFile}>{total ? formatBytes(total) : "no files stored"}</span>
                        {jobs.length > 0 && <RenderJobSummary jobs={jobs} />}
                      </div>
                      <div className={styles.projectBtns}>
                        {!isActive && (
                          <button className={styles.loadBtn} disabled={!!projectBusy} onClick={() => openProject(p.id)}>Open</button>
                        )}
                        {total > 0 && (
                          <button className={styles.freeUpBtn} title="Delete this project's source audio and rendered video, keeping settings and images" onClick={() => freeUpProject(p.id)}>Free up</button>
                        )}
                        <button className={styles.deleteBtn} onClick={() => deleteProjectById(p.id)}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setPreviewingTrack(null); }}
        preload="auto"
      />

      {/* Local-only resource meters. Renders null in a production build. */}
      <RipTagDevPanel
        predictedPeakMB={estimateMemoryUsage()?.totalMB ?? null}
        wasmLimitMB={WASM_MEMORY_LIMIT_MB}
        renderInputs={{
          exportedTracks: exportedTracks.length,
          selectedAudios: selectedVideoAudios.size,
          orderedAudios: renderableAudios,
          videoImages: videoImages.length,
          selectedImages: renderableImages,
        }}
      />
    </div>
  );
}

// A project can hold several jobs at once (its own render plus a batch), so the
// card shows a roll-up rather than one line per job.
function RenderJobSummary({ jobs }) {
  const running = jobs.find(j => j.status === "running");
  const queued = jobs.filter(j => j.status === "queued").length;
  if (running) {
    return (
      <span className={`${styles.jobLine} ${styles.jobLineRunning}`}>
        <span className={styles.jobChipDot} />
        Rendering {running.batch ? `“${running.label}” ` : ""}
        {running.progress != null ? `${Math.round(running.progress * 100)}%` : "…"}
        {queued > 0 ? ` · ${queued} queued` : ""}
      </span>
    );
  }
  if (queued > 0) {
    return <span className={`${styles.jobLine} ${styles.jobLineQueued}`}>{queued} render{queued === 1 ? "" : "s"} queued</span>;
  }
  const failed = jobs.filter(j => j.status === "error").length;
  const done = jobs.filter(j => j.status === "done").length;
  if (failed > 0) {
    return <span className={`${styles.jobLine} ${styles.jobLineError}`}>✕ {failed} render{failed === 1 ? "" : "s"} failed</span>;
  }
  if (done > 0) {
    return <span className={`${styles.jobLine} ${styles.jobLineDone}`}>✓ {done === 1 ? "Render complete" : `${done} renders complete`}</span>;
  }
  return <RenderJobLine job={jobs[0]} />;
}

// One line of render status inside a project card. Kept separate so the card
// re-renders on queue ticks without dragging the whole sidebar with it.
function RenderJobLine({ job }) {
  if (job.status === "running") {
    return (
      <span className={`${styles.jobLine} ${styles.jobLineRunning}`}>
        <span className={styles.jobChipDot} />
        Rendering {job.progress != null ? `${Math.round(job.progress * 100)}%` : "…"}
      </span>
    );
  }
  if (job.status === "queued") {
    return <span className={`${styles.jobLine} ${styles.jobLineQueued}`}>Queued — #{job.queuePosition} in line</span>;
  }
  if (job.status === "done") {
    return <span className={`${styles.jobLine} ${styles.jobLineDone}`}>✓ Render complete</span>;
  }
  if (job.status === "error") {
    return <span className={`${styles.jobLine} ${styles.jobLineError}`}>✕ Render failed{job.error?.oom ? " (out of memory)" : ""}</span>;
  }
  if (job.status === "cancelled") {
    return <span className={styles.jobLine}>Render cancelled</span>;
  }
  return null;
}

// Decoding a multi-hour file to draw the clip waveform blocks the main thread
// for minutes, so anything past this length opens with the waveform off and the
// text fields ready to type into. The checkbox overrides it either way.
const WAVEFORM_AUTO_SKIP_SEC = 30 * 60;
// Remembered per file for the session, so collapsing and re-expanding a row
// doesn't kick off a decode the user already opted out of.
const waveformDisabledByUrl = new Map();

// Inline panel for selecting a clip range (start/end) within an already-exported track.
// The track's file plays from 0 to its full duration; start/end are in file-relative seconds.
function TrackClipPanel({ track, range, onChange, onReset }) {
  const audioRef = useRef(null);
  const stopAtRef = useRef(null);
  const canvasRef = useRef(null);
  const [start, setStart] = useState(range.clipStart);
  const [end, setEnd] = useState(range.clipEnd);
  // Editable text for the start/end fields, shown as M:SS / H:MM:SS. Kept as
  // free text while the user types and only parsed back to seconds on
  // blur/Enter so a controlled formatter doesn't fight their keystrokes.
  const [startText, setStartText] = useState(formatClock(range.clipStart));
  const [endText, setEndText] = useState(formatClock(range.clipEnd));
  const [peaks, setPeaks] = useState(null);      // Float32Array of bar amplitudes
  const [wfStatus, setWfStatus] = useState("loading"); // loading | ready | error | off
  const [wfDisabled, setWfDisabled] = useState(() => {
    const remembered = waveformDisabledByUrl.get(track.url);
    return remembered != null ? remembered : range.fullDur > WAVEFORM_AUTO_SKIP_SEC;
  });
  const toggleWaveform = (disabled) => {
    waveformDisabledByUrl.set(track.url, disabled);
    setWfDisabled(disabled);
  };
  const [playhead, setPlayhead] = useState(null); // seconds, while previewing
  // Waveform viewport. zoom 1 = whole track; viewStart is the left edge in
  // seconds. Peaks are stored at a much finer resolution than the canvas so
  // zooming in reveals real detail instead of stretching the same bars.
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);

  const fullDur = range.fullDur;
  const durKnown = range.durKnown !== false && Number.isFinite(fullDur) && fullDur > 0;
  const isLongTrack = fullDur > WAVEFORM_AUTO_SKIP_SEC;
  const clockPlaceholder = fullDur >= 3600 ? "h:mm:ss" : "m:ss";
  const MAX_ZOOM = 200;
  const visDur = fullDur / zoom;
  const clampView = useCallback(
    (v, z = zoom) => Math.max(0, Math.min(Math.max(0, fullDur - fullDur / z), v)),
    [fullDur, zoom]
  );

  // Zoom about a fixed point in time so what you're looking at stays put.
  const zoomAround = useCallback((nextZoom, anchorSec) => {
    const z = Math.max(1, Math.min(MAX_ZOOM, nextZoom));
    const nextVis = fullDur / z;
    const anchor = anchorSec != null ? anchorSec : viewStart + fullDur / zoom / 2;
    const frac = fullDur / zoom > 0 ? (anchor - viewStart) / (fullDur / zoom) : 0.5;
    setZoom(z);
    setViewStart(Math.max(0, Math.min(Math.max(0, fullDur - nextVis), anchor - frac * nextVis)));
  }, [fullDur, zoom, viewStart]);

  // Frame the current clip with a little air on each side.
  const zoomToClip = useCallback(() => {
    const span = Math.max(0.25, end - start);
    const pad = span * 0.15;
    const z = Math.max(1, Math.min(MAX_ZOOM, fullDur / (span + pad * 2)));
    setZoom(z);
    setViewStart(Math.max(0, Math.min(Math.max(0, fullDur - fullDur / z), start - pad)));
  }, [start, end, fullDur]);

  const resetZoom = () => { setZoom(1); setViewStart(0); };

  // Sync local state when the external range changes (e.g. another row reset us)
  useEffect(() => {
    setStart(range.clipStart); setEnd(range.clipEnd);
    setStartText(formatClock(range.clipStart)); setEndText(formatClock(range.clipEnd));
  }, [range.clipStart, range.clipEnd]);

  // Decode the track once at a low sample rate and reduce it to a small set of
  // amplitude bars for the waveform. Low-rate mono keeps memory tiny (same
  // approach as the main decode) and the decoded buffer is released immediately.
  useEffect(() => {
    if (wfDisabled) { setPeaks(null); setWfStatus("off"); return; }
    let cancelled = false;
    const abort = new AbortController();
    (async () => {
      try {
        setWfStatus("loading");
        const resp = await fetch(track.url, { signal: abort.signal });
        const buf = await resp.arrayBuffer();
        if (cancelled) return;
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const decoded = await new OfflineCtx(1, 1, 8000).decodeAudioData(buf);
        if (cancelled) return;
        const data = decoded.getChannelData(0);
        // Far more bars than the canvas has pixels: the draw pass reduces this
        // to one column per pixel for whatever window is on screen, so zooming
        // in surfaces detail rather than stretching 800 bars.
        const BARS = 4000;
        const block = Math.max(1, Math.floor(data.length / BARS));
        const out = new Float32Array(BARS);
        for (let i = 0; i < BARS; i++) {
          let max = 0;
          const base = i * block;
          for (let j = 0; j < block && base + j < data.length; j++) {
            const v = Math.abs(data[base + j]);
            if (v > max) max = v;
          }
          out[i] = max;
        }
        if (!cancelled) { setPeaks(out); setWfStatus("ready"); }
      } catch {
        if (!cancelled) setWfStatus("error");
      }
    })();
    // Aborting only helps while the bytes are still being read — once
    // decodeAudioData has the buffer it runs to completion — but it does stop a
    // multi-hundred-megabyte read the moment the user ticks the box.
    return () => { cancelled = true; abort.abort(); };
  }, [track.url, wfDisabled]);

  // Draw the waveform with the selected clip region highlighted plus the
  // start/end markers and the live playhead.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !fullDur) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 64;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const view = fullDur / zoom;
    const vs = Math.max(0, Math.min(Math.max(0, fullDur - view), viewStart));
    // Seconds -> canvas x for the window currently on screen.
    const toX = (t) => ((t - vs) / view) * w;
    const sx = toX(start);
    const ex = toX(end);

    // clip region shading, clamped to the visible window
    ctx.fillStyle = "rgba(102,126,234,0.15)";
    const shadeL = Math.max(0, Math.min(w, sx));
    const shadeR = Math.max(0, Math.min(w, ex));
    ctx.fillRect(shadeL, 0, Math.max(0, shadeR - shadeL), h);

    // One column per pixel, taking the peak of whatever bars fall in it.
    const i0 = (vs / fullDur) * peaks.length;
    const i1 = ((vs + view) / fullDur) * peaks.length;
    for (let px = 0; px < w; px++) {
      const a = Math.floor(i0 + ((px) / w) * (i1 - i0));
      const b = Math.max(a + 1, Math.floor(i0 + ((px + 1) / w) * (i1 - i0)));
      let max = 0;
      for (let k = a; k < b && k < peaks.length; k++) if (peaks[k] > max) max = peaks[k];
      ctx.fillStyle = (px >= sx && px <= ex) ? "#667eea" : "#c2c7d4";
      const bh = Math.max(1, max * (h * 0.92));
      ctx.fillRect(px, mid - bh / 2, 1, bh);
    }

    // start / end markers (only when they're in view)
    if (sx >= -2 && sx <= w + 2) { ctx.fillStyle = "#2f9e44"; ctx.fillRect(sx - 1, 0, 2, h); }
    if (ex >= -2 && ex <= w + 2) { ctx.fillStyle = "#e64980"; ctx.fillRect(ex - 1, 0, 2, h); }
    // playhead
    if (playhead != null) {
      const px = toX(playhead);
      if (px >= 0 && px <= w) { ctx.fillStyle = "#1a1a2e"; ctx.fillRect(px - 0.5, 0, 1, h); }
    }

    // While zoomed, a strip along the bottom shows where you are in the track.
    if (zoom > 1) {
      ctx.fillStyle = "rgba(0,0,0,0.10)";
      ctx.fillRect(0, h - 4, w, 4);
      ctx.fillStyle = "rgba(102,126,234,0.85)";
      ctx.fillRect((vs / fullDur) * w, h - 4, Math.max(2, (view / fullDur) * w), 4);
    }
  }, [peaks, start, end, fullDur, playhead, zoom, viewStart]);

  const commit = (newStart, newEnd) => {
    // With an unreadable duration there is nothing sane to clamp against —
    // clamping to 0 is what made every typed start time snap back to 0:00.
    const limit = durKnown ? fullDur : Infinity;
    const ns = Math.max(0, Math.min(limit, newStart));
    const ne = Math.max(ns, Math.min(limit, newEnd));
    setStart(ns); setEnd(ne);
    setStartText(formatClock(ns)); setEndText(formatClock(ne));
    if (ns === 0 && ne === fullDur) onReset();
    else onChange(ns, ne);
  };

  const playClip = () => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = start;
    stopAtRef.current = end;
    a.play();
  };

  const onTimeUpdate = () => {
    const a = audioRef.current;
    if (!a) return;
    setPlayhead(a.currentTime);
    if (stopAtRef.current != null && a.currentTime >= stopAtRef.current) {
      a.pause();
      stopAtRef.current = null;
    }
  };

  const setStartHere = () => {
    if (audioRef.current) commit(audioRef.current.currentTime, end);
  };
  const setEndHere = () => {
    if (audioRef.current) commit(start, audioRef.current.currentTime);
  };

  // Click the waveform to move the audio playhead to that point.
  const timeAtClientX = (clientX) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return clampView(viewStart) + frac * visDur;
  };

  const onWaveClick = (e) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = timeAtClientX(e.clientX);
    setPlayhead(a.currentTime);
  };

  // Wheel zooms about the cursor; shift+wheel pans. Bound natively with
  // { passive: false } — React's synthetic wheel handler can't preventDefault
  // reliably, and without it the page scrolls out from under the gesture.
  const wheelStateRef = useRef(null);
  wheelStateRef.current = { peaks, zoom, viewStart, visDur, fullDur };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      const st = wheelStateRef.current;
      if (!st?.peaks) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const at = st.viewStart + frac * st.visDur;
      if (e.shiftKey) {
        const maxStart = Math.max(0, st.fullDur - st.visDur);
        setViewStart(Math.max(0, Math.min(maxStart, st.viewStart + (e.deltaY / 400) * st.visDur)));
        return;
      }
      zoomAround(st.zoom * (e.deltaY < 0 ? 1.25 : 1 / 1.25), at);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [wfStatus, zoomAround]);

  return (
    <div className={styles.clipPanel}>
      <div
        className={`${styles.clipWaveWrap} ${wfStatus === "ready" ? "" : styles.clipWaveWrapIdle}`}
        title={wfStatus === "ready" ? "Click to move the playhead · scroll to zoom · shift+scroll to pan" : undefined}
      >
        {wfStatus === "ready" ? (
          <canvas ref={canvasRef} className={styles.clipWaveCanvas} onClick={onWaveClick} />
        ) : (
          <div className={styles.clipWaveStatus}>
            {wfStatus === "off" && "Waveform off — type the start and end times below, or scrub the player."}
            {wfStatus === "error" && "Waveform unavailable"}
            {wfStatus === "loading" && (
              <>
                <span className={styles.spinnerInline} /> Loading waveform…
                {isLongTrack && " This track is long, so this can take a while — tick “Disable waveform” to skip it."}
              </>
            )}
          </div>
        )}
      </div>
      <div className={styles.clipWaveToggleRow}>
        <label className={styles.clipWaveToggle} title="Drawing the waveform means decoding the whole file, which is slow on multi-hour rips. The start/end fields work either way.">
          <input type="checkbox" checked={wfDisabled} onChange={e => toggleWaveform(e.target.checked)} />
          Disable waveform
        </label>
        {wfDisabled && isLongTrack && (
          <span className={styles.clipWaveToggleHint}>Off by default over {Math.round(WAVEFORM_AUTO_SKIP_SEC / 60)} min.</span>
        )}
        {!durKnown && (
          <span className={styles.clipWaveToggleHint}>
            Track length unknown — start/end still apply, they just aren&apos;t bounded.
          </span>
        )}
      </div>
      {wfStatus === "ready" && (
        <div className={styles.clipZoomRow}>
          <span className={styles.clipZoomLabel}>Zoom</span>
          <button type="button" className={styles.clipZoomBtn} onClick={() => zoomAround(zoom / 1.6)} disabled={zoom <= 1} title="Zoom out">−</button>
          <span className={styles.clipZoomValue}>{zoom < 1.05 ? "Fit" : `${zoom.toFixed(1)}×`}</span>
          <button type="button" className={styles.clipZoomBtn} onClick={() => zoomAround(zoom * 1.6)} disabled={zoom >= MAX_ZOOM} title="Zoom in">+</button>
          <button type="button" className={styles.clipZoomTextBtn} onClick={zoomToClip} title="Frame the current clip">Fit clip</button>
          <button type="button" className={styles.clipZoomTextBtn} onClick={resetZoom} disabled={zoom <= 1} title="Show the whole track">Whole track</button>
          {zoom > 1 && (
            <input
              type="range"
              className={styles.clipPanSlider}
              min="0"
              max={Math.max(0, fullDur - visDur)}
              step={Math.max(0.01, visDur / 200)}
              value={clampView(viewStart)}
              onChange={e => setViewStart(clampView(parseFloat(e.target.value)))}
              title="Scroll through the track"
            />
          )}
          <span className={styles.clipZoomWindow}>
            {zoom > 1
              ? `${formatClock(clampView(viewStart))} – ${formatClock(clampView(viewStart) + visDur)}`
              : `${formatClock(fullDur)} shown`}
          </span>
        </div>
      )}
      <audio ref={audioRef} src={track.url} controls preload="metadata" onTimeUpdate={onTimeUpdate} className={styles.clipAudio} />
      <div className={styles.clipControlsRow}>
        <label className={styles.clipField}>
          <span>Start</span>
          <input
            type="text" inputMode="numeric" placeholder={clockPlaceholder}
            value={startText}
            onChange={e => setStartText(e.target.value)}
            onBlur={() => commit(parseClock(startText), end)}
            onKeyDown={e => { if (e.key === "Enter") { commit(parseClock(startText), end); e.target.blur(); } }}
          />
          <button type="button" onClick={setStartHere} title="Use current playhead">⏱</button>
        </label>
        <label className={styles.clipField}>
          <span>End</span>
          <input
            type="text" inputMode="numeric" placeholder={clockPlaceholder}
            value={endText}
            onChange={e => setEndText(e.target.value)}
            onBlur={() => commit(start, parseClock(endText))}
            onKeyDown={e => { if (e.key === "Enter") { commit(start, parseClock(endText)); e.target.blur(); } }}
          />
          <button type="button" onClick={setEndHere} title="Use current playhead">⏱</button>
        </label>
        <button type="button" className={styles.clipPlayBtn} onClick={playClip}>▶ Preview clip</button>
        <button type="button" className={styles.clipResetBtn} onClick={() => commit(0, fullDur)} disabled={!range.isClipped || !durKnown}>Reset to full</button>
        <span className={styles.clipDurLabel}>Clip: {formatClock(end - start)} · Track: {durKnown ? formatClock(fullDur) : "unknown"}</span>
      </div>
    </div>
  );
}
