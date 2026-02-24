'use client';
import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import YouTubeAuth from '../YouTubeAuth/YouTubeAuth';

const apiBaseURL = () =>
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:3030'
    : 'https://www.martinbarker.me/internal-api';

function YouTubeAuthPageInner() {
  const [playlistData, setPlaylistData] = useState({ title: '', description: '', privacyStatus: 'private' });
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistCreated, setPlaylistCreated] = useState(null);
  const [error, setError] = useState('');
  const [debugLog, setDebugLog] = useState([]);
  const [canAuth, setCanAuth] = useState(false);

  const getTokensRef = useRef(null);
  const params = useSearchParams();
  const router = useRouter();
  const authCode = params.get('code');
  const scope = params.get('scope');

  const addDebugLog = (msg, type = 'info') => {
    const entry = { msg, type, time: new Date().toLocaleTimeString() };
    setDebugLog(prev => [...prev, entry]);
    console.log(`[YT Debug][${type.toUpperCase()}] ${msg}`);
  };

  // On OAuth redirect: store code, check for returnUrl, redirect
  useEffect(() => {
    if (authCode && scope) {
      try {
        localStorage.setItem('youtube_auth_code', authCode);
        localStorage.setItem('youtube_auth_scope', scope);
        localStorage.setItem('youtube_auth_set_time', Date.now().toString());
      } catch (err) {
        console.error('Failed to save YouTube auth code:', err);
      }
      const returnUrl = localStorage.getItem('youtube_auth_return_url');
      if (returnUrl && returnUrl !== '/youtube') {
        localStorage.removeItem('youtube_auth_return_url');
        router.push(returnUrl);
      } else {
        router.push('/youtube');
      }
    }
  }, [authCode, scope, router]);

  const createPlaylist = async () => {
    if (!playlistData.title.trim()) {
      setError('Please enter a playlist title');
      return;
    }
    setPlaylistLoading(true);
    setError('');
    setDebugLog([]);

    try {
      addDebugLog(`API base URL: ${apiBaseURL()}`, 'info');

      const tokens = await getTokensRef.current?.getTokens();
      if (!tokens) {
        addDebugLog('No tokens available — relying on server session', 'info');
      } else {
        addDebugLog(`Tokens ready. access_token: ${!!tokens.access_token}, refresh_token: ${!!tokens.refresh_token}`, 'info');
      }

      addDebugLog('Calling createPlaylist...', 'info');
      const response = await fetch(`${apiBaseURL()}/youtube/createPlaylist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...playlistData, tokens: tokens || undefined }),
      });

      addDebugLog(`createPlaylist response: ${response.status} ${response.statusText}`, response.ok ? 'info' : 'error');

      if (response.ok) {
        const result = await response.json();
        addDebugLog(`Playlist created! ID: ${result.id}`, 'info');
        setPlaylistCreated(result);
        setPlaylistData({ title: '', description: '', privacyStatus: 'private' });
      } else {
        const errorData = await response.json().catch(() => ({}));
        let msg = errorData.error || 'Failed to create playlist';
        if (errorData.details) msg += ` | ${errorData.details}`;
        if (errorData.code) msg += ` (HTTP ${errorData.code})`;
        if (errorData.reason) msg += ` — Reason: ${errorData.reason}`;
        if (errorData.errors?.length > 0) msg += ` | YouTube errors: ${JSON.stringify(errorData.errors)}`;
        addDebugLog(`createPlaylist FAILED: ${msg}`, 'error');
        if (response.status === 401) {
          addDebugLog('401 — tokens invalid/expired. Clearing. Please sign in again.', 'warn');
          localStorage.removeItem('youtube_tokens');
        }
        setError(msg);
      }
    } catch (err) {
      const msg = err.message || 'Unknown error';
      addDebugLog(`Unexpected error: ${msg}`, 'error');
      setError(msg);
    } finally {
      setPlaylistLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Page header */}
      <div style={{
        background: '#f5f7fa', border: '1px solid #e3e8ee', borderRadius: 8,
        padding: '24px 20px', marginBottom: 32, boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
      }}>
        <h1 style={{ marginTop: 0, marginBottom: 16, fontSize: 28 }}>YouTube Authentication</h1>
        <p style={{ fontSize: 17, marginBottom: 8 }}>
          Authenticate with YouTube to access your playlists and manage your YouTube content.
        </p>
        <ul style={{ fontSize: 16, marginBottom: 8, paddingLeft: 22 }}>
          <li>Sign in with your Google/YouTube account</li>
          <li>Access your YouTube playlists and videos</li>
          <li>Create and manage playlists programmatically</li>
          <li>Clear your authentication data at any time</li>
        </ul>
      </div>

      {/* Auth component */}
      <YouTubeAuth
        compact={false}
        returnUrl="/youtube"
        getTokensRef={getTokensRef}
        onAuthStateChange={({ canAuth: c }) => setCanAuth(c)}
      />

      {/* Playlist-specific error */}
      {error && (
        <div style={{ background: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: 6, padding: '16px', marginBottom: 24 }}>
          <span style={{ color: '#721c24', fontWeight: 'bold' }}>Error: </span>
          <span style={{ color: '#721c24', fontFamily: 'monospace', fontSize: 13 }}>{error}</span>
        </div>
      )}

      {/* Create Playlist */}
      {canAuth && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 16 }}>Create Playlist</h2>
          <div style={{ background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 6, padding: '20px' }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Playlist Title *</label>
              <input
                type="text"
                value={playlistData.title}
                onChange={e => setPlaylistData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Enter playlist title"
                style={{ width: '100%', padding: '10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Description</label>
              <textarea
                value={playlistData.description}
                onChange={e => setPlaylistData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Enter playlist description (optional)"
                rows={3}
                style={{ width: '100%', padding: '10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Privacy Status</label>
              <select
                value={playlistData.privacyStatus}
                onChange={e => setPlaylistData(prev => ({ ...prev, privacyStatus: e.target.value }))}
                style={{ padding: '10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: 14, background: 'white' }}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
              </select>
            </div>
            <button
              onClick={createPlaylist}
              disabled={playlistLoading}
              style={{
                padding: '12px 24px', fontSize: 16,
                background: playlistLoading ? '#6c757d' : '#28a745',
                color: 'white', border: 'none', borderRadius: 6,
                cursor: playlistLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold'
              }}
              onMouseOver={e => { if (!playlistLoading) e.currentTarget.style.background = '#218838'; }}
              onMouseOut={e => { if (!playlistLoading) e.currentTarget.style.background = '#28a745'; }}
            >
              {playlistLoading ? 'Creating...' : 'Create Playlist'}
            </button>

            {playlistCreated && (
              <div style={{ marginTop: 16, padding: '12px', background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 4 }}>
                <div style={{ color: '#155724', fontWeight: 'bold', marginBottom: 8 }}>✅ Playlist Created Successfully!</div>
                <div style={{ color: '#155724', marginBottom: 4 }}><strong>Title:</strong> {playlistCreated.snippet?.title}</div>
                <div style={{ color: '#155724', marginBottom: 4 }}><strong>ID:</strong> {playlistCreated.id}</div>
                <div style={{ color: '#155724', marginBottom: 8 }}><strong>Privacy:</strong> {playlistCreated.status?.privacyStatus}</div>
                <a href={`https://www.youtube.com/playlist?list=${playlistCreated.id}`} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#007bff', textDecoration: 'none', fontWeight: 'bold' }}>
                  View Playlist on YouTube →
                </a>
              </div>
            )}

            {/* Debug Log */}
            {debugLog.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>Debug Log</h3>
                  <button onClick={() => setDebugLog([])} style={{ fontSize: 12, padding: '2px 8px', cursor: 'pointer' }}>Clear</button>
                </div>
                <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '12px', fontFamily: 'monospace', fontSize: 12, maxHeight: 300, overflowY: 'auto' }}>
                  {debugLog.map((entry, i) => (
                    <div key={i} style={{ color: entry.type === 'error' ? '#ff6b6b' : entry.type === 'warn' ? '#ffd43b' : '#a8d8ea', marginBottom: 4, lineHeight: 1.5, wordBreak: 'break-word' }}>
                      <span style={{ color: '#888', marginRight: 8 }}>[{entry.time}]</span>
                      <span style={{ color: entry.type === 'error' ? '#ff6b6b' : entry.type === 'warn' ? '#ffd43b' : '#69db7c', marginRight: 8, textTransform: 'uppercase', fontSize: 10 }}>{entry.type}</span>
                      {entry.msg}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Features */}
      {canAuth && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 16 }}>Available Features</h2>
          <div style={{ background: '#e7f3ff', border: '1px solid #b3d9ff', borderRadius: 6, padding: '16px' }}>
            <p style={{ margin: 0, color: '#004085' }}>
              You have a valid YouTube auth code stored locally! You can create playlists using your stored authentication.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function YouTubeAuthPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <YouTubeAuthPageInner />
    </Suspense>
  );
}
