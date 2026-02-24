'use client';
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function YouTubeAuthPageInner() {
  const [authUrl, setAuthUrl] = useState('');
  const [authUrlLoading, setAuthUrlLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [error, setError] = useState('');
  const [playlistData, setPlaylistData] = useState({
    title: '',
    description: '',
    privacyStatus: 'private'
  });
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistCreated, setPlaylistCreated] = useState(null);
  const [clearAuthLoading, setClearAuthLoading] = useState(false);
  const [debugLog, setDebugLog] = useState([]);

  const params = useSearchParams();
  const router = useRouter();
  const authCode = params.get('code');
  const scope = params.get('scope');

  // Helper: 1 year in ms (simulate expiry)
  const YOUTUBE_AUTH_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

  const addDebugLog = (msg, type = 'info') => {
    const entry = { msg, type, time: new Date().toLocaleTimeString() };
    setDebugLog(prev => [...prev, entry]);
    console.log(`[YT Debug][${type.toUpperCase()}] ${msg}`);
  };

  /** Persist auth code in localStorage, along with set time */
  const storeYouTubeAuthCode = (code, scope) => {
    try {
      localStorage.setItem('youtube_auth_code', code);
      localStorage.setItem('youtube_auth_scope', scope);
      localStorage.setItem('youtube_auth_set_time', Date.now().toString());
    } catch (err) {
      console.error('❌ Failed to save YouTube auth code:', err);
    }
  };

  // On mount: if auth code exists, store and redirect
  useEffect(() => {
    if (authCode && scope) {
      storeYouTubeAuthCode(authCode, scope);
      // Redirect to /youtube without query params
      router.push('/youtube');
    }
  }, [authCode, scope, router]);

  // Check if user is already authenticated on mount
  useEffect(() => {
    checkAuthStatus();
    getYouTubeAuthUrl();
  }, []);

  // Check authentication status
  const checkAuthStatus = async () => {
    try {
      const apiBaseURL = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3030'
        : 'https://www.martinbarker.me/internal-api';

      const response = await fetch(`${apiBaseURL}/youtube/authStatus`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setIsAuthenticated(data.isAuthenticated);
        if (data.userInfo) {
          setUserInfo(data.userInfo);
        }
      } else {
        setIsAuthenticated(false);
        setUserInfo(null);
      }
    } catch (err) {
      console.error('Error checking auth status:', err);
      setIsAuthenticated(false);
      setUserInfo(null);
    }
  };

  // Get YouTube OAuth URL
  const getYouTubeAuthUrl = async () => {
    try {
      setAuthUrlLoading(true);
      const apiBaseURL = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3030'
        : 'https://www.martinbarker.me/internal-api';

      const response = await fetch(`${apiBaseURL}/youtube/getAuthUrl`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setAuthUrl(data.url);
      } else {
        setError('Failed to get authentication URL');
      }
    } catch (err) {
      console.error('Error fetching auth URL:', err);
      setError('Failed to get authentication URL');
    } finally {
      setAuthUrlLoading(false);
    }
  };

  // YouTube Auth Status state
  const [youtubeAuthStatus, setYoutubeAuthStatus] = useState({
    exists: false,
    code: null,
    scope: null,
    setTime: null,
    expiresAt: null
  });

  // Check if user can create playlists (either server authenticated or localStorage has valid code)
  const canCreatePlaylists = isAuthenticated || (youtubeAuthStatus.exists && youtubeAuthStatus.expiresAt && new Date(youtubeAuthStatus.expiresAt) > new Date());

  // Check localStorage for YouTube auth code and expiry
  useEffect(() => {
    const code = localStorage.getItem('youtube_auth_code');
    const scope = localStorage.getItem('youtube_auth_scope');
    const setTimeStr = localStorage.getItem('youtube_auth_set_time');
    let setTime = setTimeStr ? parseInt(setTimeStr, 10) : null;
    let expiresAt = setTime ? setTime + YOUTUBE_AUTH_EXPIRY_MS : null;
    setYoutubeAuthStatus({
      exists: !!(code && scope),
      code,
      scope,
      setTime,
      expiresAt
    });
  }, []);

  // Clear authentication data
  const clearAuth = async () => {
    if (clearAuthLoading) return;

    setClearAuthLoading(true);
    setError('');

    try {
      const apiBaseURL = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3030'
        : 'https://www.martinbarker.me/internal-api';

      const response = await fetch(`${apiBaseURL}/youtube/clearAuth`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        setIsAuthenticated(false);
        setUserInfo(null);

        localStorage.removeItem('youtube_auth_code');
        localStorage.removeItem('youtube_auth_scope');
        localStorage.removeItem('youtube_auth_set_time');
        localStorage.removeItem('youtube_tokens');

        setYoutubeAuthStatus({
          exists: false,
          code: null,
          scope: null,
          setTime: null,
          expiresAt: null
        });

        getYouTubeAuthUrl();
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        setError(errorData.error || 'Failed to clear authentication');
      }
    } catch (err) {
      console.error('Error clearing auth:', err);
      setError('Failed to clear authentication: ' + err.message);
    } finally {
      setClearAuthLoading(false);
    }
  };

  // Clear only stored tokens (not the auth code), useful when tokens are expired
  const clearStoredTokens = () => {
    localStorage.removeItem('youtube_tokens');
    setDebugLog([]);
    addDebugLog('Cleared stored tokens from localStorage. Will re-exchange code on next attempt.', 'info');
  };

  // Create playlist
  const createPlaylist = async () => {
    if (!playlistData.title.trim()) {
      setError('Please enter a playlist title');
      return;
    }

    setPlaylistLoading(true);
    setError('');
    setDebugLog([]);

    try {
      const apiBaseURL = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3030'
        : 'https://www.martinbarker.me/internal-api';

      addDebugLog(`API base URL: ${apiBaseURL}`, 'info');

      // Get tokens: try localStorage first, then exchange auth code if needed
      let tokens = null;
      const storedTokensRaw = localStorage.getItem('youtube_tokens');
      if (storedTokensRaw) {
        try {
          tokens = JSON.parse(storedTokensRaw);
          addDebugLog(`Found stored tokens in localStorage. access_token present: ${!!tokens?.access_token}, refresh_token present: ${!!tokens?.refresh_token}`, 'info');
        } catch (e) {
          addDebugLog('Found stored tokens in localStorage but failed to parse JSON — will re-exchange auth code', 'warn');
        }
      } else {
        addDebugLog('No stored tokens in localStorage', 'info');
      }

      if (!tokens && youtubeAuthStatus.exists && youtubeAuthStatus.code) {
        addDebugLog(`Attempting to exchange auth code for tokens...`, 'info');
        addDebugLog(`Auth code (first 4 chars): ${youtubeAuthStatus.code?.substring(0, 4)}...`, 'info');

        const tokenResponse = await fetch(`${apiBaseURL}/youtube/exchangeCode`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            code: youtubeAuthStatus.code,
            scope: youtubeAuthStatus.scope
          })
        });

        addDebugLog(`exchangeCode response status: ${tokenResponse.status} ${tokenResponse.statusText}`, tokenResponse.ok ? 'info' : 'error');

        const tokenData = await tokenResponse.json().catch(e => ({ parseError: e.message }));

        if (!tokenResponse.ok) {
          // Build a rich error message from whatever the server returned
          let exchangeError = tokenData.error || 'Failed to exchange auth code for tokens';
          if (tokenData.details) exchangeError += ` | Details: ${tokenData.details}`;
          if (tokenData.googleError) exchangeError += ` | Google error: ${tokenData.googleError}`;
          if (tokenData.googleErrorDescription) exchangeError += ` (${tokenData.googleErrorDescription})`;
          if (tokenData.redirectUriUsed) exchangeError += ` | Server used redirect_uri: ${tokenData.redirectUriUsed}`;

          addDebugLog(`exchangeCode FAILED: ${exchangeError}`, 'error');
          addDebugLog('The auth code may be expired, already used, or there is a redirect_uri mismatch. Try clearing auth and signing in again.', 'warn');

          // If the code is no longer valid, remove it from localStorage so the user can re-auth
          localStorage.removeItem('youtube_auth_code');
          localStorage.removeItem('youtube_auth_scope');
          localStorage.removeItem('youtube_auth_set_time');
          setYoutubeAuthStatus({ exists: false, code: null, scope: null, setTime: null, expiresAt: null });

          setError(exchangeError);
          setPlaylistLoading(false);
          return;
        }

        if (tokenData.parseError) {
          addDebugLog(`exchangeCode returned non-JSON response: ${tokenData.parseError}`, 'error');
          setError('Server returned unexpected response during token exchange');
          setPlaylistLoading(false);
          return;
        }

        if (tokenData.tokens) {
          tokens = tokenData.tokens;
          localStorage.setItem('youtube_tokens', JSON.stringify(tokens));
          addDebugLog(`Token exchange succeeded. access_token present: ${!!tokens?.access_token}, refresh_token present: ${!!tokens?.refresh_token}`, 'info');
        } else {
          addDebugLog('exchangeCode returned 200 OK but response contained no tokens object. Full response: ' + JSON.stringify(tokenData), 'error');
          setError('Token exchange returned no tokens — check server logs');
          setPlaylistLoading(false);
          return;
        }
      } else if (!tokens) {
        addDebugLog(`No tokens and no stored auth code (exists=${youtubeAuthStatus.exists}, code=${!!youtubeAuthStatus.code}). Relying on server session.`, 'info');
      }

      addDebugLog(`Calling createPlaylist... tokens in body: ${!!tokens}, session auth will be checked server-side`, 'info');

      const response = await fetch(`${apiBaseURL}/youtube/createPlaylist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          ...playlistData,
          tokens: tokens || undefined
        })
      });

      addDebugLog(`createPlaylist response status: ${response.status} ${response.statusText}`, response.ok ? 'info' : 'error');

      if (response.ok) {
        const result = await response.json();
        addDebugLog(`Playlist created successfully! ID: ${result.id}`, 'info');
        setPlaylistCreated(result);
        setPlaylistData({
          title: '',
          description: '',
          privacyStatus: 'private'
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        let errorMessage = errorData.error || 'Failed to create playlist';

        if (errorData.details) errorMessage += ` | ${errorData.details}`;
        if (errorData.code) errorMessage += ` (HTTP ${errorData.code})`;
        if (errorData.reason) errorMessage += ` — Reason: ${errorData.reason}`;
        if (errorData.errors && errorData.errors.length > 0) {
          errorMessage += ` | YouTube errors: ${JSON.stringify(errorData.errors)}`;
        }

        addDebugLog(`createPlaylist FAILED: ${errorMessage}`, 'error');

        if (response.status === 401) {
          addDebugLog('401 Unauthorized — the tokens are invalid or expired. Clearing stored tokens. Please clear auth and sign in again.', 'warn');
          localStorage.removeItem('youtube_tokens');
        }

        setError(errorMessage);
      }
    } catch (err) {
      console.error('Error creating playlist:', err);
      const msg = err.message || 'Unknown error';
      addDebugLog(`Unexpected JS error: ${msg}`, 'error');
      setError(msg);
    } finally {
      setPlaylistLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      {/* YouTube Auth Info Section */}
      <div style={{
        background: '#f5f7fa',
        border: '1px solid #e3e8ee',
        borderRadius: 8,
        padding: '24px 20px',
        marginBottom: 32,
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
      }}>
        <h1 style={{ marginTop: 0, marginBottom: 16, fontSize: 28 }}>
          YouTube Authentication
        </h1>
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

      {/* LocalStorage Auth Status */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 16 }}>Local Storage Auth Status</h2>
        {youtubeAuthStatus.exists ? (
          <div style={{
            background: '#d4edda',
            border: '1px solid #c3e6cb',
            borderRadius: 6,
            padding: '16px',
            marginBottom: 16
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: '#155724', fontWeight: 'bold' }}>✅ Auth Code Stored</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 14, color: '#155724' }}>
              <div>Code: {youtubeAuthStatus.code ? 'Present' : 'Missing'}</div>
              <div>Scope: {youtubeAuthStatus.scope || 'None'}</div>
              <div>Set: {youtubeAuthStatus.setTime ? new Date(youtubeAuthStatus.setTime).toLocaleString() : 'Unknown'}</div>
              <div>Expires: {youtubeAuthStatus.expiresAt ? new Date(youtubeAuthStatus.expiresAt).toLocaleString() : 'Unknown'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                onClick={clearAuth}
                disabled={clearAuthLoading}
                style={{
                  padding: '8px 16px',
                  background: clearAuthLoading ? '#6c757d' : '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: clearAuthLoading ? 'not-allowed' : 'pointer',
                  fontSize: 14
                }}
              >
                {clearAuthLoading ? 'Clearing...' : 'Clear Authentication'}
              </button>
              <button
                onClick={clearStoredTokens}
                style={{
                  padding: '8px 16px',
                  background: '#fd7e14',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 14
                }}
              >
                Clear Stored Tokens Only
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            background: '#f8d7da',
            border: '1px solid #f5c6cb',
            borderRadius: 6,
            padding: '16px',
            marginBottom: 16
          }}>
            <span style={{ color: '#721c24', fontWeight: 'bold' }}>❌ No auth code stored</span>
          </div>
        )}
      </div>


      {/* Sign In Button - Only show if no localStorage auth */}
      {!youtubeAuthStatus.exists && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ marginBottom: 16 }}>Sign In</h2>
          <button
            onClick={() => {
              if (authUrl && !authUrlLoading) {
                window.location.href = authUrl;
              }
            }}
            disabled={authUrlLoading || !authUrl || authUrl.startsWith('Error')}
            style={{
              padding: '12px 24px',
              fontSize: 16,
              background: authUrlLoading ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: authUrlLoading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              transition: 'background 0.2s'
            }}
            onMouseOver={e => {
              if (!authUrlLoading && authUrl) {
                e.currentTarget.style.background = '#0056b3';
              }
            }}
            onMouseOut={e => {
              if (!authUrlLoading && authUrl) {
                e.currentTarget.style.background = '#007bff';
              }
            }}
          >
            {authUrlLoading ? 'Loading...' : 'Sign in with YouTube'}
          </button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div style={{
          background: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: 6,
          padding: '16px',
          marginBottom: 24
        }}>
          <span style={{ color: '#721c24', fontWeight: 'bold' }}>Error: </span>
          <span style={{ color: '#721c24', fontFamily: 'monospace', fontSize: 13 }}>{error}</span>
        </div>
      )}

      {/* Create Playlist Section */}
      {canCreatePlaylists && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 16 }}>Create Playlist</h2>
          <div style={{
            background: '#f8f9fa',
            border: '1px solid #dee2e6',
            borderRadius: 6,
            padding: '20px'
          }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                Playlist Title *
              </label>
              <input
                type="text"
                value={playlistData.title}
                onChange={(e) => setPlaylistData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Enter playlist title"
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ced4da',
                  borderRadius: 4,
                  fontSize: 14,
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                Description
              </label>
              <textarea
                value={playlistData.description}
                onChange={(e) => setPlaylistData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Enter playlist description (optional)"
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ced4da',
                  borderRadius: 4,
                  fontSize: 14,
                  resize: 'vertical',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                Privacy Status
              </label>
              <select
                value={playlistData.privacyStatus}
                onChange={(e) => setPlaylistData(prev => ({ ...prev, privacyStatus: e.target.value }))}
                style={{
                  padding: '10px',
                  border: '1px solid #ced4da',
                  borderRadius: 4,
                  fontSize: 14,
                  background: 'white'
                }}
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
                padding: '12px 24px',
                fontSize: 16,
                background: playlistLoading ? '#6c757d' : '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: playlistLoading ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                transition: 'background 0.2s'
              }}
              onMouseOver={e => {
                if (!playlistLoading) {
                  e.currentTarget.style.background = '#218838';
                }
              }}
              onMouseOut={e => {
                if (!playlistLoading) {
                  e.currentTarget.style.background = '#28a745';
                }
              }}
            >
              {playlistLoading ? 'Creating...' : 'Create Playlist'}
            </button>

            {playlistCreated && (
              <div style={{
                marginTop: 16,
                padding: '12px',
                background: '#d4edda',
                border: '1px solid #c3e6cb',
                borderRadius: 4
              }}>
                <div style={{ color: '#155724', fontWeight: 'bold', marginBottom: 8 }}>
                  ✅ Playlist Created Successfully!
                </div>
                <div style={{ color: '#155724', marginBottom: 4 }}>
                  <strong>Title:</strong> {playlistCreated.snippet?.title}
                </div>
                <div style={{ color: '#155724', marginBottom: 4 }}>
                  <strong>ID:</strong> {playlistCreated.id}
                </div>
                <div style={{ color: '#155724', marginBottom: 8 }}>
                  <strong>Privacy:</strong> {playlistCreated.status?.privacyStatus}
                </div>
                <a
                  href={`https://www.youtube.com/playlist?list=${playlistCreated.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#007bff',
                    textDecoration: 'none',
                    fontWeight: 'bold'
                  }}
                >
                  View Playlist on YouTube →
                </a>
              </div>
            )}
          </div>

          {/* Debug Log Panel */}
          {debugLog.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>Debug Log</h3>
                <button
                  onClick={() => setDebugLog([])}
                  style={{ fontSize: 12, padding: '2px 8px', cursor: 'pointer' }}
                >
                  Clear
                </button>
              </div>
              <div style={{
                background: '#1e1e1e',
                borderRadius: 6,
                padding: '12px',
                fontFamily: 'monospace',
                fontSize: 12,
                maxHeight: 300,
                overflowY: 'auto'
              }}>
                {debugLog.map((entry, i) => (
                  <div key={i} style={{
                    color: entry.type === 'error' ? '#ff6b6b' : entry.type === 'warn' ? '#ffd43b' : '#a8d8ea',
                    marginBottom: 4,
                    lineHeight: 1.5,
                    wordBreak: 'break-word'
                  }}>
                    <span style={{ color: '#888', marginRight: 8 }}>[{entry.time}]</span>
                    <span style={{ color: entry.type === 'error' ? '#ff6b6b' : entry.type === 'warn' ? '#ffd43b' : '#69db7c', marginRight: 8, textTransform: 'uppercase', fontSize: 10 }}>{entry.type}</span>
                    {entry.msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Features Section */}
      {canCreatePlaylists && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 16 }}>Available Features</h2>
          <div style={{
            background: '#e7f3ff',
            border: '1px solid #b3d9ff',
            borderRadius: 6,
            padding: '16px'
          }}>
            <p style={{ margin: 0, color: '#004085' }}>
              {isAuthenticated
                ? "You are now authenticated with YouTube! You can now use YouTube API features such as creating playlists, managing videos, and accessing your channel data."
                : "You have a valid YouTube auth code stored locally! You can create playlists using your stored authentication."
              }
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
