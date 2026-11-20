'use client';
import React from 'react';
import { Field, inputStyle, btnStyle } from './youtubeUi';

// The "Add the videos" controls shared by Trawl results and Listogs: playlist
// order, the skip-duplicates option, the add/stop buttons and the playlist link.
// Presentational: the page owns the job and passes its state in.
export default function YouTubeAddVideosControls({
  t, order, onOrderChange, orderOptions, skipDuplicates, onSkipDuplicatesChange,
  skipHintItems = 'videos', locked, buttonLabel, canAdd, onAdd, pushing, onStop,
  stopping = false, playlist,
}) {
  return (
    <>
      <Field
        t={t}
        label="Playlist order"
        hint="How the videos are stacked in the YouTube playlist. Only affects videos added from now on."
        style={{ maxWidth: 360, marginBottom: 16 }}
      >
        <select value={order} onChange={e => onOrderChange(e.target.value)} disabled={locked} style={inputStyle(t)}>
          {orderOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, cursor: locked ? 'not-allowed' : 'pointer', maxWidth: 520 }}>
        <input
          type="checkbox"
          checked={skipDuplicates}
          disabled={locked}
          onChange={e => onSkipDuplicatesChange(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ fontWeight: 600 }}>Skip videos already in the playlist</span>
          <span style={{ display: 'block', fontSize: 12, color: t.sub, marginTop: 2 }}>
            On by default. A video that&apos;s already in the target playlist is skipped instead of
            added a second time, so re-running never creates duplicates. Un-check to add every
            {' '}{skipHintItems} regardless.
          </span>
        </span>
      </label>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={onAdd} disabled={!canAdd} style={btnStyle(t.accent, !canAdd)}>
          {buttonLabel}
        </button>
        {pushing && (
          <button onClick={onStop} disabled={stopping} style={btnStyle('#dc2626', stopping)}>
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
        {playlist?.id && (
          <a
            href={playlist.url || `https://www.youtube.com/playlist?list=${playlist.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: t.accent, fontWeight: 600 }}
          >
            View {playlist.title ? `“${playlist.title}”` : 'playlist'} on YouTube →
          </a>
        )}
      </div>
    </>
  );
}
