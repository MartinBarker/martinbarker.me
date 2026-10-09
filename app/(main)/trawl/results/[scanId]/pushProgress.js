'use client';
import React from 'react';
import { Banner, pagerStyle } from './ui';

/* ------------------------------------------------------------------ */
/* Per-playlist tally, saved in this browser                           */
/* ------------------------------------------------------------------ */

// One entry per (scan, playlist): the last known outcome of every video this
// browser tried to add. Survives reloads, so a multi-day 5,000-video push keeps
// an accurate "added / not added" count even when the server only remembers the
// playlist the scan last used.
export const tallyKey = (scanId, playlistId) => `trawl:push:${scanId}:${playlistId}`;

export function readTally(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.statuses === 'object') return parsed;
  } catch {}
  return { statuses: {}, updatedAt: null };
}

// Merge new outcomes into the stored tally. Only final outcomes are kept;
// "adding…" is transient and would be wrong after a reload.
export function writeTally(key, statuses) {
  const prev = readTally(key);
  const next = { ...prev.statuses };
  for (const [mediaId, s] of Object.entries(statuses)) {
    if (s && (s.status === 'inserted' || s.status === 'skipped' || s.status === 'failed')) {
      next[mediaId] = { status: s.status, error: s.error || null, reason: s.reason || null };
    }
  }
  const value = { statuses: next, updatedAt: Date.now() };
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  return value;
}

export function clearTally(key) {
  try { localStorage.removeItem(key); } catch {}
}

const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded']);
export const isQuotaFailure = s =>
  !!s && s.status === 'failed' && (QUOTA_REASONS.has(s.reason) || /quota/i.test(s.error || ''));

export function RunningTally({ t, tracks, statusFor, updatedAt, onReset }) {
  let added = 0, already = 0, quota = 0, other = 0, untried = 0;
  for (const tr of tracks) {
    const s = statusFor(tr.media_id);
    if (s?.status === 'inserted') added++;
    else if (s?.status === 'skipped') already++;
    else if (isQuotaFailure(s)) quota++;
    else if (s?.status === 'failed') other++;
    else untried++;
  }
  const notAdded = quota + other + untried;
  const cell = (label, value, color, note) => (
    <div style={{ flex: '1 1 120px', padding: '8px 10px', border: `1px solid ${t.border}`, borderRadius: 8, background: t.input }}>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 12, color: t.sub }}>{label}</div>
      {note && <div style={{ fontSize: 11, color: t.sub }}>{note}</div>}
    </div>
  );
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          Running tally for this playlist: {(added + already).toLocaleString()} in the playlist, {notAdded.toLocaleString()} not added yet
        </span>
        <span style={{ fontSize: 12, color: t.sub }}>
          Saved in this browser{updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString()}` : ''}{' '}
          <button onClick={onReset} style={{ ...pagerStyle(t, false), padding: '2px 8px', fontSize: 12, marginLeft: 4 }}>Reset</button>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {cell('Added', added, t.ok)}
        {cell('Already in playlist', already, t.sub)}
        {cell('Not added: quota', quota, t.warn, quota ? 'will retry' : null)}
        {cell('Not added: other errors', other, t.bad)}
        {cell('Not tried yet', untried, t.text)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Auto-retry with exponential backoff                                 */
/* ------------------------------------------------------------------ */

// Reasons worth waiting out. Everything else (playlist full, not found, no
// permission, sign-in expired) would fail the same way on every retry.
const RETRYABLE = new Set([
  'quotaExceeded', 'dailyLimitExceeded',
  'rateLimitExceeded', 'userRateLimitExceeded',
  'backendError', 'internalError', 'SERVICE_UNAVAILABLE',
  'connection',
]);
export const isRetryable = reason => RETRYABLE.has(reason);
export const isQuotaReason = reason => QUOTA_REASONS.has(reason);

const BASE_MS = 60 * 1000;
const MAX_MS = 30 * 60 * 1000;

// Milliseconds until YouTube's quota resets (midnight Pacific Time).
export function msUntilQuotaReset(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  const elapsed = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return 24 * 3600 * 1000 - elapsed;
}

// 1 min, 2, 4, 8, 16, then every 30 min. A quota retry never waits past the
// reset (+1 min of slack), so the push resumes right after midnight Pacific.
export function retryDelayMs(attempt, reason) {
  const backoff = Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
  if (isQuotaReason(reason)) return Math.min(backoff, msUntilQuotaReset() + 60 * 1000);
  return backoff;
}

const fmt = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s` : `${m}:${String(sec).padStart(2, '0')}`;
};

const Spinner = ({ color }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
    </path>
  </svg>
);

const HEADLINE = {
  quota: 'YouTube’s daily quota for this app is used up.',
  rate: 'YouTube is rate limiting us.',
  connection: 'The connection to the bot dropped.',
  other: 'YouTube returned a temporary error.',
};
const kindOf = reason =>
  isQuotaReason(reason) ? 'quota'
    : reason === 'connection' ? 'connection'
      : /RateLimit/.test(reason || '') ? 'rate' : 'other';

// Countdown + spinner shown while a retryable stop is waiting to resume.
// `plan` is { attempt, resumeAt, reason } while a retry is scheduled, or null
// when auto-retry is off (then it shows the last stop and a manual button).
export function AutoRetryPanel({ t, plan, lastReason, autoRetry, onToggle, onRetryNow }) {
  const reason = plan?.reason || lastReason;
  const kind = kindOf(reason);
  const waiting = autoRetry && plan;
  return (
    <Banner t={t} tone="warn">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {waiting && <Spinner color={t.warn} />}
        <div style={{ flex: 1, minWidth: 220 }}>
          <strong>{HEADLINE[kind]}</strong>{' '}
          {waiting
            ? <>Retrying in <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmt(plan.resumeAt - Date.now())}</span> (attempt {plan.attempt}).</>
            : <>Auto-retry is off. Resume when you’re ready.</>}
          {kind === 'quota' && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              The quota resets at midnight Pacific Time, in {fmt(msUntilQuotaReset())}. Keep this tab open to keep retrying.
            </div>
          )}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
          <input type="checkbox" checked={autoRetry} onChange={e => onToggle(e.target.checked)} />
          Auto-retry
        </label>
        <button onClick={onRetryNow} style={pagerStyle(t, false)}>Retry now</button>
      </div>
    </Banner>
  );
}
