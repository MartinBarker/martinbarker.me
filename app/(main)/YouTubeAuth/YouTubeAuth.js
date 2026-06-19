'use client';
import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';

const YOUTUBE_AUTH_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

const apiBaseURL = () =>
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:3030'
    : 'https://www.martinbarker.me/internal-api';

function YouTubeAuth({ compact = false, returnUrl = '/youtube', onAuthStateChange, getTokensRef, blackTextOnWhite = false, darkMode = false }, _ref) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [authUrlLoading, setAuthUrlLoading] = useState(true);
  const [clearAuthLoading, setClearAuthLoading] = useState(false);
  const [error, setError] = useState('');
  const [debugLog, setDebugLog] = useState([]);
  // 'unknown' | 'checking' | 'valid' | 'invalid'
  const [tokenValidity, setTokenValidity] = useState('unknown');
  const [tokenValidityReason, setTokenValidityReason] = useState('');
  const [youtubeAuthStatus, setYoutubeAuthStatus] = useState({
    exists: false,
    code: null,
    scope: null,
    setTime: null,
    expiresAt: null,
  });

  // Only show signed-in once tokens have been verified against Google.
  // If verification hasn't completed yet, we treat the user as signed-out so
  // they can't attempt an upload that will fail with invalid_grant.
  const hasLocalAuth =
    isAuthenticated ||
    (youtubeAuthStatus.exists &&
      youtubeAuthStatus.expiresAt &&
      new Date(youtubeAuthStatus.expiresAt) > new Date());
  const canAuth = hasLocalAuth && tokenValidity === 'valid';

  // Only surface the raw, console-style debug log in local development.
  // In production it stays internal (still captured for getTokensRef) but is
  // never rendered to end users.
  const showDebugLog = process.env.NODE_ENV === 'development';

  const addDebugLog = (msg, type = 'info') => {
    setDebugLog(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
  };

  // Read localStorage auth status
  const refreshLocalAuthStatus = () => {
    try {
      const code = localStorage.getItem('youtube_auth_code');
      const scope = localStorage.getItem('youtube_auth_scope');
      const setTimeStr = localStorage.getItem('youtube_auth_set_time');
      const setTime = setTimeStr ? parseInt(setTimeStr, 10) : null;
      const expiresAt = setTime ? setTime + YOUTUBE_AUTH_EXPIRY_MS : null;
      const next = { exists: !!(code && scope), code, scope, setTime, expiresAt };
      setYoutubeAuthStatus(next);
      return next;
    } catch {
      return { exists: false, code: null, scope: null, setTime: null, expiresAt: null };
    }
  };

  // Check server-side auth
  const checkAuthStatus = async () => {
    try {
      const res = await fetch(`${apiBaseURL()}/youtube/authStatus`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setIsAuthenticated(data.isAuthenticated);
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    }
  };

  // Get OAuth sign-in URL
  const getYouTubeAuthUrl = async () => {
    setAuthUrlLoading(true);
    try {
      const res = await fetch(`${apiBaseURL()}/youtube/getAuthUrl`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAuthUrl(data.url);
      }
    } catch {
      setError('Failed to get authentication URL');
    } finally {
      setAuthUrlLoading(false);
    }
  };

  // Get tokens: localStorage first, then exchange auth code
  const getTokens = async () => {
    const storedRaw = localStorage.getItem('youtube_tokens');
    if (storedRaw) {
      try {
        const tokens = JSON.parse(storedRaw);
        if (tokens?.access_token) return tokens;
      } catch {}
    }
    const status = refreshLocalAuthStatus();
    if (!status.code) return null;
    addDebugLog('Exchanging auth code for tokens...', 'info');
    addDebugLog(`Auth code (first 4 chars): ${status.code.substring(0, 4)}...`, 'info');
    try {
      const res = await fetch(`${apiBaseURL()}/youtube/exchangeCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: status.code, scope: status.scope }),
      });
      const data = await res.json().catch(e => ({ parseError: e.message }));
      if (!res.ok) {
        let msg = data.error || 'Failed to exchange auth code';
        if (data.details) msg += ` | ${data.details}`;
        if (data.googleError) msg += ` | Google: ${data.googleError}`;
        if (data.googleErrorDescription) msg += ` (${data.googleErrorDescription})`;
        if (data.redirectUriUsed) msg += ` | redirect_uri: ${data.redirectUriUsed}`;
        addDebugLog(`exchangeCode FAILED: ${msg}`, 'error');
        // Auth code is stale — clear it
        localStorage.removeItem('youtube_auth_code');
        localStorage.removeItem('youtube_auth_scope');
        localStorage.removeItem('youtube_auth_set_time');
        setYoutubeAuthStatus({ exists: false, code: null, scope: null, setTime: null, expiresAt: null });
        setError(msg);
        return null;
      }
      if (data.tokens) {
        localStorage.setItem('youtube_tokens', JSON.stringify(data.tokens));
        addDebugLog('Token exchange succeeded', 'info');
        return data.tokens;
      }
    } catch (err) {
      addDebugLog(`Token exchange error: ${err.message}`, 'error');
    }
    return null;
  };

  // Expose getTokens via ref
  useEffect(() => {
    if (getTokensRef) {
      getTokensRef.current = { getTokens, addDebugLog };
    }
  });

  // Clear all auth data
  const clearAuth = async () => {
    if (clearAuthLoading) return;
    setClearAuthLoading(true);
    setError('');
    try {
      await fetch(`${apiBaseURL()}/youtube/clearAuth`, { method: 'POST', credentials: 'include' });
    } catch {}
    setIsAuthenticated(false);
    ['youtube_auth_code', 'youtube_auth_scope', 'youtube_auth_set_time', 'youtube_tokens'].forEach(
      k => localStorage.removeItem(k)
    );
    setYoutubeAuthStatus({ exists: false, code: null, scope: null, setTime: null, expiresAt: null });
    setTokenValidity('unknown');
    setTokenValidityReason('');
    getYouTubeAuthUrl();
    setClearAuthLoading(false);
  };

  // Clear only cached tokens (so code can be re-exchanged)
  const clearStoredTokens = () => {
    localStorage.removeItem('youtube_tokens');
    setDebugLog([]);
    addDebugLog('Cleared stored tokens. Will re-exchange code on next attempt.', 'info');
  };

  // Initiate sign-in — redirect the current tab to Google's OAuth page.
  // We stash the desired post-auth return URL in localStorage so the
  // /youtube callback page can router.push() us back here once the auth
  // code is captured (see app/(main)/youtube/page.js).
  const handleSignIn = () => {
    if (!authUrl || authUrlLoading) return;
    // Clear any stale popup-flow flag from previous sessions so the callback
    // page doesn't show the "you can close this tab" screen on a same-tab flow.
    try { localStorage.removeItem('youtube_auth_popup_flow'); } catch {}
    if (returnUrl && returnUrl !== '/youtube') {
      try { localStorage.setItem('youtube_auth_return_url', returnUrl); } catch {}
    }
    window.location.href = authUrl;
  };

  // Verify cached tokens actually work against Google (catches invalid_grant
  // before the user attempts an upload).
  const verifyTokens = async () => {
    setTokenValidity('checking');
    setTokenValidityReason('');
    // 1. Read any cached tokens from localStorage.
    let storedTokens = null;
    try {
      const raw = localStorage.getItem('youtube_tokens');
      if (raw) storedTokens = JSON.parse(raw);
    } catch {}
    // 2. If no tokens yet but we have an unexchanged auth code, exchange it.
    //    This is the normal post-OAuth state: callback stored the code but
    //    nothing has called /exchangeCode yet.
    let exchangeFailed = false;
    if (!storedTokens?.access_token && !storedTokens?.refresh_token) {
      const hasCode = !!localStorage.getItem('youtube_auth_code');
      if (hasCode) {
        addDebugLog('No stored tokens — exchanging auth code for tokens before verification…', 'info');
        const exchanged = await getTokens();
        if (exchanged?.access_token || exchanged?.refresh_token) {
          storedTokens = exchanged;
        } else {
          exchangeFailed = true;
        }
      }
    }
    if (exchangeFailed) {
      setTokenValidity('invalid');
      setTokenValidityReason('exchange_failed');
      addDebugLog('Token exchange failed — auth code was rejected.', 'error');
      return false;
    }
    try {
      const res = await fetch(`${apiBaseURL()}/youtube/validateTokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tokens: storedTokens || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.valid) {
        setTokenValidity('valid');
        setTokenValidityReason('');
        return true;
      }
      setTokenValidity('invalid');
      setTokenValidityReason(data?.reason || 'unknown');
      addDebugLog(`Token verification failed: ${data?.reason || 'unknown'}`, 'warn');
      return false;
    } catch (err) {
      // Network failure — don't lock the user out, but flag as unknown.
      setTokenValidity('unknown');
      setTokenValidityReason(err?.message || 'network_error');
      addDebugLog(`Token verification network error: ${err?.message}`, 'warn');
      return false;
    }
  };

  // Mount: read localStorage, check server, fetch auth URL, validate tokens
  useEffect(() => {
    const status = refreshLocalAuthStatus();
    checkAuthStatus();
    getYouTubeAuthUrl();
    // Only verify if we actually have something to verify
    if (status.exists) {
      verifyTokens();
    } else {
      setTokenValidity('unknown');
    }
  }, []);

  // Re-verify when the server confirms a session is authenticated but we
  // haven't validated yet (e.g., session cookie present without localStorage).
  useEffect(() => {
    if (isAuthenticated && tokenValidity === 'unknown') verifyTokens();
  }, [isAuthenticated]);

  // Listen for the OAuth-callback tab to publish a fresh auth code. When it
  // does, refresh local state and re-verify so this tab updates without a reload.
  useEffect(() => {
    const onStorage = (e) => {
      if (!e || e.storageArea !== window.localStorage) return;
      if (e.key === 'youtube_auth_code' || e.key === 'youtube_tokens') {
        // A sibling tab updated YouTube credentials — refresh and re-validate.
        const status = refreshLocalAuthStatus();
        addDebugLog(`Detected auth update from another tab (${e.key}) — re-verifying…`, 'info');
        if (status.exists || e.key === 'youtube_tokens') {
          verifyTokens();
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose verifyTokens via ref so the upload flow can re-check on demand
  useEffect(() => {
    if (getTokensRef && getTokensRef.current) {
      getTokensRef.current.verifyTokens = verifyTokens;
    }
  });

  // Notify parent when auth state changes
  useEffect(() => {
    if (onAuthStateChange) {
      onAuthStateChange({ isAuthenticated, youtubeAuthStatus, canAuth, tokenValidity, tokenValidityReason });
    }
  }, [isAuthenticated, youtubeAuthStatus.exists, canAuth, tokenValidity, tokenValidityReason]);

  // ---------- COMPACT MODE ----------
  if (compact) {
    const textColor = darkMode ? '#ffffff' : '#000000';
    const signedInColor = (blackTextOnWhite || darkMode) ? textColor : '#155724';
    const notSignedInColor = (blackTextOnWhite || darkMode) ? textColor : '#721c24';
    const errorColor = (blackTextOnWhite || darkMode) ? textColor : '#721c24';
    const reasonLabel = (() => {
      const r = (tokenValidityReason || '').toLowerCase();
      if (r.includes('invalid_grant')) return 'Your YouTube sign-in expired or was revoked.';
      if (r.includes('exchange_failed')) return 'The OAuth code returned by Google could not be exchanged for tokens. The code may have already been used or expired.';
      if (r.includes('no_tokens')) return 'Your sign-in did not produce any usable tokens. This usually means the OAuth code expired before exchange — please sign in again.';
      if (r.includes('oauth_client')) return 'YouTube OAuth is not configured on the server.';
      if (r.includes('network')) return 'Could not reach the server to verify your YouTube sign-in.';
      if (tokenValidityReason) return `YouTube sign-in problem: ${tokenValidityReason}`;
      return '';
    })();

    // Show the expired/invalid state when we have local auth but verification failed
    const showInvalidBanner = hasLocalAuth && tokenValidity === 'invalid';
    const isChecking = hasLocalAuth && tokenValidity === 'checking';

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 14, color: textColor }}>
        {canAuth ? (
          <>
            <span style={{ color: signedInColor, fontWeight: 'bold' }}>✅ YouTube signed in (verified)</span>
            <button
              onClick={clearAuth}
              disabled={clearAuthLoading}
              style={{
                padding: '4px 10px', fontSize: 12, background: clearAuthLoading ? '#6c757d' : '#dc3545',
                color: 'white', border: 'none', borderRadius: 4, cursor: clearAuthLoading ? 'not-allowed' : 'pointer'
              }}
            >
              {clearAuthLoading ? 'Clearing...' : 'Clear YouTube Auth'}
            </button>
          </>
        ) : isChecking ? (
          <>
            <span style={{ color: textColor }}>⏳ Verifying YouTube sign-in…</span>
          </>
        ) : showInvalidBanner ? (
          <div style={{
            width: '100%',
            display: 'flex', flexDirection: 'column', gap: 8,
            padding: '10px 12px',
            background: darkMode ? 'rgba(220,53,69,0.15)' : '#fff5f5',
            border: `1px solid ${darkMode ? '#b14b56' : '#feb2b2'}`,
            borderRadius: 6, color: textColor,
          }}>
            <div style={{ fontWeight: 700, color: darkMode ? '#fc8181' : '#c53030' }}>
              ⚠️ YouTube sign-in is invalid — uploads will fail
            </div>
            <div style={{ fontSize: 13 }}>
              {reasonLabel || 'Your stored YouTube credentials are no longer valid.'} Please sign in again to continue.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={handleSignIn}
                disabled={authUrlLoading || !authUrl}
                style={{
                  padding: '6px 14px', fontSize: 13, background: authUrlLoading ? '#6c757d' : '#007bff',
                  color: 'white', border: 'none', borderRadius: 4, cursor: authUrlLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold',
                }}
              >
                {authUrlLoading ? 'Loading…' : 'Sign in to YouTube again'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <span style={{ color: notSignedInColor }}>Not signed in to YouTube</span>
            <button
              onClick={handleSignIn}
              disabled={authUrlLoading || !authUrl}
              style={{
                padding: '6px 14px', fontSize: 13, background: authUrlLoading ? '#6c757d' : '#007bff',
                color: 'white', border: 'none', borderRadius: 4, cursor: authUrlLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold'
              }}
            >
              {authUrlLoading ? 'Loading...' : 'Sign in with YouTube'}
            </button>
          </>
        )}
        {error && (
          <span style={{ color: errorColor, fontFamily: 'monospace', fontSize: 12 }}>{error}</span>
        )}
        {showDebugLog && debugLog.length > 0 && (
          <div style={{ width: '100%', marginTop: 8 }}>
            <div style={{
              background: '#1e1e1e', borderRadius: 4, padding: '8px', fontFamily: 'monospace',
              fontSize: 11, maxHeight: 150, overflowY: 'auto'
            }}>
              {debugLog.map((entry, i) => (
                <div key={i} style={{
                  color: entry.type === 'error' ? '#ff6b6b' : entry.type === 'warn' ? '#ffd43b' : '#a8d8ea',
                  marginBottom: 2, lineHeight: 1.4, wordBreak: 'break-word'
                }}>
                  <span style={{ color: '#888', marginRight: 6 }}>[{entry.time}]</span>
                  <span style={{
                    color: entry.type === 'error' ? '#ff6b6b' : entry.type === 'warn' ? '#ffd43b' : '#69db7c',
                    marginRight: 6, textTransform: 'uppercase', fontSize: 9
                  }}>{entry.type}</span>
                  {entry.msg}
                </div>
              ))}
            </div>
            <button onClick={() => setDebugLog([])} style={{ fontSize: 11, padding: '2px 6px', marginTop: 4, cursor: 'pointer' }}>
              Clear log
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------- FULL MODE ----------
  return (
    <div>
      {/* LocalStorage Auth Status */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 16 }}>Local Storage Auth Status</h2>
        {youtubeAuthStatus.exists ? (
          <div style={{ background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 6, padding: '16px', marginBottom: 16 }}>
            <span style={{ color: '#155724', fontWeight: 'bold' }}>✅ Auth Code Stored</span>
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
                  padding: '8px 16px', background: clearAuthLoading ? '#6c757d' : '#dc3545',
                  color: 'white', border: 'none', borderRadius: 4, cursor: clearAuthLoading ? 'not-allowed' : 'pointer', fontSize: 14
                }}
              >
                {clearAuthLoading ? 'Clearing...' : 'Clear YouTube Auth'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ background: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: 6, padding: '16px', marginBottom: 16 }}>
            <span style={{ color: '#721c24', fontWeight: 'bold' }}>❌ No auth code stored</span>
          </div>
        )}
      </div>

      {/* Sign In Button */}
      {!youtubeAuthStatus.exists && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ marginBottom: 16 }}>Sign In</h2>
          <button
            onClick={handleSignIn}
            disabled={authUrlLoading || !authUrl || authUrl.startsWith('Error')}
            style={{
              padding: '12px 24px', fontSize: 16,
              background: authUrlLoading ? '#6c757d' : '#007bff',
              color: 'white', border: 'none', borderRadius: 6,
              cursor: authUrlLoading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold', transition: 'background 0.2s'
            }}
            onMouseOver={e => { if (!authUrlLoading && authUrl) e.currentTarget.style.background = '#0056b3'; }}
            onMouseOut={e => { if (!authUrlLoading && authUrl) e.currentTarget.style.background = '#007bff'; }}
          >
            {authUrlLoading ? 'Loading...' : 'Sign in with YouTube'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: 6, padding: '16px', marginBottom: 24 }}>
          <span style={{ color: '#721c24', fontWeight: 'bold' }}>Error: </span>
          <span style={{ color: '#721c24', fontFamily: 'monospace', fontSize: 13 }}>{error}</span>
        </div>
      )}

      {/* Debug Log */}
      {showDebugLog && debugLog.length > 0 && (
        <div style={{ marginTop: 16, marginBottom: 8 }}>
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
  );
}

export default forwardRef(YouTubeAuth);
