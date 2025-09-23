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
      } else {
        // If auth status check fails, assume not authenticated
        setIsAuthenticated(false);
        setUserInfo(null);
      }
    } catch (err) {
      console.error('Error checking auth status:', err);
      // On error, assume not authenticated
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
    if (clearAuthLoading) return; // Prevent multiple clicks
    
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
        // Clear all authentication state
        setIsAuthenticated(false);
        setUserInfo(null);
        
        // Clear localStorage
        localStorage.removeItem('youtube_auth_code');
        localStorage.removeItem('youtube_auth_scope');
        localStorage.removeItem('youtube_auth_set_time');
        
        // Update local auth status
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

  // Create playlist
  const createPlaylist = async () => {
    if (!playlistData.title.trim()) {
      setError('Please enter a playlist title');
      return;
    }

    setPlaylistLoading(true);
    setError('');

    try {
      const apiBaseURL = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3030'
        : 'https://www.martinbarker.me/internal-api';

      // If not server authenticated but have localStorage code, exchange code for tokens first
      if (!isAuthenticated && youtubeAuthStatus.exists && youtubeAuthStatus.code) {
        console.log('Exchanging auth code for tokens...');
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

        if (!tokenResponse.ok) {
          const tokenError = await tokenResponse.json();
          setError(tokenError.error || 'Failed to exchange auth code for tokens');
          setPlaylistLoading(false);
          return;
        }
        
        // Refresh auth status after token exchange
        await checkAuthStatus();
      }

      const response = await fetch(`${apiBaseURL}/youtube/createPlaylist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(playlistData)
      });

      if (response.ok) {
        const result = await response.json();
        setPlaylistCreated(result);
        setPlaylistData({
          title: '',
          description: '',
          privacyStatus: 'private'
        });
      } else {
        const errorData = await response.json();
        let errorMessage = 'Failed to create playlist';
        
        if (errorData.error) {
          errorMessage = errorData.error;
        }
        
        if (errorData.code) {
          errorMessage += ` (Error Code: ${errorData.code})`;
        }
        
        if (errorData.message) {
          errorMessage += ` - ${errorData.message}`;
        }
        
        if (errorData.errors && errorData.errors.length > 0) {
          const firstError = errorData.errors[0];
          if (firstError.reason) {
            errorMessage += ` (Reason: ${firstError.reason})`;
          }
        }
        
        setError(errorMessage);
      }
    } catch (err) {
      console.error('Error creating playlist:', err);
      
      let errorMessage = 'Failed to create playlist';
      
      if (err.message) {
        errorMessage = err.message;
      }
      
      if (err.code) {
        errorMessage += ` (Error Code: ${err.code})`;
      }
      
      if (err.name) {
        errorMessage += ` (Error Type: ${err.name})`;
      }
      
      setError(errorMessage);
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
            <button
              onClick={clearAuth}
              disabled={clearAuthLoading}
              style={{
                marginTop: 12,
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
          <span style={{ color: '#721c24' }}>Error: {error}</span>
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
                  fontSize: 14
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
                  resize: 'vertical'
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
