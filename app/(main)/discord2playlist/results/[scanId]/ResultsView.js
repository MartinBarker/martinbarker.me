'use client';
import React, { useState, useEffect, useRef, useContext, useMemo } from 'react';
import { ColorContext } from '../../../ColorContext';

const BOT_API_URL = process.env.NEXT_PUBLIC_BOT_API_URL || 'http://localhost:3000';

const PLATFORM_LABEL = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  bandcamp: 'Bandcamp',
};

export default function ResultsView({ scanId, token, tracks, alreadyConnected, scanJob }) {
  const ctx = useContext(ColorContext) || {};
  const darkMode = !!ctx.darkMode;

  const [connected, setConnected] = useState(alreadyConnected);
  const [pushing, setPushing] = useState(false);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [playlistUrl, setPlaylistUrl] = useState(null);
  const [error, setError] = useState('');
  const evtRef = useRef(null);

  const youtubeCount = useMemo(
    () => tracks.filter(t => t.platform === 'youtube').length,
    [tracks]
  );

  const t = {
    bg: darkMode ? '#1e1e2e' : '#ffffff',
    card: darkMode ? '#252538' : '#f7f9fc',
    text: darkMode ? '#f0f0f5' : '#1a1a2e',
    sub: darkMode ? '#a0aec0' : '#5a6478',
    border: darkMode ? '#3a3a52' : '#e3e8ee',
  };

  // Receive the "connected" signal from the OAuth popup.
  useEffect(() => {
    const onMsg = (e) => {
      if (e?.data?.type === 'youtube-connected') {
        setConnected(true);
        setError('');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => () => { if (evtRef.current) evtRef.current.close(); }, []);

  const connectYouTube = () => {
    const url = `${BOT_API_URL}/api/scans/${scanId}/youtube/oauth/start?t=${encodeURIComponent(token)}`;
    window.open(url, 'connect-youtube', 'width=520,height=680');
  };

  const addAll = () => {
    setError('');
    setPushing(true);
    setDone(0);
    setFailed(0);
    setPlaylistUrl(null);

    const url = `${BOT_API_URL}/api/scans/${scanId}/push?t=${encodeURIComponent(token)}`;
    const evt = new EventSource(url);
    evtRef.current = evt;

    evt.addEventListener('start', e => setTotal(JSON.parse(e.data).total));
    evt.addEventListener('progress', e => {
      const { status } = JSON.parse(e.data);
      if (status === 'inserted') setDone(d => d + 1);
      else if (status === 'failed') setFailed(f => f + 1);
    });
    evt.addEventListener('done', e => {
      const { playlistId } = JSON.parse(e.data);
      if (playlistId) setPlaylistUrl(`https://www.youtube.com/playlist?list=${playlistId}`);
      setPushing(false);
      evt.close();
    });
    evt.addEventListener('error', (e) => {
      let code;
      try { code = JSON.parse(e.data)?.code; } catch {}
      if (code === 'no_youtube') { setConnected(false); setError('Please connect YouTube first.'); }
      else setError('Connection dropped — click “Add all to YouTube” to resume.');
      setPushing(false);
      evt.close();
    });
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px', color: t.text }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Your scanned tracks</h1>
      <p style={{ color: t.sub, marginTop: 0 }}>
        Found <strong>{tracks.length}</strong> track{tracks.length === 1 ? '' : 's'}
        {youtubeCount !== tracks.length && <> · <strong>{youtubeCount}</strong> on YouTube (addable to a playlist)</>}.
      </p>

      {/* Actions */}
      <div style={{
        display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
        padding: 16, background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 10, margin: '16px 0 24px',
      }}>
        {!connected ? (
          <button onClick={connectYouTube} style={btnStyle('#dc2626')}>Connect YouTube</button>
        ) : (
          <span style={{ color: darkMode ? '#68d391' : '#16794c', fontWeight: 600 }}>✅ YouTube connected</span>
        )}
        <button
          onClick={addAll}
          disabled={!connected || pushing || youtubeCount === 0}
          style={btnStyle('#2563eb', !connected || pushing || youtubeCount === 0)}
        >
          {pushing ? `Adding ${done}/${total}…` : 'Add all to YouTube'}
        </button>
        {playlistUrl && (
          <a href={playlistUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: '#2563eb', fontWeight: 600 }}>
            View playlist on YouTube →
          </a>
        )}
      </div>

      {pushing && (
        <div style={{ marginBottom: 16, color: t.sub }}>
          Adding tracks… {done} added{failed > 0 ? `, ${failed} failed` : ''} of {total}.
        </div>
      )}
      {!pushing && (done > 0 || failed > 0) && !error && (
        <div style={{ marginBottom: 16, color: t.sub }}>
          Done — {done} added{failed > 0 ? `, ${failed} failed` : ''}.
        </div>
      )}
      {error && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 8,
          background: darkMode ? '#3a1a1a' : '#fff5f5',
          border: `1px solid ${darkMode ? '#6b2d2d' : '#feb2b2'}`,
          color: darkMode ? '#fc8181' : '#c53030',
        }}>{error}</div>
      )}

      {/* Track list */}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tracks.map((tr, i) => (
          <li key={`${tr.platform}:${tr.media_id}:${i}`} style={{
            display: 'flex', gap: 12, alignItems: 'center',
            padding: '10px 14px', background: t.card,
            border: `1px solid ${t.border}`, borderRadius: 8,
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              color: t.sub, minWidth: 86,
            }}>{PLATFORM_LABEL[tr.platform] || tr.platform}</span>
            <a
              href={tr.media_url ? `https://${tr.media_url}` : '#'}
              target="_blank" rel="noopener noreferrer"
              style={{ color: t.text, textDecoration: 'none', wordBreak: 'break-all', flex: 1 }}
            >
              {tr.media_url || tr.media_id}
            </a>
            {tr.author_username && (
              <span style={{ color: t.sub, fontSize: 13 }}>by {tr.author_username}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function btnStyle(bg, disabled = false) {
  return {
    padding: '10px 18px', fontSize: 14, fontWeight: 700,
    background: disabled ? '#6c757d' : bg, color: '#fff',
    border: 'none', borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
