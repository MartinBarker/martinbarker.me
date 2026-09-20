"use client";
// Bandcamp Poster — a Bandcamp track URL in, a 1080x1920 video out.
//
// The frame is the one /riptag renders: the cover art sharp and centred over a
// heavily blurred, oversized copy of itself (or, optionally here, over a flat
// colour). Both pages build that frame from riptag/videoLayout.js, so the blur
// radius, the drift and the Ken Burns move are defined once and can't drift
// apart.
//
// Everything except the two fetches happens in the browser. Bandcamp sends no
// CORS header, so the page HTML and the media are read through
// /api/bandcamp/*; the encode itself is ffmpeg.wasm, same as riptag.
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import styles from "./bandcamposter.module.css";
import { decodeToPeaks } from "../riptag/audioPeaks";
import { extractPalette, toHex, isLight } from "./palette";
import {
  BG_BLUR_DEFAULT, BG_BLUR_MAX, clampBgBlur, bgBlurPreviewPx,
  BG_DRIFT_PERIOD, BG_DRIFT_ZOOM, BG_DRIFT_AMOUNT,
  MOTION_SPEED_MIN, MOTION_SPEED_MAX, MOTION_SPEED_STEP,
  clampMotionSpeed, blurBackdropChain, motionZoompanFilter,
  STILL_FPS, IMAGE_MOTIONS, BG_MOTIONS, evenDimension,
} from "../riptag/videoLayout";

// The one output size this page makes: a 9:16 portrait frame.
const OUT_W = 1080;
const OUT_H = 1920;
const MOTION_FPS = 24;   // anything moving needs a real frame rate

// Seconds for one full revolution of the cover at 1x. A record turns once
// every 1.8s, which reads as a blur on a 30-second clip; this is a slow,
// watchable turn, and the speed slider covers 48s down to 3s a revolution.
const SPIN_PERIOD = 12;

// Same core as riptag, from the same CDN, built once per page load and shared
// with every FFmpeg instance (it is ~32MB, and re-fetching it per render was
// the bulk of the wait before anything happened).
const FFMPEG_CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
let ffmpegCorePromise = null;
function loadFFmpegCore() {
  if (!ffmpegCorePromise) {
    ffmpegCorePromise = (async () => ({
      coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    }))();
    ffmpegCorePromise.catch(() => { ffmpegCorePromise = null; });
  }
  return ffmpegCorePromise;
}

const fmtTime = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtBytes = (n) => {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
// m:ss, or h:mm:ss once past an hour. Used by the trim fields, which stay
// free text while being typed and are only parsed back on blur/Enter so a
// controlled formatter can't fight the keystrokes.
const formatClock = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
};
const parseClock = (text) => {
  const parts = String(text).trim().split(":").map(p => p.trim());
  if (!parts.length || parts.some(p => p !== "" && !/^\d*\.?\d*$/.test(p))) return null;
  const nums = parts.map(p => (p === "" ? 0 : parseFloat(p)));
  if (nums.some(n => !isFinite(n))) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
};

// ffmpeg's VFS is happier with plain names than with a track title.
const safeName = (s, fallback) =>
  (String(s || "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || fallback);

// An ffmpeg expression can't carry a bare "+-12", so a signed nudge is
// formatted rather than concatenated.
const signed = (n) => `${n < 0 ? "-" : "+"}${Math.abs(Math.round(n))}`;

// ---- Caption ----
// Drawn on a 2D canvas at the output size and handed to ffmpeg as one
// transparent PNG, exactly as riptag does it. That keeps the on-page preview
// and the encoded frame pixel-identical, and means nothing depends on
// drawtext/libfreetype being compiled into the ffmpeg.wasm core.
// Grouped so the list stays navigable. Every stack ends in a generic family,
// so a machine without the first choice falls back somewhere sensible rather
// than to the browser default.
const CAPTION_FONTS = [
  { group: "Sans serif", fonts: [
    { label: "System UI", value: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    { label: "Arial", value: "Arial, Helvetica, sans-serif" },
    { label: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
    { label: "Segoe UI", value: '"Segoe UI", Tahoma, sans-serif' },
    { label: "Roboto", value: 'Roboto, "Helvetica Neue", Arial, sans-serif' },
    { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
    { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
    { label: "Trebuchet MS", value: '"Trebuchet MS", Helvetica, sans-serif' },
    { label: "Lucida Sans", value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
    { label: "Avenir", value: '"Avenir Next", Avenir, "Segoe UI", sans-serif' },
    { label: "Futura", value: 'Futura, "Century Gothic", AppleGothic, sans-serif' },
    { label: "Gill Sans", value: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif' },
    { label: "Optima", value: 'Optima, Candara, "Segoe UI", sans-serif' },
    { label: "Franklin Gothic", value: '"Franklin Gothic Medium", "Arial Narrow", sans-serif' },
  ]},
  { group: "Serif", fonts: [
    { label: "Georgia", value: 'Georgia, "Times New Roman", serif' },
    { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
    { label: "Garamond", value: 'Garamond, "EB Garamond", Baskerville, serif' },
    { label: "Baskerville", value: 'Baskerville, "Baskerville Old Face", Georgia, serif' },
    { label: "Palatino", value: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
    { label: "Didot", value: 'Didot, "Bodoni MT", "Times New Roman", serif' },
    { label: "Rockwell", value: 'Rockwell, "Courier Bold", Georgia, serif' },
  ]},
  { group: "Display", fonts: [
    { label: "Impact", value: "Impact, Haettenschweiler, sans-serif" },
    { label: "Arial Black", value: '"Arial Black", "Arial Bold", Gadget, sans-serif' },
    { label: "Copperplate", value: 'Copperplate, "Copperplate Gothic Light", fantasy' },
    { label: "Brush Script", value: '"Brush Script MT", "Segoe Script", cursive' },
  ]},
  { group: "Monospace", fonts: [
    { label: "Courier New", value: '"Courier New", Courier, monospace' },
    { label: "Consolas", value: 'Consolas, "Andale Mono", monospace' },
    { label: "Menlo", value: 'Menlo, Monaco, "Courier New", monospace' },
  ]},
];
const DEFAULT_FONT = CAPTION_FONTS[0].fonts[0].value;

const CAPTION_POSITIONS = [
  { value: "below-art", label: "Under the cover" },
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
];
const DEFAULT_CAPTION = {
  enabled: true,
  position: "below-art",
  fontFamily: DEFAULT_FONT,
  titleSize: 4.2,      // % of output height
  artistSize: 2.6,
  color: "#ffffff",
  shadow: true,
  uppercase: false,
};

function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = `${cur} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) cur = test;
    else { lines.push(cur); cur = words[i]; }
  }
  lines.push(cur);
  return lines;
}

// Draws the caption into an already-sized context. `artBottom` is the lowest
// point the cover reaches, so "under the cover" sits clear of it whatever the
// cover's size, shape or spin.
function drawCaption(ctx, { title, artist }, cap, w, h, artBottom) {
  if (!cap.enabled) return;
  const text = cap.uppercase ? String(title || "").toUpperCase() : String(title || "");
  if (!text.trim() && !artist) return;

  const titlePx = Math.max(10, Math.round((cap.titleSize / 100) * h));
  const artistPx = Math.max(8, Math.round((cap.artistSize / 100) * h));
  const maxW = w * 0.86;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (cap.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = Math.round(titlePx * 0.3);
    ctx.shadowOffsetY = Math.round(titlePx * 0.08);
  }

  const family = cap.fontFamily || DEFAULT_FONT;
  ctx.font = `700 ${titlePx}px ${family}`;
  const titleLines = wrapLines(ctx, text, maxW);
  const titleLead = Math.round(titlePx * 1.18);
  const artistLead = artist ? Math.round(artistPx * 1.6) : 0;
  const blockH = titleLines.length * titleLead + artistLead;

  // Each position anchors the block somewhere different; "under the cover"
  // hangs it off the art so the two move together.
  const gap = Math.round(h * 0.045);
  let top;
  if (cap.position === "top") top = Math.round(h * 0.08);
  else if (cap.position === "bottom") top = Math.round(h - h * 0.09 - blockH);
  else top = Math.round(Math.min(artBottom + gap, h - h * 0.06 - blockH));

  ctx.fillStyle = cap.color;
  titleLines.forEach((line, i) => {
    ctx.fillText(line, w / 2, top + titleLead * i + Math.round(titlePx * 0.86));
  });
  if (artist) {
    ctx.font = `500 ${artistPx}px ${family}`;
    ctx.globalAlpha = 0.88;
    ctx.fillText(artist, w / 2, top + titleLines.length * titleLead + Math.round(artistPx * 1.1));
  }
  ctx.restore();
}

// ---- Cover ----
// The cover is rasterised to a square PNG in the browser before it ever
// reaches ffmpeg: a circular cover is a clip path here rather than a `geq`
// alpha expression in the filtergraph, which keeps the preview and the encode
// identical and avoids depending on `geq` being compiled into the wasm core.
// A square cover is fitted inside the box; a circular one fills it, so the
// circle is never cut short by a letterbox edge.
function renderCoverCanvas(img, boxPx, shape) {
  const c = document.createElement("canvas");
  c.width = boxPx; c.height = boxPx;
  const ctx = c.getContext("2d");
  const fit = shape === "circle"
    ? Math.max(boxPx / img.naturalWidth, boxPx / img.naturalHeight)
    : Math.min(boxPx / img.naturalWidth, boxPx / img.naturalHeight);
  const dw = img.naturalWidth * fit, dh = img.naturalHeight * fit;
  if (shape === "circle") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(boxPx / 2, boxPx / 2, boxPx / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, (boxPx - dw) / 2, (boxPx - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(img, (boxPx - dw) / 2, (boxPx - dh) / 2, dw, dh);
  }
  return c;
}

// Where the cover sits and how far down it reaches. Shared by the preview and
// the encode so the two agree on the overlay position and the caption's anchor.
function coverGeometry(img, { artScale, artOffset, shape, spin }, w, h) {
  const boxPx = Math.round(w * artScale);
  const centerY = h / 2 + (artOffset / 100) * h;
  let half;
  if (shape === "circle") {
    // A circle is the same size whatever angle it is at, so spin changes nothing.
    half = boxPx / 2;
  } else {
    const fit = Math.min(boxPx / img.naturalWidth, boxPx / img.naturalHeight);
    // A spinning square sweeps its corners out to the diagonal, and the
    // caption has to clear that, not just the upright edge.
    half = spin ? (Math.SQRT2 * boxPx) / 2 : (img.naturalHeight * fit) / 2;
  }
  return { boxPx, centerY, bottom: centerY + half };
}

const canvasToPngBytes = async (canvas) => {
  const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("The browser couldn't rasterise a frame layer.");
  return new Uint8Array(await blob.arrayBuffer());
};

// ---- Colour field ----
// A swatch and hex readout, the cover's own colours as one-click presets, and
// an eyedropper that samples any pixel of the artwork. The eyedropper reads
// from a canvas rather than the <img> because only a canvas exposes pixels;
// it is same-origin (a blob URL from the proxy) so it is never tainted.
const EYEDROPPER_PX = 168;

function ColorField({ value, onChange, palette, artImg, resetTo, resetLabel, label }) {
  const [picking, setPicking] = useState(false);
  const [hover, setHover] = useState(null);     // hex under the cursor, while dragging
  const canvasRef = useRef(null);
  const dragRef = useRef(false);

  // Draw the cover once the picker is open. Kept at a fixed size so the
  // pointer-to-pixel mapping stays simple.
  useEffect(() => {
    if (!picking || !artImg) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = EYEDROPPER_PX; canvas.height = EYEDROPPER_PX;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(artImg, 0, 0, EYEDROPPER_PX, EYEDROPPER_PX);
  }, [picking, artImg]);

  const sampleAt = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = Math.floor(((clientX - r.left) / r.width) * canvas.width);
    const y = Math.floor(((clientY - r.top) / r.height) * canvas.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
    try {
      const d = canvas.getContext("2d", { willReadFrequently: true })
        .getImageData(x, y, 1, 1).data;
      return toHex(d[0], d[1], d[2]);
    } catch {
      return null;
    }
  }, []);

  const onPointerDown = (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not captureable */ }
    dragRef.current = true;
    const hex = sampleAt(e.clientX, e.clientY);
    if (hex) { setHover(hex); onChange(hex); }
  };
  const onPointerMove = (e) => {
    const hex = sampleAt(e.clientX, e.clientY);
    if (!hex) return;
    setHover(hex);
    // Dragging scrubs the colour live, so the choice can be judged against the
    // preview instead of guessed at from a thumbnail.
    if (dragRef.current) onChange(hex);
  };
  const endDrag = () => { dragRef.current = false; };

  return (
    <div className={styles.colorField}>
      <div className={styles.sliderRow}>
        <input className={styles.colorInput} type="color" value={value}
          aria-label={label}
          onChange={e => onChange(e.target.value)} />
        <span className={styles.sliderValue}>{label} {value}</span>
        {resetTo && value.toLowerCase() !== resetTo.toLowerCase() && (
          <button type="button" className={styles.linkBtn}
            onClick={() => onChange(resetTo)}>{resetLabel}</button>
        )}
      </div>

      {palette.length > 0 && (
        <div className={styles.swatchRow}>
          {palette.map(hex => (
            <button
              key={hex}
              type="button"
              title={`Use ${hex} from the artwork`}
              aria-label={`Use ${hex} from the artwork`}
              className={`${styles.swatch} ${isLight(hex) ? styles.swatchLight : ""} `
                + `${value.toLowerCase() === hex.toLowerCase() ? styles.swatchOn : ""}`}
              style={{ background: hex }}
              onClick={() => onChange(hex)}
            />
          ))}
          {artImg && (
            <button type="button" className={styles.linkBtn}
              onClick={() => { setPicking(v => !v); setHover(null); }}>
              {picking ? "Done" : "Pick from artwork"}
            </button>
          )}
        </div>
      )}

      {picking && artImg && (
        <div className={styles.eyedropper}>
          <canvas
            ref={canvasRef}
            className={styles.eyedropperCanvas}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => { endDrag(); setHover(null); }}
          />
          <span className={styles.eyedropperHint}>
            {hover
              ? <><span className={styles.eyedropperChip} style={{ background: hover }} />{hover}</>
              : "Click or drag on the artwork"}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- Audio trim ----
// riptag's clip panel, narrowed to the one file this page handles: a waveform
// with draggable ends, typed start/end times, and a preview that plays only
// the selection. The handles listen for pointer events rather than mouse
// events so they drag under a finger as well as a cursor.
const MIN_CLIP = 0.5;   // seconds; below this there is nothing to render

function TrimPanel({ audioBlob, fullDur, clip, onChange, disabled }) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const [peaks, setPeaks] = useState(null);
  const [status, setStatus] = useState("loading");
  const [playhead, setPlayhead] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [drag, setDrag] = useState(null);      // "start" | "end" | null
  const [startText, setStartText] = useState(formatClock(clip.start));
  const [endText, setEndText] = useState(formatClock(clip.end));

  // Created and revoked in the same effect on purpose. Split across a useMemo
  // and a cleanup, StrictMode's mount/cleanup/mount revoked the URL while the
  // memo kept returning the same now-dead string, and the <audio> below had
  // nothing to play.
  const [objUrl, setObjUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(audioBlob);
    setObjUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [audioBlob]);

  // Decoded once per file. arrayBuffer() hands decodeAudioData its own copy,
  // so the blob the renderer later reads is untouched.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus("loading");
        const { peaks: p } = await decodeToPeaks(await audioBlob.arrayBuffer());
        if (!cancelled) { setPeaks(p); setStatus("ready"); }
      } catch {
        // No waveform is survivable — the time fields still work.
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [audioBlob]);

  // Follow the range when it is changed from outside (a reset, a new track).
  useEffect(() => {
    setStartText(formatClock(clip.start));
    setEndText(formatClock(clip.end));
  }, [clip.start, clip.end]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !(fullDur > 0)) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 72;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const toX = (t) => (t / fullDur) * w;

    // One column per pixel, each the loudest bar that falls inside it.
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((x / w) * peaks.length);
      const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * peaks.length));
      let max = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > max) max = peaks[i];
      const barH = Math.max(1, max * (h * 0.46));
      const t = (x / w) * fullDur;
      ctx.fillStyle = (t >= clip.start && t <= clip.end) ? "#4f46e5" : "rgba(148,163,184,0.5)";
      ctx.fillRect(x, mid - barH, 1, barH * 2);
    }

    // Everything outside the selection is dimmed, so what will be rendered is
    // readable at a glance rather than having to be inferred from the markers.
    ctx.fillStyle = "rgba(15,17,23,0.45)";
    ctx.fillRect(0, 0, toX(clip.start), h);
    ctx.fillRect(toX(clip.end), 0, w - toX(clip.end), h);

    if (playhead != null) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(toX(playhead) - 1, 0, 2, h);
    }
    for (const [t, color] of [[clip.start, "#22c55e"], [clip.end, "#ef4444"]]) {
      const x = toX(t);
      ctx.fillStyle = color;
      ctx.fillRect(x - 1.5, 0, 3, h);
      ctx.fillRect(x - 7, 0, 14, 9);          // a grab tab at the top
      ctx.fillRect(x - 7, h - 9, 14, 9);
    }
  }, [peaks, fullDur, clip, playhead]);

  const timeAt = useCallback((clientX) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.max(0, Math.min(fullDur, ((clientX - r.left) / r.width) * fullDur));
  }, [fullDur]);

  const apply = useCallback((which, t) => {
    if (which === "start") onChange({ start: Math.min(t, clip.end - MIN_CLIP), end: clip.end });
    else onChange({ start: clip.start, end: Math.max(t, clip.start + MIN_CLIP) });
  }, [clip.start, clip.end, onChange]);

  const onPointerDown = (e) => {
    if (disabled || !(fullDur > 0)) return;
    e.preventDefault();
    const t = timeAt(e.clientX);
    // Grab whichever end is nearer, so there is no handle to hit precisely.
    const which = Math.abs(t - clip.start) <= Math.abs(t - clip.end) ? "start" : "end";
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not captureable */ }
    setDrag(which);
    apply(which, t);
  };

  const commitStart = () => {
    const v = parseClock(startText);
    if (v == null) { setStartText(formatClock(clip.start)); return; }
    apply("start", Math.max(0, Math.min(fullDur, v)));
  };
  const commitEnd = () => {
    const v = parseClock(endText);
    if (v == null) { setEndText(formatClock(clip.end)); return; }
    apply("end", Math.max(0, Math.min(fullDur, v)));
  };

  // Preview plays the selection and stops at its end rather than running on.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    const onTime = () => {
      setPlayhead(el.currentTime);
      if (el.currentTime >= clip.end) { el.pause(); setPlaying(false); setPlayhead(null); }
    };
    const onEnd = () => { setPlaying(false); setPlayhead(null); };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, [clip.end]);

  const [playError, setPlayError] = useState("");

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); setPlayhead(null); return; }
    setPlayError("");
    try {
      // A seek before the metadata arrives is discarded, which would start the
      // preview at zero instead of at the clip.
      if (el.readyState < 1) {
        await new Promise((res, rej) => {
          const done = () => { off(); res(); };
          const fail = () => { off(); rej(new Error("the browser couldn't decode this audio")); };
          const off = () => {
            el.removeEventListener("loadedmetadata", done);
            el.removeEventListener("error", fail);
          };
          el.addEventListener("loadedmetadata", done);
          el.addEventListener("error", fail);
          el.load();
        });
      }
      el.currentTime = clip.start;
      await el.play();
      setPlaying(true);
    } catch (e) {
      // Autoplay policy, a decode failure, a revoked URL — say so rather than
      // leaving a button that looks like it does nothing.
      setPlaying(false);
      setPlayError(e?.message || "Playback failed.");
    }
  }, [playing, clip.start]);

  const clipDur = Math.max(0, clip.end - clip.start);
  const trimmed = clip.start > 0.01 || clip.end < fullDur - 0.01;

  return (
    <div className={styles.trimPanel}>
      <div
        className={`${styles.trimCanvasWrap} ${disabled ? styles.trimDisabled : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => { if (drag) apply(drag, timeAt(e.clientX)); }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <canvas ref={canvasRef} className={styles.trimCanvas} />
        {status === "loading" && <div className={styles.trimOverlay}>Reading waveform…</div>}
        {status === "error" && (
          <div className={styles.trimOverlay}>
            Waveform unavailable — use the time fields below.
          </div>
        )}
      </div>

      <div className={styles.trimControls}>
        <button type="button" className={styles.trimPlayBtn} onClick={togglePlay} disabled={disabled}>
          {playing ? "⏸ Stop" : "▶ Play selection"}
        </button>
        <label className={styles.trimField}>
          Start
          <input
            className={styles.trimInput}
            value={startText}
            disabled={disabled}
            placeholder={fullDur >= 3600 ? "h:mm:ss" : "m:ss"}
            onChange={e => setStartText(e.target.value)}
            onBlur={commitStart}
            onKeyDown={e => { if (e.key === "Enter") { commitStart(); e.target.blur(); } }}
          />
        </label>
        <label className={styles.trimField}>
          End
          <input
            className={styles.trimInput}
            value={endText}
            disabled={disabled}
            placeholder={fullDur >= 3600 ? "h:mm:ss" : "m:ss"}
            onChange={e => setEndText(e.target.value)}
            onBlur={commitEnd}
            onKeyDown={e => { if (e.key === "Enter") { commitEnd(); e.target.blur(); } }}
          />
        </label>
        {playError && <span className={styles.trimError}>{playError}</span>}
        <span className={styles.trimSummary}>
          {trimmed
            ? `${formatClock(clipDur)} of ${formatClock(fullDur)}`
            : `full track · ${formatClock(fullDur)}`}
        </span>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => onChange({ start: 0, end: fullDur })}
          disabled={disabled || !trimmed}
        >
          Reset to full
        </button>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      {objUrl && <audio ref={audioRef} src={objUrl} preload="metadata" />}
    </div>
  );
}

export default function BandcamposterPage() {
  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [meta, setMeta] = useState(null);
  const [trackIdx, setTrackIdx] = useState(0);
  const [error, setError] = useState("");

  // Fetched media, held as blobs for the renderer.
  const [media, setMedia] = useState(null);   // { audio, art, artImg, artObjUrl, duration }
  const [fetching, setFetching] = useState("");

  // Frame settings — the same knobs as a riptag image row, plus this page's own.
  const [bgMode, setBgMode] = useState("blur");     // "blur" | "solid"
  const [bgColor, setBgColor] = useState("#000000");
  const [bgBlur, setBgBlur] = useState(BG_BLUR_DEFAULT);
  const [bgMotion, setBgMotion] = useState("drift");
  const [bgSpeed, setBgSpeed] = useState(1);
  const [motion, setMotion] = useState("none");
  const [motionSpeed, setMotionSpeed] = useState(1);
  const [artScale, setArtScale] = useState(0.82);
  const [artOffset, setArtOffset] = useState(-8);   // % of height, negative = up
  const [shape, setShape] = useState("square");     // "square" | "circle"
  const [spin, setSpin] = useState(false);
  const [spinSpeed, setSpinSpeed] = useState(1);
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  // Which slice of the audio the video covers. null until a file is loaded.
  const [clip, setClip] = useState(null);
  // The blurb that goes with the video wherever it's posted. Generated from the
  // page's metadata, but editable — Bandcamp's own fields are often not quite
  // how you'd word it. null means "still following the generated text".
  const [postEdit, setPostEdit] = useState(null);
  const [copied, setCopied] = useState(false);

  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logLines, setLogLines] = useState([]);
  const [output, setOutput] = useState(null);   // { url, size, name }

  const ffRef = useRef(null);
  const previewRef = useRef(null);
  const cancelRef = useRef(false);

  const track = meta?.tracks?.[trackIdx] || null;
  const fullDur = media?.duration || track?.duration || 0;
  const clipStart = clip ? clip.start : 0;
  const clipEnd = clip ? clip.end : fullDur;
  // `duration` is the length that actually gets rendered, so every estimate,
  // progress reading and -t below follows the trim without further thought.
  const duration = Math.max(0, clipEnd - clipStart);
  const trimmed = clipStart > 0.01 || clipEnd < fullDur - 0.01;
  // Two plain-text lines: the track, then when and who put it out. Anything
  // Bandcamp didn't supply is dropped rather than left as an empty separator.
  const generatedPost = useMemo(() => {
    if (!meta || !track) return "";
    const line1 = [track.title, meta.artist].filter(Boolean).join(" - ");
    const line2 = [meta.year, meta.label].filter(Boolean).join(" - ");
    // Spaces and punctuation come out so "New York" reads as one tag; the
    // artist's own capitalisation stays, since that is how they wrote it.
    const line3 = (meta.tags || [])
      .map(t => "#" + t.replace(/[^\p{L}\p{N}]+/gu, ""))
      .filter(h => h.length > 1)
      .join(" ");
    return [line1, line2, meta.pageUrl, line3].filter(Boolean).join("\n");
  }, [meta, track]);
  const postText = postEdit ?? generatedPost;

  const copyPost = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(postText);
    } catch {
      // clipboard.writeText needs a secure context, which a plain-http LAN
      // address isn't — fall back so this still works when testing locally.
      const ta = document.createElement("textarea");
      ta.value = postText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* nothing left to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
  }, [postText]);

  // Reset the "Copied" flash, and drop it the moment the text changes again.
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  useEffect(() => { setCopied(false); }, [postText]);
  // A new lookup or a different track means the old blurb no longer applies.
  useEffect(() => { setPostEdit(null); }, [meta, trackIdx]);

  const driftOn = bgMode === "blur" && bgMotion === "drift";
  const anyMotion = motion !== "none" || driftOn || spin;
  const outFps = anyMotion ? MOTION_FPS : STILL_FPS;
  // Seconds per revolution at the chosen speed — the number the preview
  // animates at and the number the rotate filter is given.
  const spinPeriod = SPIN_PERIOD / clampMotionSpeed(spinSpeed);

  const log = useCallback((line) => {
    setLogLines(prev => [...prev.slice(-250), line]);
  }, []);

  // A square cover spinning on its corners rarely looks like what anyone wants
  // from "rotate"; a circular one reads as a record. So turning spin on moves a
  // still-default square cover to a circle, which the shape control then undoes
  // if that wasn't the idea.
  const toggleSpin = useCallback((on) => {
    setSpin(on);
    if (on && shape === "square") setShape("circle");
  }, [shape]);

  // A freshly downloaded file starts untrimmed.
  useEffect(() => {
    setClip(media ? { start: 0, end: media.duration } : null);
  }, [media]);

  // Warm the core as soon as there is something to render, so pressing Render
  // doesn't start with a 32MB download.
  useEffect(() => { if (media) loadFFmpegCore().catch(() => {}); }, [media]);

  useEffect(() => () => { if (output?.url) URL.revokeObjectURL(output.url); }, [output]);

  // Leaving the page mid-render would otherwise leave an FFmpeg worker running
  // with the audio and artwork still in its in-memory filesystem. Terminating
  // it tears the worker down and takes that filesystem with it.
  useEffect(() => () => {
    try { ffRef.current?.terminate(); } catch { /* already gone */ }
    ffRef.current = null;
  }, []);

  // ---- Step 1: read the Bandcamp page ----
  const resolve = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setResolving(true); setError(""); setMeta(null); setMedia(null); setOutput(null);
    try {
      const res = await fetch(`/api/bandcamp/resolve?url=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Lookup failed (${res.status})`);
      setMeta(data);
      setTrackIdx(0);
    } catch (e) {
      setError(e.message);
    } finally {
      setResolving(false);
    }
  }, [url]);

  // ---- Step 2: pull the audio and the cover through the proxy ----
  const proxied = (u) => `/api/bandcamp/media?url=${encodeURIComponent(u)}`;

  const fetchMedia = useCallback(async () => {
    if (!meta || !track) return;
    setError(""); setOutput(null); setFetching("Downloading cover art…");
    try {
      // The API offers the original upload first and a 1200px JPEG second; the
      // original is occasionally missing, so they are tried in order.
      let artBlob = null;
      for (const candidate of meta.art) {
        try {
          const r = await fetch(proxied(candidate));
          if (r.ok) { artBlob = await r.blob(); break; }
        } catch { /* try the next size */ }
      }
      if (!artBlob) throw new Error("Couldn't download the cover art.");

      setFetching("Downloading audio…");
      const aRes = await fetch(proxied(track.audioUrl));
      if (!aRes.ok) {
        const j = await aRes.json().catch(() => ({}));
        throw new Error(j.error || `Audio download failed (${aRes.status})`);
      }
      const audioBlob = await aRes.blob();

      setFetching("Reading media…");
      const artObjUrl = URL.createObjectURL(artBlob);
      let artImg;
      try {
        artImg = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error("The cover art didn't decode."));
          im.src = artObjUrl;
        });
      } finally {
        // A decoded <img> holds its own pixels, so the URL is finished with
        // either way — and it must not outlive a failed decode.
        URL.revokeObjectURL(artObjUrl);
      }

      // Bandcamp's own duration is usually right, but the file is the authority
      // — a render cut short or padded with silence is the visible symptom.
      const probeUrl = URL.createObjectURL(audioBlob);
      const probed = await new Promise((resolve) => {
        const el = document.createElement("audio");
        el.preload = "metadata";
        el.onloadedmetadata = () => resolve(isFinite(el.duration) ? el.duration : 0);
        el.onerror = () => resolve(0);
        el.src = probeUrl;
      });
      URL.revokeObjectURL(probeUrl);

      setMedia({
        audio: audioBlob,
        art: artBlob,
        artImg,
        duration: probed || track.duration || 0,
      });
      setFetching("");
    } catch (e) {
      setError(e.message);
      setFetching("");
    }
  }, [meta, track]);

  // The cover's own colours, read once per cover and offered as presets.
  const palette = useMemo(
    () => (media?.artImg ? extractPalette(media.artImg) : []),
    [media]);

  // The shaped cover, rasterised once per shape rather than once per frame —
  // the preview redraws up to 60 times a second while it spins.
  const coverCanvas = useMemo(
    () => (media?.artImg ? renderCoverCanvas(media.artImg, 512, shape) : null),
    [media, shape]);

  // ---- Preview ----
  // The same composite the encode produces, drawn small — and moving, so the
  // spin and drift speeds can be judged before spending a render on them.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !media?.artImg || !coverCanvas) return;
    const PW = 324, PH = 576;            // 1080x1920 / 3.33
    canvas.width = PW; canvas.height = PH;
    const ctx = canvas.getContext("2d");
    const img = media.artImg;
    const geo = coverGeometry(img, { artScale, artOffset, shape, spin }, PW, PH);

    const draw = (t) => {
      ctx.clearRect(0, 0, PW, PH);

      // Backdrop: a flat colour, or a blurred cover-fit copy that can drift.
      if (bgMode === "solid") {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, PW, PH);
      } else {
        ctx.save();
        ctx.filter = `blur(${bgBlurPreviewPx(PH, bgBlur)}px)`;
        const zoom = driftOn ? BG_DRIFT_ZOOM : 1.08;
        const cover = Math.max(PW / img.naturalWidth, PH / img.naturalHeight) * zoom;
        const cw = img.naturalWidth * cover, ch = img.naturalHeight * cover;
        let dx = 0, dy = 0;
        if (driftOn) {
          // The same circle the crop expression walks in the encode.
          const p = BG_DRIFT_PERIOD / clampMotionSpeed(bgSpeed);
          dx = Math.min((cw - PW) / 2, PW * BG_DRIFT_AMOUNT) * Math.sin(2 * Math.PI * t / p);
          dy = Math.min((ch - PH) / 2, PH * BG_DRIFT_AMOUNT) * Math.cos(2 * Math.PI * t / p);
        }
        ctx.drawImage(img, (PW - cw) / 2 + dx, (PH - ch) / 2 + dy, cw, ch);
        ctx.restore();
      }

      // Cover, turning about its own centre.
      ctx.save();
      ctx.translate(PW / 2, geo.centerY);
      if (spin) ctx.rotate((2 * Math.PI * t) / spinPeriod);
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 18;
      ctx.drawImage(coverCanvas, -geo.boxPx / 2, -geo.boxPx / 2, geo.boxPx, geo.boxPx);
      ctx.restore();

      drawCaption(ctx, { title: track?.title, artist: meta?.artist }, caption, PW, PH, geo.bottom);
    };

    // Only run a loop when something actually moves; a still frame is drawn once.
    const animated = spin || driftOn;
    if (!animated) { draw(0); return undefined; }
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      draw((performance.now() - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [media, coverCanvas, bgMode, bgColor, bgBlur, driftOn, bgSpeed, artScale,
      artOffset, shape, spin, spinPeriod, caption, track, meta]);

  // ---- Step 3: render ----
  const render = useCallback(async () => {
    if (!media || !track || rendering) return;
    if (!(duration > 0)) { setError("That track reports no duration, so there's nothing to render."); return; }

    setRendering(true); setError(""); setProgress(0); setLogLines([]); setOutput(null);
    cancelRef.current = false;
    const started = performance.now();

    let ff = null;
    try {
      ff = new FFmpeg();
      ffRef.current = ff;

      // ffmpeg reports position as `time=HH:MM:SS.xx`; against a known duration
      // that is a truer progress bar than the progress event, which overshoots
      // on filtergraphs like this one.
      ff.on("log", ({ message }) => {
        const m = /time=\s*(\d+):(\d+):(\d+\.?\d*)/.exec(message);
        if (m) {
          const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          setProgress(Math.min(0.99, t / duration));
        }
        if (/^\s*(Error|\[.*@.*\] Error|Conversion failed)/i.test(message)) log(message);
      });

      log("Loading FFmpeg.wasm core…");
      await ff.load(await loadFFmpegCore());
      if (cancelRef.current) throw new Error("__CANCELLED__");

      const img = media.artImg;
      const geo = coverGeometry(img, { artScale, artOffset, shape, spin }, OUT_W, OUT_H);
      const dur = duration;

      // The cover goes in as a pre-shaped PNG with alpha, so the filtergraph
      // only has to turn it and lay it down.
      const coverPx = evenDimension(geo.boxPx);
      await ff.writeFile("cover.png",
        await canvasToPngBytes(renderCoverCanvas(img, coverPx, shape)));

      // The backdrop is an image input either way — the blurred cover, or a
      // flat rectangle painted here. Keeping both paths on an image input
      // means no lavfi source has to exist in this wasm build.
      let bgName;
      if (bgMode === "blur") {
        bgName = `bgsrc.${(media.art.type || "").includes("png") ? "png" : "jpg"}`;
        await ff.writeFile(bgName, new Uint8Array(await media.art.arrayBuffer()));
      } else {
        const c = document.createElement("canvas");
        c.width = OUT_W; c.height = OUT_H;
        const cx = c.getContext("2d");
        cx.fillStyle = bgColor;
        cx.fillRect(0, 0, OUT_W, OUT_H);
        bgName = "bg.png";
        await ff.writeFile(bgName, await canvasToPngBytes(c));
      }

      let capName = null;
      if (caption.enabled) {
        const c = document.createElement("canvas");
        c.width = OUT_W; c.height = OUT_H;
        drawCaption(c.getContext("2d"), { title: track.title, artist: meta.artist },
          caption, OUT_W, OUT_H, geo.bottom);
        capName = "caption.png";
        await ff.writeFile(capName, await canvasToPngBytes(c));
      }

      await ff.writeFile("audio.mp3", new Uint8Array(await media.audio.arrayBuffer()));
      log(`Wrote cover ${coverPx}px, ${bgMode === "blur" ? "blurred backdrop" : "flat backdrop"}`
        + `${capName ? ", caption" : ""}, ${fmtBytes(media.audio.size)} audio.`);
      if (cancelRef.current) throw new Error("__CANCELLED__");

      // ---- Inputs ----
      // Indices are walked rather than computed, because which inputs exist
      // depends on the backdrop and whether there is a caption.
      const still = (name) =>
        ["-loop", "1", "-framerate", String(STILL_FPS), "-t", dur.toFixed(3), "-i", name];
      const inputArgs = [];
      let next = 0;
      inputArgs.push(...still("cover.png")); const coverIdx = next++;
      inputArgs.push(...still(bgName));      const bgIdx = next++;
      let capIdx = null;
      if (capName) { inputArgs.push(...still(capName)); capIdx = next++; }
      inputArgs.push("-i", "audio.mp3");     const audioIdx = next++;

      // ---- Filtergraph ----
      const fpsPrefix = outFps !== STILL_FPS ? `fps=${outFps},` : "";
      const frames = Math.max(2, Math.round(dur * outFps));

      let filter = "";
      filter += bgMode === "blur"
        ? blurBackdropChain(`[${bgIdx}:v]${fpsPrefix}`, OUT_W, OUT_H, bgBlur, outFps, {
            drift: bgMotion === "drift", driftSpeed: bgSpeed,
          }) + "[bg];"
        // Already the output size and a flat colour, so it only needs a rate.
        : `[${bgIdx}:v]${fpsPrefix}setsar=1[bg];`;

      let fg = `[${coverIdx}:v]${fpsPrefix}`;
      if (spin) {
        // rotate needs an alpha channel to leave the corners clear, and a
        // canvas big enough for what it sweeps: a circle stays inside its own
        // box at every angle, a square needs its diagonal.
        const grow = shape === "circle" ? "" : `:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`;
        fg += `format=rgba,rotate=a='2*PI*t/${spinPeriod.toFixed(3)}':c=none${grow},`;
      }
      filter += `${fg}setsar=1[fg];`;
      // Positioned by its centre, so a grown rotate canvas doesn't shift it.
      filter += `[bg][fg]overlay=(main_w-overlay_w)/2:`
        + `(main_h-overlay_h)/2${signed((artOffset / 100) * OUT_H)}:shortest=1[c];`;
      // Motion goes on the composed frame, before the caption, so a zoom never
      // drags the text around or softens it.
      filter += `[c]${motionZoompanFilter({ motion, frames, speed: motionSpeed, w: OUT_W, h: OUT_H, fps: outFps })}`
        + `format=yuv420p,setsar=1${capIdx == null ? "[v]" : "[m]"};`;
      if (capIdx != null) {
        filter += `[${capIdx}:v]${fpsPrefix}scale=w=${OUT_W}:h=${OUT_H},format=yuva420p,setsar=1[o];`;
        filter += `[m][o]overlay=0:0:shortest=1,format=yuv420p,setsar=1[v];`;
      }
      // A trim has to come off the source, not just off the output length:
      // -t alone would always start the audio at zero.
      const audioChain = trimmed
        ? `[${audioIdx}:a]atrim=start=${clipStart.toFixed(3)}:end=${clipEnd.toFixed(3)},`
          + `asetpts=PTS-STARTPTS[a];`
        : "";
      filter = (filter + audioChain).replace(/;$/, "");

      const outName = `${safeName(`${meta.artist}-${track.title}`, "bandcamp-poster")}-1080x1920.mp4`;
      const args = [
        "-y",
        ...inputArgs,
        "-filter_complex", filter,
        "-map", "[v]", "-map", trimmed ? "[a]" : `${audioIdx}:a`,
        // Same trade riptag makes: a still frame encodes best with
        // -tune stillimage, but that tuning's lookahead is wasted on motion.
        ...(anyMotion
          ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
          : ["-c:v", "libx264", "-tune", "stillimage", "-crf", "18"]),
        "-pix_fmt", "yuv420p",
        "-r", String(outFps),
        "-g", String(Math.max(1, Math.round(outFps * 2))),
        "-c:a", "aac", "-b:a", "256k",
        "-movflags", "+faststart",
        "-t", dur.toFixed(3),
        "out.mp4",
      ];

      log(`Rendering ${OUT_W}×${OUT_H}, ${fmtTime(dur)}`
        + `${trimmed ? ` (${formatClock(clipStart)}–${formatClock(clipEnd)} of the track)` : ""}`
        + `${anyMotion ? `, ${outFps}fps` : ", still"}`
        + `${spin ? `, spinning every ${spinPeriod.toFixed(1)}s` : ""}…`);
      const code = await ff.exec(args);
      if (cancelRef.current) throw new Error("__CANCELLED__");
      if (typeof code === "number" && code !== 0) {
        throw new Error(`FFmpeg exited with code ${code}. See the log above.`);
      }

      const data = await ff.readFile("out.mp4");
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      setOutput({ url: URL.createObjectURL(blob), size: blob.size, name: outName });
      setProgress(1);
      log(`Done in ${((performance.now() - started) / 1000).toFixed(1)}s — ${fmtBytes(blob.size)}.`);
    } catch (e) {
      if (e.message === "__CANCELLED__") log("Cancelled.");
      else { setError(e.message); log(`Failed: ${e.message}`); }
    } finally {
      try { ff?.terminate(); } catch { /* already gone */ }
      ffRef.current = null;
      setRendering(false);
    }
  }, [media, track, meta, duration, trimmed, clipStart, clipEnd, bgMode, bgColor,
      bgBlur, bgMotion, bgSpeed, motion, motionSpeed, artScale, artOffset, shape,
      spin, spinPeriod, caption, anyMotion, outFps, rendering, log]);

  const cancelRender = useCallback(() => {
    cancelRef.current = true;
    try { ffRef.current?.terminate(); } catch { /* already gone */ }
  }, []);

  const estimate = useMemo(() => {
    if (!duration) return "";
    // Rough, from riptag's observed throughput: a still 1080x1920 frame encodes
    // far faster than real time, a moving one roughly at it.
    const secs = anyMotion ? duration * 1.1 : duration * 0.18;
    return `~${secs < 60 ? `${Math.round(secs)}s` : `${Math.round(secs / 60)}m`}`;
  }, [duration, anyMotion]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Bandcamp Poster</h1>
        <p className={styles.subtitle}>
          A Bandcamp track URL in, a 1080&times;1920 video out — cover art over a blurred
          or flat backdrop, rendered in your browser with FFmpeg.wasm.
        </p>
      </header>

      {/* ---- 1. URL ---- */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>1. Bandcamp URL</h2>
        <div className={styles.urlRow}>
          <input
            className={styles.urlInput}
            type="url"
            value={url}
            placeholder="https://artist.bandcamp.com/track/…"
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") resolve(); }}
            disabled={resolving}
          />
          <button className={styles.primaryBtn} onClick={resolve} disabled={resolving || !url.trim()}>
            {resolving ? "Looking up…" : "Look up"}
          </button>
        </div>
        <p className={styles.hint}>
          Track or album pages on bandcamp.com. Audio comes from the page&apos;s public
          128&nbsp;kbps stream — the only encoding a Bandcamp page exposes.
        </p>
        {error && <div className={styles.error}>{error}</div>}
      </section>

      {/* ---- 2. Track + media ---- */}
      {meta && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>2. Track</h2>
          <div className={styles.metaRow}>
            <div className={styles.metaInfo}>
              <div className={styles.metaArtist}>{meta.artist || "Unknown artist"}</div>
              {meta.tracks.length > 1 ? (
                <select
                  className={styles.select}
                  value={trackIdx}
                  onChange={e => { setTrackIdx(Number(e.target.value)); setMedia(null); setOutput(null); }}
                >
                  {meta.tracks.map((t, i) => (
                    <option key={t.index} value={i}>
                      {t.num}. {t.title} ({fmtTime(t.duration)})
                    </option>
                  ))}
                </select>
              ) : (
                <div className={styles.metaTitle}>{track?.title}</div>
              )}
              <div className={styles.metaSub}>
                {fmtTime(track?.duration)}
                {meta.kind === "album" && meta.albumTitle ? ` · from ${meta.albumTitle}` : ""}
              </div>
            </div>
            <button className={styles.primaryBtn} onClick={fetchMedia} disabled={!!fetching}>
              {fetching || (media ? "Re-fetch" : "Fetch audio + art")}
            </button>
          </div>
          {media && (
            <div className={styles.ready}>
              Ready: {fmtBytes(media.audio.size)} audio, {fmtBytes(media.art.size)} art,{" "}
              {media.artImg.naturalWidth}&times;{media.artImg.naturalHeight}, {fmtTime(media.duration)}.
            </div>
          )}
          <h3 className={styles.subTitle}>Post text</h3>
          <div className={styles.postBox}>
            <textarea
              className={styles.postInput}
              rows={4}
              spellCheck={false}
              value={postText}
              onChange={e => setPostEdit(e.target.value)}
            />
            <div className={styles.postActions}>
              <button type="button" className={styles.primaryBtn} onClick={copyPost}>
                {copied ? "Copied" : "Copy"}
              </button>
              {postEdit != null && postEdit !== generatedPost && (
                <button type="button" className={styles.linkBtn}
                  onClick={() => setPostEdit(null)}>Reset</button>
              )}
            </div>
          </div>

          {media && clip && (
            <>
              <h3 className={styles.subTitle}>Trim</h3>
              <TrimPanel
                audioBlob={media.audio}
                fullDur={fullDur}
                clip={clip}
                onChange={setClip}
                disabled={rendering}
              />
            </>
          )}
        </section>
      )}

      {/* ---- 3. Frame + render ---- */}
      {media && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>3. Frame</h2>
          <div className={styles.frameLayout}>
            <div className={styles.previewPane}>
              <canvas ref={previewRef} className={styles.preview} />
              <div className={styles.previewLabel}>
                {OUT_W}&times;{OUT_H} · {anyMotion ? `${outFps}fps` : "still"} · {fmtTime(duration)}
              </div>
              {(spin || driftOn) && (
                <div className={styles.liveTag}>Preview is live — speeds shown as they&apos;ll render</div>
              )}
            </div>

            {/* The settings table, laid out like a riptag image row. */}
            <table className={styles.settingsTable}>
              <tbody>
                <tr>
                  <th>Background</th>
                  <td>
                    <select className={styles.select} value={bgMode}
                      onChange={e => setBgMode(e.target.value)}>
                      <option value="blur">Blurred cover art</option>
                      <option value="solid">Solid colour</option>
                    </select>
                    {bgMode === "solid" && (
                      <ColorField
                        label=""
                        value={bgColor}
                        onChange={setBgColor}
                        palette={palette}
                        artImg={media.artImg}
                        resetTo="#000000"
                        resetLabel="black"
                      />
                    )}
                  </td>
                </tr>
                {bgMode === "blur" && (
                  <>
                    <tr>
                      <th>Background blur</th>
                      <td>
                        <div className={styles.sliderRow}>
                          <input type="range" min={0} max={BG_BLUR_MAX} step={5}
                            value={bgBlur}
                            onChange={e => setBgBlur(clampBgBlur(e.target.value))} />
                          <span className={styles.sliderValue}>
                            {bgBlur === 0 ? "off" : `${bgBlur}%`}
                          </span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <th>Background motion</th>
                      <td>
                        <select className={styles.select} value={bgMotion}
                          onChange={e => setBgMotion(e.target.value)}>
                          {BG_MOTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        {bgMotion === "drift" && (
                          <div className={styles.sliderRow}>
                            <input type="range" min={MOTION_SPEED_MIN} max={MOTION_SPEED_MAX}
                              step={MOTION_SPEED_STEP} value={bgSpeed}
                              onChange={e => setBgSpeed(clampMotionSpeed(e.target.value))} />
                            <span className={styles.sliderValue}>
                              {bgSpeed}&times; · {(BG_DRIFT_PERIOD / bgSpeed).toFixed(0)}s cycle
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  </>
                )}
                <tr>
                  <th>Cover shape</th>
                  <td>
                    <select className={styles.select} value={shape}
                      onChange={e => setShape(e.target.value)}>
                      <option value="square">Square (as uploaded)</option>
                      <option value="circle">Circle</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <th>Cover spin</th>
                  <td>
                    <label className={styles.checkRow}>
                      <input type="checkbox" checked={spin}
                        onChange={e => toggleSpin(e.target.checked)} />
                      Rotate the cover
                    </label>
                    {spin && (
                      <>
                        <div className={styles.sliderRow}>
                          <input type="range" min={MOTION_SPEED_MIN} max={MOTION_SPEED_MAX}
                            step={MOTION_SPEED_STEP} value={spinSpeed}
                            onChange={e => setSpinSpeed(clampMotionSpeed(e.target.value))} />
                          <span className={styles.sliderValue}>
                            {spinSpeed}&times; · {spinPeriod.toFixed(1)}s a turn
                          </span>
                        </div>
                        {shape === "square" && (
                          <div className={styles.note}>
                            A square cover sweeps its corners as it turns — set the shape
                            to Circle for a record-style spin.
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>Cover motion</th>
                  <td>
                    <select className={styles.select} value={motion}
                      onChange={e => setMotion(e.target.value)}>
                      {IMAGE_MOTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    {motion !== "none" && (
                      <div className={styles.sliderRow}>
                        <input type="range" min={MOTION_SPEED_MIN} max={MOTION_SPEED_MAX}
                          step={MOTION_SPEED_STEP} value={motionSpeed}
                          onChange={e => setMotionSpeed(clampMotionSpeed(e.target.value))} />
                        <span className={styles.sliderValue}>{motionSpeed}&times;</span>
                      </div>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>Cover size</th>
                  <td>
                    <div className={styles.sliderRow}>
                      <input type="range" min={0.4} max={1} step={0.01} value={artScale}
                        onChange={e => setArtScale(Number(e.target.value))} />
                      <span className={styles.sliderValue}>{Math.round(artScale * 100)}%</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>Cover position</th>
                  <td>
                    <div className={styles.sliderRow}>
                      <input type="range" min={-25} max={25} step={1} value={artOffset}
                        onChange={e => setArtOffset(Number(e.target.value))} />
                      <span className={styles.sliderValue}>
                        {artOffset === 0 ? "centred" : `${artOffset > 0 ? "down" : "up"} ${Math.abs(artOffset)}%`}
                      </span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>Caption</th>
                  <td>
                    <label className={styles.checkRow}>
                      <input type="checkbox" checked={caption.enabled}
                        onChange={e => setCaption(c => ({ ...c, enabled: e.target.checked }))} />
                      Show track title and artist
                    </label>
                    {caption.enabled && (
                      <>
                        <select
                          className={styles.select}
                          value={caption.fontFamily}
                          style={{ fontFamily: caption.fontFamily }}
                          onChange={e => setCaption(c => ({ ...c, fontFamily: e.target.value }))}
                        >
                          {CAPTION_FONTS.map(g => (
                            <optgroup key={g.group} label={g.group}>
                              {g.fonts.map(f => (
                                <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
                                  {f.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <select className={styles.select} value={caption.position}
                          onChange={e => setCaption(c => ({ ...c, position: e.target.value }))}>
                          {CAPTION_POSITIONS.map(p => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        <ColorField
                          label="text"
                          value={caption.color}
                          onChange={hex => setCaption(c => ({ ...c, color: hex }))}
                          palette={palette}
                          artImg={media.artImg}
                          resetTo="#ffffff"
                          resetLabel="white"
                        />
                        <div className={styles.sliderRow}>
                          <input type="range" min={2.5} max={7} step={0.1} value={caption.titleSize}
                            onChange={e => setCaption(c => ({ ...c, titleSize: Number(e.target.value) }))} />
                          <span className={styles.sliderValue}>title {caption.titleSize.toFixed(1)}%</span>
                        </div>
                        <label className={styles.checkRow}>
                          <input type="checkbox" checked={caption.uppercase}
                            onChange={e => setCaption(c => ({ ...c, uppercase: e.target.checked }))} />
                          Uppercase title
                        </label>
                        <label className={styles.checkRow}>
                          <input type="checkbox" checked={caption.shadow}
                            onChange={e => setCaption(c => ({ ...c, shadow: e.target.checked }))} />
                          Drop shadow
                        </label>
                      </>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.renderRow}>
            {!rendering ? (
              <button className={styles.renderBtn} onClick={render}>
                Render 1080&times;1920 video {estimate && <span className={styles.est}>{estimate}</span>}
              </button>
            ) : (
              <>
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar} style={{ width: `${Math.round(progress * 100)}%` }} />
                  <span className={styles.progressText}>{Math.round(progress * 100)}%</span>
                </div>
                <button className={styles.cancelBtn} onClick={cancelRender}>Cancel</button>
              </>
            )}
          </div>

          {logLines.length > 0 && (
            <pre className={styles.log}>{logLines.join("\n")}</pre>
          )}
        </section>
      )}

      {/* ---- 4. Result ---- */}
      {output && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>4. Result</h2>
          <div className={styles.resultRow}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video className={styles.resultVideo} src={output.url} controls playsInline />
            <div className={styles.resultInfo}>
              <div className={styles.resultName}>{output.name}</div>
              <div className={styles.metaSub}>{fmtBytes(output.size)} · {OUT_W}&times;{OUT_H}</div>
              <a className={styles.primaryBtn} href={output.url} download={output.name}>
                Download .mp4
              </a>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
