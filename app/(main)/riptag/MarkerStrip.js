"use client";
// A thin full-length timeline under RipTag's waveform showing every track
// marker at once, whatever the zoomview is looking at. Markers can be picked
// one at a time (Shift/Ctrl/Cmd+click to add) or by dragging a box across the
// strip, and dragging any selected marker moves the whole selection by the
// same amount — e.g. select everything and slide every cut a little later.

import { useRef, useState } from "react";
import styles from "./riptag.module.css";

const JOINT_EPS = 0.02;   // same tolerance the zoomview handles use for a shared cut
const MIN_TRACK = 0.05;   // shortest a track may be squeezed to, as in beginBoundaryDrag

// Every marker as data. Keys match the zoomview's boundary handles so a
// selection made here can be highlighted there too.
export function buildMarkers(tracks) {
  const markers = [];
  if (tracks.length === 0) return markers;
  const first = tracks[0];
  markers.push({ key: `first-start-${first.id}`, kind: "first", time: first.startTime, refs: [{ i: 0, field: "startTime" }] });
  for (let i = 0; i < tracks.length - 1; i++) {
    const a = tracks[i];
    const b = tracks[i + 1];
    if (Math.abs(a.endTime - b.startTime) < JOINT_EPS) {
      markers.push({ key: `joint-${a.id}-${b.id}`, kind: "joint", time: a.endTime, refs: [{ i, field: "endTime" }, { i: i + 1, field: "startTime" }] });
    } else {
      markers.push({ key: `solo-end-${a.id}`, kind: "end", time: a.endTime, refs: [{ i, field: "endTime" }] });
      markers.push({ key: `solo-start-${b.id}`, kind: "start", time: b.startTime, refs: [{ i: i + 1, field: "startTime" }] });
    }
  }
  const last = tracks[tracks.length - 1];
  markers.push({ key: `last-end-${last.id}`, kind: "last", time: last.endTime, refs: [{ i: tracks.length - 1, field: "endTime" }] });
  return markers;
}

// Shift the given markers by dt seconds, clamped so no track flips or shrinks
// below MIN_TRACK, no gap goes negative, and nothing leaves [0, duration].
// Markers that aren't selected stay put and act as walls.
export function moveMarkers(tracks, markers, keys, dt, duration) {
  const moved = new Set();
  for (const m of markers) if (keys.has(m.key)) for (const r of m.refs) moved.add(`${r.i}:${r.field}`);
  if (moved.size === 0) return tracks;
  let lo = -Infinity;
  let hi = Infinity;
  const n = tracks.length;
  for (let i = 0; i < n; i++) {
    const t = tracks[i];
    const sM = moved.has(`${i}:startTime`);
    const eM = moved.has(`${i}:endTime`);
    if (sM && !eM) hi = Math.min(hi, t.endTime - MIN_TRACK - t.startTime);
    if (eM && !sM) lo = Math.max(lo, t.startTime + MIN_TRACK - t.endTime);
    if (i === 0 && sM) lo = Math.max(lo, -t.startTime);
    if (i === n - 1 && eM) hi = Math.min(hi, duration - t.endTime);
    if (i < n - 1) {
      const next = tracks[i + 1];
      const nsM = moved.has(`${i + 1}:startTime`);
      if (eM && !nsM) hi = Math.min(hi, next.startTime - t.endTime);
      if (nsM && !eM) lo = Math.max(lo, t.endTime - next.startTime);
    }
  }
  // Markers that already break a rule must still be allowed to stay where they are.
  lo = Math.min(lo, 0);
  hi = Math.max(hi, 0);
  const d = Math.max(lo, Math.min(hi, dt));
  if (d === 0) return tracks;
  return tracks.map((t, i) => {
    const sM = moved.has(`${i}:startTime`);
    const eM = moved.has(`${i}:endTime`);
    if (!sM && !eM) return t;
    return { ...t, startTime: sM ? t.startTime + d : t.startTime, endTime: eM ? t.endTime + d : t.endTime };
  });
}

export default function MarkerStrip({ tracks, duration, viewRange, currentTime, colors, selection, onSelectionChange, onLiveMove, onCommit, onSeek }) {
  const stripRef = useRef(null);
  const [preview, setPreview] = useState(null); // tracks mid-drag, before commit
  const [band, setBand] = useState(null);       // { x0, x1 } in px while box-selecting

  if (!(duration > 0) || tracks.length === 0) return null;
  const shown = preview || tracks;
  const markers = buildMarkers(shown);
  const pct = (t) => `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;
  const liveSelected = markers.filter(m => selection.has(m.key)).length;

  const onPointerDown = (e) => {
    if (e.button != null && e.button > 0) return;
    const el = stripRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const width = rect.width || 1;
    const startX = e.clientX;
    const pointerId = e.pointerId;
    try { el.setPointerCapture?.(pointerId); } catch { /* not captureable */ }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const markerKey = e.target.closest?.("[data-marker]")?.dataset.marker;
    const startTracks = tracks;
    const startMarkers = buildMarkers(startTracks);
    let moved = false;
    let onMove;
    let onEnd;

    if (markerKey) {
      const wasSelected = selection.has(markerKey);
      let keys;
      if (additive) {
        keys = new Set(selection);
        if (wasSelected) keys.delete(markerKey); else keys.add(markerKey);
      } else {
        keys = wasSelected ? new Set(selection) : new Set([markerKey]);
      }
      onSelectionChange(keys);
      const dragKeys = keys.has(markerKey) ? keys : null;
      let latest = startTracks;
      onMove = (ev) => {
        if (!dragKeys) return;
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        latest = moveMarkers(startTracks, startMarkers, dragKeys, (dx / width) * duration, duration);
        setPreview(latest);
        onLiveMove(latest);
      };
      onEnd = () => {
        if (moved) {
          if (latest !== startTracks) onCommit(latest);
        } else if (!additive && wasSelected && selection.size > 1) {
          // A plain click on one marker of a group narrows the selection to it.
          onSelectionChange(new Set([markerKey]));
        }
        setPreview(null);
      };
    } else {
      const x0 = startX - rect.left;
      const base = additive ? selection : new Set();
      onMove = (ev) => {
        const x1 = ev.clientX - rect.left;
        if (!moved && Math.abs(x1 - x0) < 3) return;
        moved = true;
        setBand({ x0, x1 });
        const t0 = (Math.min(x0, x1) / width) * duration;
        const t1 = (Math.max(x0, x1) / width) * duration;
        const keys = new Set(base);
        for (const m of startMarkers) if (m.time >= t0 && m.time <= t1) keys.add(m.key);
        onSelectionChange(keys);
      };
      onEnd = () => {
        if (!moved) {
          if (!additive) onSelectionChange(new Set());
          onSeek(Math.max(0, Math.min(duration, (x0 / width) * duration)));
        }
        setBand(null);
      };
    }

    const handleMove = (ev) => { if (ev.pointerId === pointerId) onMove(ev); };
    const handleUp = (ev) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      try { el.releasePointerCapture?.(pointerId); } catch { /* already released */ }
      onEnd();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape" && selection.size) { e.stopPropagation(); onSelectionChange(new Set()); }
  };

  return (
    <div className={styles.markerStripWrap}>
      <div
        ref={stripRef}
        className={styles.markerStrip}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="group"
        aria-label="All track markers"
      >
        {shown.map((t, i) => (
          <div
            key={t.id}
            className={styles.markerStripTrack}
            style={{ left: pct(t.startTime), width: `${Math.max(0, ((t.endTime - t.startTime) / duration) * 100)}%`, background: colors[i % colors.length] }}
          >
            <span>{i + 1}</span>
          </div>
        ))}
        {viewRange.end > viewRange.start && (viewRange.end - viewRange.start) < duration - 0.5 && (
          <div className={styles.markerStripView} style={{ left: pct(viewRange.start), width: pct(viewRange.end - viewRange.start) }} />
        )}
        <div className={styles.markerStripPlayhead} style={{ left: pct(currentTime) }} />
        {markers.map(m => (
          <div
            key={m.key}
            data-marker={m.key}
            className={[
              styles.markerStripMarker,
              m.kind === "first" ? styles.markerStripFirst : "",
              m.kind === "end" || m.kind === "start" || m.kind === "last" ? styles.markerStripSolo : "",
              selection.has(m.key) ? styles.markerStripSelected : "",
            ].join(" ")}
            style={{ left: pct(m.time) }}
            title={m.kind === "first" ? "First track start" : m.kind === "last" ? "Last track end" : undefined}
          />
        ))}
        {band && (
          <div className={styles.markerStripBand} style={{ left: Math.min(band.x0, band.x1), width: Math.abs(band.x1 - band.x0) }} />
        )}
      </div>
      <div className={styles.markerStripBar}>
        <span>
          {liveSelected > 0
            ? <><strong>{liveSelected}</strong> marker{liveSelected === 1 ? "" : "s"} selected — drag one to move them all</>
            : <>All markers · drag across to select several · Shift/Ctrl+click to add · click empty space to seek</>}
        </span>
        <span className={styles.markerStripActions}>
          {/* A marker sitting right on 0 or the file's end can't move outward, and
              selected it would pin the whole group, so "all" leaves it out. */}
          <button
            type="button"
            className={styles.linkBtn}
            title="Select every marker (except one pinned to the very start or end of the file)"
            onClick={() => onSelectionChange(new Set(buildMarkers(tracks)
              .filter(m => !(m.kind === "first" && m.time <= 0.01) && !(m.kind === "last" && m.time >= duration - 0.01))
              .map(m => m.key)))}
          >Select all</button>
          {liveSelected > 0 && (
            <button type="button" className={styles.linkBtn} onClick={() => onSelectionChange(new Set())}>Clear</button>
          )}
        </span>
      </div>
    </div>
  );
}
