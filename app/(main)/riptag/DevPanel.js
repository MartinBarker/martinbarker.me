"use client";
// Local-only instrumentation for RipTag's resource ceilings.
//
// Renders nothing unless NODE_ENV is "development", so `npm run start-dev`
// gets it and `next build` does not. Everything here is diagnostic: no app
// state is read or written, and removing the file would not change behaviour.
//
// The question it exists to answer is "how close are we to the point where
// things start failing", which for this route means four separate ceilings:
//
//   1. wasm heap        — per ffmpeg instance, ~2 GB, and there is one per tab
//   2. origin storage   — IndexedDB, shared by every tab on this origin
//   3. localStorage     — ~5 MB, shared by every tab on this origin
//   4. device memory    — the sum of every tab's renderer process
//
// Only 2 and 3 are directly measurable. What the wasm heap is actually doing
// is not observable from outside the worker, so that row shows our own
// prediction and says so rather than inventing a number.

import { useEffect, useMemo, useRef, useState } from "react";
import * as renderQueue from "./renderQueue";
import * as devLog from "./devLog";

const IS_DEV = process.env.NODE_ENV !== "production";

// Chromium's per-origin localStorage budget. Counted in UTF-16 code units,
// which is why the measurement below multiplies lengths by two.
const LOCALSTORAGE_LIMIT_BYTES = 5 * 1024 * 1024;
const STATS_CHANNEL = "riptag-dev-stats";
const PUBLISH_MS = 2000;
// A peer that has not reported in three intervals has navigated away or been
// discarded. Tabs also send an explicit "bye", but a crashed one cannot.
const PEER_TTL_MS = PUBLISH_MS * 3;
const STORAGE_POLL_MS = 6000;

const mb = (bytes) => (bytes == null ? null : bytes / 1048576);
const fmtMB = (v) => (v == null ? "—" : v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${Math.round(v)} MB`);
const fmtBytes = (b) => (b == null ? "—" : fmtMB(mb(b)));
const pct = (used, total) => (total > 0 ? Math.min(100, (used / total) * 100) : 0);

const measureLocalStorage = () => {
  try {
    let bytes = 0, keys = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      bytes += (k.length + (localStorage.getItem(k) ?? "").length) * 2;
      keys++;
    }
    return { bytes, keys };
  } catch {
    // Private windows and blocked-site-data settings throw on access.
    return null;
  }
};

// Chrome/Edge only, and it deliberately excludes WebAssembly memory — the
// ffmpeg heap lives outside the JS heap, so this number staying flat during a
// render is expected, not reassuring.
const measureJsHeap = () => {
  const m = typeof performance !== "undefined" && performance.memory;
  if (!m?.usedJSHeapSize) return null;
  return { used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit };
};

function Bar({ value, limit, tone }) {
  const p = pct(value, limit);
  const color = tone === "danger" ? "#fc8181" : tone === "warn" ? "#f6ad55" : "#68d391";
  return (
    <div style={{ height: 5, borderRadius: 3, background: "#2d3748", overflow: "hidden", marginTop: 3 }}>
      <div style={{ height: "100%", width: `${p}%`, background: color, transition: "width .3s" }} />
    </div>
  );
}

function Row({ label, value, note, bar }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ opacity: 0.75 }}>{label}</span>
        <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{value}</span>
      </div>
      {bar}
      {note && <div style={{ opacity: 0.5, fontSize: "0.66rem", marginTop: 2, lineHeight: 1.35 }}>{note}</div>}
    </div>
  );
}

const LEVEL_COLOR = { info: "#a0aec0", ok: "#68d391", warn: "#f6ad55", error: "#fc8181" };
const clockOf = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });
// Enough to identify a value at a glance without wrapping the panel.
const brief = (data) => {
  if (data == null) return "";
  try {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    return text.length > 220 ? `${text.slice(0, 220)}…` : text;
  } catch { return String(data); }
};

export default function RipTagDevPanel({ predictedPeakMB = null, wasmLimitMB = 2048, renderInputs = null }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(null);
  const [storage, setStorage] = useState(null);
  const [persisted, setPersisted] = useState(null);
  const [peers, setPeers] = useState({});
  const [jobs, setJobs] = useState([]);
  const [hiddenSince, setHiddenSince] = useState(null);
  const [hiddenTotalMs, setHiddenTotalMs] = useState(0);
  const [events, setEvents] = useState([]);
  const lastJobStateRef = useRef(new Map());

  // Short, stable, human-readable — enough to tell three tabs apart in a list.
  const tabId = useMemo(() => Math.random().toString(36).slice(2, 7).toUpperCase(), []);
  const snapshotRef = useRef(null);
  const channelRef = useRef(null);

  // Live view of this tab's queue, so "is this tab rendering" is a fact rather
  // than an inference from the memory graph.
  useEffect(() => {
    if (!IS_DEV) return;
    return renderQueue.subscribe(setJobs);
  }, []);

  useEffect(() => {
    if (!IS_DEV) return;
    return devLog.subscribe(setEvents);
  }, []);

  // Turn queue snapshots into lifecycle lines. Derived here rather than emitted
  // by renderQueue so the queue stays free of dev-only concerns — and so a job
  // created by any path (concat, batch) shows up without extra wiring.
  useEffect(() => {
    if (!IS_DEV) return;
    const seen = lastJobStateRef.current;
    for (const j of jobs) {
      const prev = seen.get(j.jobId);
      if (prev === undefined) {
        devLog.push("info", `job created — ${j.label || j.jobId}`, { status: j.status, batch: !!j.batch });
      } else if (prev !== j.status) {
        const level = j.status === "done" ? "ok"
          : j.status === "error" ? "error"
          : j.status === "cancelled" ? "warn" : "info";
        devLog.push(level, `job ${j.status} — ${j.label || j.jobId}`,
          j.status === "error" ? (j.error?.message || j.error) : undefined);
      }
      seen.set(j.jobId, j.status);
    }
    for (const id of [...seen.keys()]) {
      if (!jobs.some(j => j.jobId === id)) { seen.delete(id); devLog.push("info", `job cleared — ${id}`); }
    }
  }, [jobs]);

  const running = jobs.filter(j => j.status === "running");
  const queued = jobs.filter(j => j.status === "queued");

  // Answers "does backgrounding the tab stop the render" by measuring it: the
  // counter keeps climbing while hidden if the worker is still being scheduled.
  useEffect(() => {
    if (!IS_DEV || typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState === "hidden") setHiddenSince(Date.now());
      else setHiddenSince(prev => {
        if (prev) setHiddenTotalMs(t => t + (Date.now() - prev));
        return null;
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Local sampling + cross-tab publish. Runs whether or not the panel is open,
  // otherwise a collapsed tab would be invisible to its peers.
  useEffect(() => {
    if (!IS_DEV) return;
    const tick = () => {
      const stats = {
        type: "stats",
        tabId,
        ts: Date.now(),
        jsHeap: measureJsHeap(),
        localStorage: measureLocalStorage(),
        running: renderQueue.snapshot().filter(j => j.status === "running").length,
        queued: renderQueue.snapshot().filter(j => j.status === "queued").length,
        predictedPeakMB: snapshotRef.current?.predictedPeakMB ?? null,
        visible: typeof document !== "undefined" && document.visibilityState === "visible",
      };
      snapshotRef.current = { ...snapshotRef.current, ...stats };
      setLocal(stats);
      try { channelRef.current?.postMessage(stats); } catch {}
      // Drop peers that stopped reporting — a closed tab, or one the browser
      // discarded under memory pressure (which is itself worth seeing).
      setPeers(prev => {
        const now = Date.now();
        const next = {};
        let changed = false;
        for (const [id, p] of Object.entries(prev)) {
          if (now - p.ts < PEER_TTL_MS) next[id] = p; else changed = true;
        }
        return changed ? next : prev;
      });
    };
    tick();
    const t = setInterval(tick, PUBLISH_MS);
    return () => clearInterval(t);
  }, [tabId]);

  // Keep the published prediction current without restarting the interval.
  useEffect(() => {
    snapshotRef.current = { ...snapshotRef.current, predictedPeakMB };
  }, [predictedPeakMB]);

  useEffect(() => {
    if (!IS_DEV || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(STATS_CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.tabId === tabId) return;
      // A tab that just opened asks everyone to report immediately, so its
      // list is populated without waiting out a whole interval.
      if (msg.type === "hello") { try { ch.postMessage(snapshotRef.current); } catch {} return; }
      if (msg.type === "bye") { setPeers(p => { const n = { ...p }; delete n[msg.tabId]; return n; }); return; }
      if (msg.type === "stats") setPeers(p => ({ ...p, [msg.tabId]: msg }));
    };
    try { ch.postMessage({ type: "hello", tabId }); } catch {}
    const onUnload = () => { try { ch.postMessage({ type: "bye", tabId }); } catch {} };
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      onUnload();
      try { ch.close(); } catch {}
      channelRef.current = null;
    };
  }, [tabId]);

  // Origin-wide, so it reads the same in every tab. Polled slowly — it is an
  // async disk query, not a cheap counter.
  useEffect(() => {
    if (!IS_DEV) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        if (!cancelled && est) setStorage(est);
      } catch {}
      try {
        const p = await navigator.storage?.persisted?.();
        if (!cancelled) setPersisted(p ?? null);
      } catch {}
    };
    poll();
    const t = setInterval(poll, STORAGE_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!IS_DEV) return null;

  const peerList = Object.values(peers).sort((a, b) => a.tabId.localeCompare(b.tabId));
  const allTabs = [{ ...local, tabId, self: true }, ...peerList].filter(t => t?.tabId);
  const renderingTabs = allTabs.filter(t => t.running > 0);
  // Each rendering tab holds its own ffmpeg instance in its own renderer
  // process, so the ceilings add up rather than being shared.
  const combinedPeakMB = renderingTabs.reduce((s, t) => s + (t.predictedPeakMB || 0), 0);
  const deviceMemGB = typeof navigator !== "undefined" ? navigator.deviceMemory : null;
  const deviceMemMB = deviceMemGB ? deviceMemGB * 1024 : null;

  const ls = local?.localStorage;
  const lsTone = !ls ? "ok" : ls.bytes > LOCALSTORAGE_LIMIT_BYTES * 0.9 ? "danger"
    : ls.bytes > LOCALSTORAGE_LIMIT_BYTES * 0.7 ? "warn" : "ok";
  const storageTone = !storage?.quota ? "ok"
    : storage.usage / storage.quota > 0.9 ? "danger"
    : storage.usage / storage.quota > 0.75 ? "warn" : "ok";
  const peakTone = predictedPeakMB == null ? "ok"
    : predictedPeakMB > wasmLimitMB ? "danger"
    : predictedPeakMB > wasmLimitMB * 0.75 ? "warn" : "ok";
  const combinedTone = !deviceMemMB || !combinedPeakMB ? "ok"
    : combinedPeakMB > deviceMemMB * 0.6 ? "danger"
    : combinedPeakMB > deviceMemMB * 0.4 ? "warn" : "ok";

  const chip = {
    position: "fixed", right: 12, bottom: 12, zIndex: 9999,
    font: "700 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    letterSpacing: "0.06em", padding: "5px 9px", borderRadius: 5,
    background: "#1a202c", color: "#f6ad55", border: "1px solid #f6ad55",
    cursor: "pointer",
  };

  if (!open) {
    return (
      <button type="button" style={chip} onClick={() => setOpen(true)}
        title="Local-only resource meters — not shown in production">
        &lt;DEV&gt;{renderingTabs.length > 0 ? ` · ${renderingTabs.length} rendering` : ""}
      </button>
    );
  }

  return (
    <div style={{
      position: "fixed", right: 12, bottom: 12, zIndex: 9999, width: 340,
      maxHeight: "80vh", overflowY: "auto",
      font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      background: "#1a202c", color: "#e2e8f0",
      border: "1px solid #f6ad55", borderRadius: 6, padding: "10px 12px",
      boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ color: "#f6ad55", fontWeight: 700, letterSpacing: "0.06em" }}>
          &lt;DEV&gt; RESOURCE METERS
        </span>
        <button type="button" onClick={() => setOpen(false)}
          style={{ background: "none", border: "none", color: "#e2e8f0", cursor: "pointer", fontSize: 14 }}
          aria-label="Hide dev panel">×</button>
      </div>

      <div style={{ opacity: 0.55, fontSize: "0.66rem", marginBottom: 10, lineHeight: 1.4 }}>
        Local only — this never renders in a production build. Tab {tabId}.
      </div>

      {/* ---- 1. wasm heap (per tab) ---- */}
      <div style={{ borderTop: "1px solid #2d3748", paddingTop: 8, marginBottom: 4 }}>
        <div style={{ color: "#f6ad55", marginBottom: 6 }}>THIS TAB — RENDER</div>
      </div>
      <Row
        label="ffmpeg jobs"
        value={running.length || queued.length ? `${running.length} running · ${queued.length} queued` : "idle"}
        note={running[0]?.label ? `running: ${running[0].label}` : null}
      />
      <Row
        label="predicted peak wasm"
        value={`${fmtMB(predictedPeakMB)} / ${fmtMB(wasmLimitMB)}`}
        bar={<Bar value={predictedPeakMB || 0} limit={wasmLimitMB} tone={peakTone} />}
        note="Our own estimate from the Step 5 memory panel. The real wasm heap is not readable from outside the ffmpeg worker, and performance.memory does not include it."
      />
      <Row
        label="js heap"
        value={local?.jsHeap ? `${fmtBytes(local.jsHeap.used)} / ${fmtBytes(local.jsHeap.limit)}` : "unavailable"}
        bar={local?.jsHeap ? <Bar value={local.jsHeap.used} limit={local.jsHeap.limit} tone="ok" /> : null}
        note={local?.jsHeap ? "Excludes wasm — flat during a render is expected." : "performance.memory is Chrome/Edge only."}
      />
      {renderInputs && (
        <Row
          label="render inputs"
          value={`${renderInputs.orderedAudios}a / ${renderInputs.selectedImages}i`}
          note={`exported tracks ${renderInputs.exportedTracks} · ticked audio ${renderInputs.selectedAudios} · usable audio ${renderInputs.orderedAudios} · images ${renderInputs.videoImages} (${renderInputs.selectedImages} selected). `
            + (renderInputs.orderedAudios === 0 || renderInputs.selectedImages === 0
              ? "Render Concat is disabled — the spec builder would refuse this."
              : "Render Concat should build a spec from these.")}
        />
      )}
      <Row
        label="tab visibility"
        value={local?.visible === false ? "hidden" : "visible"}
        note={hiddenTotalMs > 0 || hiddenSince
          ? `backgrounded for ${Math.round((hiddenTotalMs + (hiddenSince ? Date.now() - hiddenSince : 0)) / 1000)}s total this session`
          : "never backgrounded this session"}
      />

      {/* ---- 2. every riptag tab ---- */}
      <div style={{ borderTop: "1px solid #2d3748", paddingTop: 8, margin: "10px 0 6px" }}>
        <div style={{ color: "#f6ad55", marginBottom: 6 }}>ALL RIPTAG TABS ({allTabs.length})</div>
      </div>
      {typeof BroadcastChannel === "undefined" ? (
        <div style={{ opacity: 0.5, fontSize: "0.7rem" }}>BroadcastChannel unavailable — cross-tab view off.</div>
      ) : (
        <>
          {allTabs.map(t => (
            <div key={t.tabId} style={{
              display: "flex", justifyContent: "space-between", gap: 8,
              padding: "3px 0", opacity: t.self ? 1 : 0.85,
            }}>
              <span>
                <span style={{ color: t.running > 0 ? "#f6ad55" : "#718096" }}>{t.running > 0 ? "●" : "○"}</span>
                {" "}{t.tabId}{t.self ? " (this)" : ""}
              </span>
              <span style={{ whiteSpace: "nowrap" }}>
                {t.running > 0 ? `${fmtMB(t.predictedPeakMB)} peak` : "idle"}
                {t.visible === false ? " · bg" : ""}
              </span>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <Row
              label="combined predicted wasm"
              value={deviceMemMB ? `${fmtMB(combinedPeakMB)} / ${fmtMB(deviceMemMB)} RAM` : fmtMB(combinedPeakMB)}
              bar={deviceMemMB ? <Bar value={combinedPeakMB} limit={deviceMemMB} tone={combinedTone} /> : null}
              note="Each rendering tab runs its own ffmpeg instance in its own renderer process, so these add up — they are not shared. This is the number that decides whether a third render tab survives."
            />
          </div>
        </>
      )}

      {/* ---- 3. shared storage ---- */}
      <div style={{ borderTop: "1px solid #2d3748", paddingTop: 8, margin: "10px 0 6px" }}>
        <div style={{ color: "#f6ad55", marginBottom: 6 }}>ORIGIN STORAGE (SHARED BY ALL TABS)</div>
      </div>
      <Row
        label="indexeddb + caches"
        value={storage?.quota ? `${fmtBytes(storage.usage)} / ${fmtBytes(storage.quota)}` : "unavailable"}
        bar={storage?.quota ? <Bar value={storage.usage} limit={storage.quota} tone={storageTone} /> : null}
        note={`Projects, audio, images and rendered video. persisted: ${persisted === null ? "unknown" : String(persisted)}${persisted === false ? " — evictable under disk pressure" : ""}`}
      />
      <Row
        label="localstorage"
        value={ls ? `${(ls.bytes / 1024).toFixed(0)} KB / ${(LOCALSTORAGE_LIMIT_BYTES / 1024 / 1024).toFixed(0)} MB` : "unavailable"}
        bar={ls ? <Bar value={ls.bytes} limit={LOCALSTORAGE_LIMIT_BYTES} tone={lsTone} /> : null}
        note={ls ? `${ls.keys} keys. Separate from the quota above and much smaller — this holds only pointers and settings, never blobs.` : "Blocked or unavailable in this context."}
      />

      {/* ---- 3b. render lifecycle ---- */}
      <div style={{ borderTop: "1px solid #2d3748", paddingTop: 8, margin: "10px 0 6px",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#f6ad55" }}>RENDER EVENTS ({events.length})</span>
        <button type="button" onClick={() => devLog.clear()}
          style={{ background: "none", border: "none", color: "#718096", cursor: "pointer", fontSize: "0.68rem" }}>
          clear
        </button>
      </div>
      <div style={{
        maxHeight: 180, overflowY: "auto", background: "#12151c",
        border: "1px solid #2d3748", borderRadius: 4, padding: "6px 8px", fontSize: "0.68rem",
      }}>
        {events.length === 0 ? (
          <div style={{ opacity: 0.45 }}>Nothing yet — press Render Concat.</div>
        ) : (
          [...events].reverse().map(e => (
            <div key={e.id} style={{ marginBottom: 4, lineHeight: 1.4 }}>
              <span style={{ opacity: 0.4 }}>{clockOf(e.at)} </span>
              <span style={{ color: LEVEL_COLOR[e.level] || "#e2e8f0" }}>{e.message}</span>
              {e.data !== undefined && (
                <div style={{ opacity: 0.5, paddingLeft: 8, wordBreak: "break-all" }}>{brief(e.data)}</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ---- 4. environment ---- */}
      <div style={{ borderTop: "1px solid #2d3748", paddingTop: 8, margin: "10px 0 6px" }}>
        <div style={{ color: "#f6ad55", marginBottom: 6 }}>ENVIRONMENT</div>
      </div>
      <div style={{ opacity: 0.75, fontSize: "0.7rem", lineHeight: 1.6 }}>
        <div>device memory: {deviceMemGB ? `~${deviceMemGB} GB (browser-reported, capped at 8)` : "unreported"}</div>
        <div>cores: {typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? "?" : "?"}</div>
        <div>
          crossOriginIsolated: {typeof crossOriginIsolated !== "undefined" ? String(crossOriginIsolated) : "?"}
          {typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated
            && " — why multithreaded ffmpeg and measureUserAgentSpecificMemory() are both unavailable"}
        </div>
      </div>
    </div>
  );
}
