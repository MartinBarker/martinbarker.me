'use client';
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function YouTubeAuthPageInner() {
  const [authUrl, setAuthUrl] = useState('');
  const [authUrlLoading, setAuthUrlLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [error, setError] = useState('');
  
  const params = useSearchParams();
  const router = useRouter();
  const authCode = params.get('code');
  const scope = params.get('scope');

  // Helper: 1 year in ms (simulate expiry)
  const YOUTUBE_AUTH_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

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
      }
    } catch (err) {
      console.error('Error checking auth status:', err);
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
        setError('');
        // Clear localStorage
        localStorage.removeItem('youtube_auth_code');
        localStorage.removeItem('youtube_auth_scope');
        localStorage.removeItem('youtube_auth_set_time');
        setYoutubeAuthStatus({
          exists: false,
          code: null,
          scope: null,
          setTime: null,
          expiresAt: null
        });
        // Refresh the auth URL
        getYouTubeAuthUrl();
      } else {
        setError('Failed to clear authentication');
      }
    } catch (err) {
      console.error('Error clearing auth:', err);
      setError('Failed to clear authentication');
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

      {/* Authentication Status */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 16 }}>Server Authentication Status</h2>
        {isAuthenticated ? (
          <div style={{
            background: '#d4edda',
            border: '1px solid #c3e6cb',
            borderRadius: 6,
            padding: '16px',
            marginBottom: 16
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: '#155724', fontWeight: 'bold' }}>✅ Signed In</span>
              {userInfo && (
                <span style={{ color: '#155724' }}>
                  as {userInfo.name || userInfo.email || 'User'}
                </span>
              )}
            </div>
            <button
              onClick={clearAuth}
              style={{
                marginTop: 12,
                padding: '8px 16px',
                background: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 14
              }}
            >
              Clear Authentication
            </button>
          </div>
        ) : (
          <div style={{
            background: '#f8d7da',
            border: '1px solid #f5c6cb',
            borderRadius: 6,
            padding: '16px',
            marginBottom: 16
          }}>
            <span style={{ color: '#721c24', fontWeight: 'bold' }}>❌ Not signed in</span>
          </div>
        )}
      </div>

      {/* Sign In Button */}
      {!isAuthenticated && (
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
          <span style={{ color: '#721c24' }}>Error: {error}</span>
        </div>
      )}

      {/* Features Section */}
      {isAuthenticated && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 16 }}>Available Features</h2>
          <div style={{
            background: '#e7f3ff',
            border: '1px solid #b3d9ff',
            borderRadius: 6,
            padding: '16px'
          }}>
            <p style={{ margin: 0, color: '#004085' }}>
              You are now authenticated with YouTube! You can now use YouTube API features
              such as creating playlists, managing videos, and accessing your channel data.
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
