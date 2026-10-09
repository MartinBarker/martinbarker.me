'use client';
import React, { useMemo, useState } from 'react';
import { Banner, inputStyle, pagerStyle, btnStyle } from './ui';

const PAGE_SIZES = [10, 25, 50];

const SORTS = {
  newest: { label: 'Newest first', fn: (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '') },
  oldest: { label: 'Oldest first', fn: (a, b) => (a.publishedAt || '').localeCompare(b.publishedAt || '') },
  name: { label: 'Name A–Z', fn: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) },
  size: { label: 'Most videos', fn: (a, b) => (b.itemCount || 0) - (a.itemCount || 0) },
};

// Accepts a playlist URL (any youtube.com / youtu.be / music.youtube.com link
// with ?list=), or a bare playlist ID. Returns the ID or ''.
export function parsePlaylistId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const fromParam = raw.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (fromParam) return fromParam[1];
  if (/^[A-Za-z0-9_-]{12,64}$/.test(raw)) return raw;
  return '';
}

const day = iso => (iso ? iso.slice(0, 10) : '');
const videos = n => (n == null ? '? videos' : `${n} video${n === 1 ? '' : 's'}`);

// Destination picker for "Add to an existing playlist". Three ways in:
//   1. paste a playlist link or ID (checked against the connected channel),
//   2. a quick-pick dropdown of every playlist, and
//   3. a searchable, sortable, paginated list.
// Playlists that share a title are told apart by created date and ID, which
// the old single <select> didn't show — two same-named playlists looked identical.
export default function PlaylistPicker({
  t, connected, playlists, loading, error, selectedId, setSelectedId,
  onReload, savedId, onLookup,
}) {
  const [paste, setPaste] = useState('');
  const [pasteState, setPasteState] = useState(null); // { tone, text }
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);

  const list = useMemo(() => playlists || [], [playlists]);

  // Titles used more than once get the date + ID tail in the dropdown label.
  const dupTitles = useMemo(() => {
    const counts = new Map();
    for (const p of list) counts.set(p.title, (counts.get(p.title) || 0) + 1);
    return new Set([...counts].filter(([, n]) => n > 1).map(([title]) => title));
  }, [list]);

  const sorted = useMemo(() => [...list].sort(SORTS[sort].fn), [list, sort]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
  }, [sorted, query]);

  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = matches.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const selected = list.find(p => p.id === selectedId);

  const usePasted = async () => {
    const id = parsePlaylistId(paste);
    if (!id) {
      setPasteState({ tone: 'bad', text: 'That doesn’t look like a playlist link or ID. Paste a link containing “list=…”, or the ID itself.' });
      return;
    }
    const known = list.find(p => p.id === id);
    if (known) {
      setSelectedId(id);
      setPasteState({ tone: 'ok', text: `Selected “${known.title}”.` });
      return;
    }
    setChecking(true);
    setPasteState(null);
    try {
      const result = await onLookup(id);
      setSelectedId(id);
      setPasteState(result.verified
        ? { tone: 'ok', text: `Selected “${result.playlist.title}”.` }
        : { tone: 'warn', text: `Selected ${id}. It will be checked against your channel when you start adding.` });
    } catch (err) {
      setPasteState({ tone: 'bad', text: err.message });
    } finally {
      setChecking(false);
    }
  };

  if (!connected) {
    return <p style={{ color: t.sub, margin: 0 }}>Connect YouTube above to see your playlists.</p>;
  }

  const label = p =>
    `${p.title} · ${videos(p.itemCount)} · ${p.privacyStatus}` +
    (dupTitles.has(p.title) ? ` · created ${day(p.publishedAt) || '?'} · …${p.id.slice(-6)}` : '') +
    (p.id === savedId ? ' · last used for this scan' : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* 1. Paste a link or ID */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Paste a playlist link or ID</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={paste}
            onChange={e => { setPaste(e.target.value); setPasteState(null); }}
            onKeyDown={e => { if (e.key === 'Enter') usePasted(); }}
            placeholder="https://www.youtube.com/playlist?list=PL…  or  PL…"
            style={inputStyle(t, { flex: 1, minWidth: 240 })}
          />
          <button onClick={usePasted} disabled={checking || !paste.trim()} style={btnStyle(t.accent, checking || !paste.trim())}>
            {checking ? 'Checking…' : 'Use this playlist'}
          </button>
        </div>
        {pasteState && <Banner t={t} tone={pasteState.tone} compact={false}>{pasteState.text}</Banner>}
      </div>

      {loading && <p style={{ color: t.sub, margin: 0 }}>Loading your playlists…</p>}
      {error && <Banner t={t} tone="bad">{error}</Banner>}

      {!loading && !error && list.length === 0 && (
        <p style={{ color: t.sub, margin: 0 }}>
          This channel has no playlists yet. Paste one above, or switch to <em>Create a new playlist</em>.
        </p>
      )}

      {!loading && list.length > 0 && (
        <>
          {/* 2. Quick pick */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Or pick from your {list.length} playlist{list.length === 1 ? '' : 's'}</span>
              <button onClick={onReload} style={pagerStyle(t, false)}>Refresh</button>
            </div>
            <select
              value={list.some(p => p.id === selectedId) ? selectedId : ''}
              onChange={e => setSelectedId(e.target.value)}
              style={inputStyle(t)}
            >
              <option value="">— Choose a playlist —</option>
              {sorted.map(p => <option key={p.id} value={p.id}>{label(p)}</option>)}
            </select>
          </div>

          {/* 3. Search + browse */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Or search and browse</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setPage(0); }}
                placeholder="Search by name, ID or description…"
                style={inputStyle(t, { flex: 1, minWidth: 220 })}
              />
              <select value={sort} onChange={e => { setSort(e.target.value); setPage(0); }} style={inputStyle(t, { width: 'auto' })}>
                {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }} style={inputStyle(t, { width: 'auto' })}>
                {PAGE_SIZES.map(n => <option key={n} value={n}>{n} per page</option>)}
              </select>
            </div>

            <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {pageItems.length === 0 && (
                <div style={{ padding: 12, color: t.sub, fontSize: 14 }}>No playlists match “{query}”.</div>
              )}
              {pageItems.map((p, i) => {
                const isSel = p.id === selectedId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    aria-pressed={isSel}
                    style={{
                      display: 'flex', width: '100%', gap: 12, alignItems: 'center', textAlign: 'left',
                      padding: '9px 12px', border: 'none', cursor: 'pointer',
                      borderTop: i === 0 ? 'none' : `1px solid ${t.border}`,
                      background: isSel ? 'rgba(37,99,235,.12)' : t.input, color: t.text,
                      fontFamily: 'inherit',
                    }}
                  >
                    <input type="radio" readOnly checked={isSel} tabIndex={-1} style={{ pointerEvents: 'none' }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.title}
                        {p.id === savedId && <span style={{ color: t.sub, fontWeight: 400 }}> · last used for this scan</span>}
                      </span>
                      <span style={{ display: 'block', fontSize: 12, color: t.sub }}>
                        {videos(p.itemCount)} · {p.privacyStatus}
                        {p.publishedAt ? ` · created ${day(p.publishedAt)}` : ''} ·{' '}
                        <code style={{ fontSize: 11 }}>{p.id}</code>
                      </span>
                    </span>
                    <a
                      href={p.url || `https://www.youtube.com/playlist?list=${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ color: t.accent, fontSize: 12, whiteSpace: 'nowrap' }}
                    >
                      Open ↗
                    </a>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap', fontSize: 13, color: t.sub }}>
              <button onClick={() => setPage(0)} disabled={safePage === 0} style={pagerStyle(t, safePage === 0)}>« First</button>
              <button onClick={() => setPage(safePage - 1)} disabled={safePage === 0} style={pagerStyle(t, safePage === 0)}>‹ Prev</button>
              <span>
                Page {safePage + 1} of {pageCount} · {matches.length === 0 ? 0 : safePage * pageSize + 1}–
                {Math.min(matches.length, (safePage + 1) * pageSize)} of {matches.length}
              </span>
              <button onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1} style={pagerStyle(t, safePage >= pageCount - 1)}>Next ›</button>
              <button onClick={() => setPage(pageCount - 1)} disabled={safePage >= pageCount - 1} style={pagerStyle(t, safePage >= pageCount - 1)}>Last »</button>
            </div>
          </div>
        </>
      )}

      {selectedId && (
        <Banner t={t} tone="plain">
          <strong>Adding to:</strong>{' '}
          {selected ? <>“{selected.title}” · {videos(selected.itemCount)} · </> : null}
          <code style={{ fontSize: 12 }}>{selectedId}</code> ·{' '}
          <a href={selected?.url || `https://www.youtube.com/playlist?list=${selectedId}`} target="_blank" rel="noopener noreferrer" style={{ color: t.accent }}>
            Open on YouTube →
          </a>
          <div style={{ fontSize: 12, color: t.sub, marginTop: 4 }}>
            Videos already in this playlist are skipped, so re-running is safe.
          </div>
        </Banner>
      )}
    </div>
  );
}
