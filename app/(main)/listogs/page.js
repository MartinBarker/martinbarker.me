'use client';
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import io from 'socket.io-client';
import VideoTable from './Table';

// Helper to flatten videoData object to array
function flattenVideoData(videoData) {
  const rows = [];
  if (!videoData) return rows;
  Object.values(videoData).forEach(releaseObj => {
    Object.values(releaseObj).forEach(video => {
      rows.push(video);
    });
  });
  return rows;
}

// Helper to get all video IDs from results
function getAllVideoIds(videoData) {
  const ids = [];
  if (!videoData) return ids;
  Object.values(videoData).forEach(releaseObj => {
    Object.values(releaseObj).forEach(video => {
      if (video.videoId) ids.push(video.videoId);
    });
  });
  return ids;
}

function DiscogsAuthTestPageInner() {
  const [results, setResults] = useState([]);
  const params = useSearchParams();
  const router = useRouter();
  const oauthToken = params.get('oauth_token');
  const oauthVerifier = params.get('oauth_verifier');

  // Helper: 1 year in ms (simulate expiry)
  const DISCOGS_AUTH_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

  /** Persist tokens in localStorage, along with set time */
  const storeDiscogsTokens = (token, verifier) => {
    try {
      localStorage.setItem('discogs_oauth_token', token);
      localStorage.setItem('discogs_oauth_verifier', verifier);
      localStorage.setItem('discogs_oauth_set_time', Date.now().toString());
      console.log('✅ Tokens saved to localStorage');
    } catch (err) {
      console.error('❌ Failed to save tokens:', err);
    }
  };

  // On mount: if oauth_token and oauth_verifier exist, store and redirect
  useEffect(() => {
    if (oauthToken && oauthVerifier) {
      storeDiscogsTokens(oauthToken, oauthVerifier);
      // Redirect to /listogs without query params
      router.replace('/listogs');
    }
    // Only run on mount or when params change
  }, [oauthToken, oauthVerifier, router]);

  // Discogs Auth Status state
  const [discogsAuthStatus, setDiscogsAuthStatus] = useState({
    exists: false,
    token: null,
    verifier: null,
    setTime: null,
    expiresAt: null
  });

  // Check localStorage for Discogs auth tokens and expiry
  useEffect(() => {
    const token = localStorage.getItem('discogs_oauth_token');
    const verifier = localStorage.getItem('discogs_oauth_verifier');
    const setTimeStr = localStorage.getItem('discogs_oauth_set_time');
    let setTime = setTimeStr ? parseInt(setTimeStr, 10) : null;
    let expiresAt = setTime ? setTime + DISCOGS_AUTH_EXPIRY_MS : null;
    setDiscogsAuthStatus({
      exists: !!(token && verifier),
      token,
      verifier,
      setTime,
      expiresAt
    });
  }, []);

  // Add a function to clear Discogs auth from localStorage
  const clearDiscogsAuth = () => {
    localStorage.removeItem('discogs_oauth_token');
    localStorage.removeItem('discogs_oauth_verifier');
    localStorage.removeItem('discogs_oauth_set_time');
    setDiscogsAuthStatus({
      exists: false,
      token: null,
      verifier: null,
      setTime: null,
      expiresAt: null
    });
  };

  const [authUrl, setAuthUrl] = useState('');
  const [authUrlLoading, setAuthUrlLoading] = useState(true); // <-- Add loading state
  const getDiscogsURL = async () => {
    try {
      setAuthUrlLoading(true); // <-- Set loading true before fetch
      const apiBaseURL =
        process.env.NODE_ENV === 'development'
          ? 'http://localhost:3030'
          : 'https://www.jermasearch.com/internal-api';

      var queryUrl = `${apiBaseURL}/listogs/discogs/getURL`;
      console.log('querying for discogs auth URL:', queryUrl);
      const res = await fetch(queryUrl);
      const data = await res.json();
      setAuthUrl(data.url || '');
    } catch (err) {
      console.log('error fetching url:', err);
      setAuthUrl(`Error fetching URL: ${err.message}`);
    } finally {
      setAuthUrlLoading(false); // <-- Set loading false after fetch
    }
  };

  // Call getDiscogsURL on initial mount
  useEffect(() => {
    getDiscogsURL();
  }, []);

  // Helper to format expiry date
  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString();
  }

  const [testDiscogsAuthResult, setTestDiscogsAuthResult] = useState(null);

  // Socket.io log state
  const [logLines, setLogLines] = useState([]);
  const [socket, setSocket] = useState(null);
  const [socketId, setSocketId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);

  // Ref for auto-scroll
  const logRef = React.useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Track last non-zero progress for rate limit display
  const lastProgressRef = React.useRef({
    currentIndex: 0,
    total: 0,
    currentVideoIndex: 0,
    totalVideoPages: 0,
    videos: 0
  });

  // Update lastProgressRef when sessionStatus.progress changes and not waiting for rate limit
  useEffect(() => {
    if (sessionStatus && sessionStatus.progress) {
      const { currentIndex, total, currentVideoIndex, totalVideoPages, videos } = sessionStatus.progress;
      // Only update if not waiting for rate limit and values are > 0
      if (
        sessionStatus.status !== 'Waiting for rate limit' &&
        ((currentIndex > 0 && total > 0) || (currentVideoIndex > 0 && totalVideoPages > 0))
      ) {
        lastProgressRef.current = {
          currentIndex: currentIndex || lastProgressRef.current.currentIndex,
          total: total || lastProgressRef.current.total,
          currentVideoIndex: currentVideoIndex || lastProgressRef.current.currentVideoIndex,
          totalVideoPages: totalVideoPages || lastProgressRef.current.totalVideoPages,
          videos: typeof videos !== 'undefined' ? videos : lastProgressRef.current.videos
        };
      }
      // Always update videos count if present
      if (typeof videos !== 'undefined') {
        lastProgressRef.current.videos = videos;
      }
    }
  }, [sessionStatus]);

  // Auto-scroll progress log to bottom when logLines change, unless user scrolled up
  useEffect(() => {
    if (logRef.current && autoScroll) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines, autoScroll]);

  // Handler to detect user scroll and disable auto-scroll if not at bottom
  const handleLogScroll = () => {
    if (logRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logRef.current;
      // If user is not at the bottom, disable auto-scroll
      if (scrollTop + clientHeight < scrollHeight - 2) {
        setAutoScroll(false);
      } else {
        setAutoScroll(true);
      }
    }
  };

  useEffect(() => {
    // Connect to socket.io server
    const isDev = process.env.NODE_ENV === 'development';
    const socketUrl = isDev
      ? 'http://localhost:3030'
      : 'https://www.jermasearch.com';
    const socketPath = isDev
      ? '/socket.io'
      : '/internal-api/socket.io';

    console.log('[Socket.IO] Connecting to', socketUrl, 'with path', socketPath);

    const sock = io(socketUrl, {
      withCredentials: true,
      path: socketPath
    });
    setSocket(sock);

    sock.on('connect', () => {
      //console.log('[Socket.IO] Connected:', sock.id);
      setSocketId(sock.id);
    });

    sock.on('connect_error', (err) => {
      console.error('[Socket.IO] connect_error →', err.message);
    });

    // Listen for session log events (per-session)
    sock.on('sessionLog', (msg) => {
      setLogLines(prev => [...prev, msg]);
    });

    // Listen for session results
    sock.on('sessionResults', (result) => {
      //setResults(result);
    });

    // Listen for videos 
    sock.on('sessionVideos', (videos) => {
      console.log('sessionVideos = ', videos);
      // --- Remove duplicate videoIds ---
      let uniqueVideos;
      if (Array.isArray(videos)) {
        const seen = new Set();
        uniqueVideos = videos.filter(v => {
          if (!v.videoId) return true;
          if (seen.has(v.videoId)) return false;
          seen.add(v.videoId);
          return true;
        });
      } else if (typeof videos === 'object' && videos !== null) {
        // If videos is an object of releases, deduplicate within all releases
        const seen = new Set();
        uniqueVideos = {};
        Object.entries(videos).forEach(([releaseKey, releaseVideos]) => {
          if (Array.isArray(releaseVideos)) {
            uniqueVideos[releaseKey] = releaseVideos.filter(v => {
              if (!v.videoId) return true;
              if (seen.has(v.videoId)) return false;
              seen.add(v.videoId);
              return true;
            });
          } else {
            // If not array, just assign
            uniqueVideos[releaseKey] = releaseVideos;
          }
        });
      } else {
        uniqueVideos = videos;
      }
      setResults(prev => {
        // If prev is empty, just set uniqueVideos
        if (!prev || prev.length === 0) return uniqueVideos;
        // Merge new videos into prev (append releases)
        if (Array.isArray(uniqueVideos)) {
          // Merge and deduplicate with previous results
          const seen = new Set();
          const allVideos = [...prev, ...uniqueVideos].filter(v => {
            if (!v.videoId) return true;
            if (seen.has(v.videoId)) return false;
            seen.add(v.videoId);
            return true;
          });
          return allVideos;
        }
        // If object, merge keys (assuming releases as keys)
        if (typeof uniqueVideos === 'object' && uniqueVideos !== null) {
          // Merge releases, deduplicate videoIds across all releases
          const merged = { ...prev, ...uniqueVideos };
          const seen = new Set();
          Object.keys(merged).forEach(releaseKey => {
            if (Array.isArray(merged[releaseKey])) {
              merged[releaseKey] = merged[releaseKey].filter(v => {
                if (!v.videoId) return true;
                if (seen.has(v.videoId)) return false;
                seen.add(v.videoId);
                return true;
              });
            }
          });
          return merged;
        }
        return uniqueVideos;
      });
    });

    // Listen for status updates 
    sock.on('sessionStatus', (status) => {
      setSessionStatus(status); // <-- Save status to state
      console.log('sessionStatus = ', status);
    });

    return () => {
      sock.disconnect();
    };
  }, []);

  // Query /discogs/api endpoint with Discogs type, discogs id, oauthToken, and socketId
  const discogsApiQuery = async (discogsType, discogsId) => {
    try {
      setLogLines([]); // Clear logs before each request
      const apiBaseURL =
        process.env.NODE_ENV === 'development'
          ? 'http://localhost:3030'
          : 'https://www.jermasearch.com/internal-api';

      if (!discogsType || !discogsId) {
        console.error('discogsApiQuery() - discogsType or discogsId is missing');
        return;
      }
      const oauthToken = discogsAuthStatus.token;
      const oauthVerifier = discogsAuthStatus.verifier;
      if (!oauthToken || !oauthVerifier) {
        console.error('discogsApiQuery() - Missing oauthToken or oauthVerifier');
        setTestDiscogsAuthResult({ error: 'Missing oauthToken or oauthVerifier' });
        return;
      }

      const requestUrl = `${apiBaseURL}/discogs/api`;
      console.log('Calling requestUrl for discogs api query =', requestUrl);

      const res = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          discogsType,
          discogsId,
          oauthToken,
          oauthVerifier,
          socketId
        })
      });

      const data = await res.json();
      console.log('discogsapi response = ', data);
      setTestDiscogsAuthResult(data);
    } catch (err) {
      console.log('discogsapi💚 Error :', err);
      setTestDiscogsAuthResult({ error: err.message });
    }
  };

  // --- Discogs URL Submit Form State ---
  const [discogsInput, setDiscogsInput] = useState('');
  const [extractedId, setExtractedId] = useState('');
  const [selectedType, setSelectedType] = useState(null);
  const [inputError, setInputError] = useState('');
  const [discogsResponse, setDiscogsResponse] = useState('');

  // Discogs input change handler (copied logic)
  const handleInputChange = (value) => {
    setDiscogsInput(value);
    setInputError('');
    setExtractedId('');
    setSelectedType(null);

    // Try matching URLs first
    const artistMatch = value.match(/discogs\.com\/artist\/(\d+)/);
    if (artistMatch && artistMatch[1]) {
      setExtractedId(artistMatch[1]);
      setSelectedType('artist');
      return;
    }

    const labelMatch = value.match(/discogs\.com\/label\/(\d+)/);
    if (labelMatch && labelMatch[1]) {
      setExtractedId(labelMatch[1]);
      setSelectedType('label');
      return;
    }

    const releaseMatch = value.match(/discogs\.com\/release\/(\d+)/);
    if (releaseMatch && releaseMatch[1]) {
      setExtractedId(releaseMatch[1]);
      setSelectedType('release');
      return;
    }

    // Improved list URL detection: match /lists/.../<id> at end of URL
    const listMatch = value.match(/discogs\.com\/lists\/[^\/]+\/(\d+)/);
    if (listMatch && listMatch[1]) {
      setExtractedId(listMatch[1]);
      setSelectedType('list');
      return;
    }
    // Also match /lists/<id> (simple form)
    const listMatchSimple = value.match(/discogs\.com\/lists\/(\d+)/);
    if (listMatchSimple && listMatchSimple[1]) {
      setExtractedId(listMatchSimple[1]);
      setSelectedType('list');
      return;
    }

    // Try matching bracket format
    const bracketArtistMatch = value.match(/^\[a(\d+)\]$/);
    if (bracketArtistMatch && bracketArtistMatch[1]) {
      setExtractedId(bracketArtistMatch[1]);
      setSelectedType('artist');
      return;
    }

    const bracketLabelMatch = value.match(/^\[l(\d+)\]$/);
    if (bracketLabelMatch && bracketLabelMatch[1]) {
      setExtractedId(bracketLabelMatch[1]);
      setSelectedType('label');
      return;
    }

    // Try matching release bracket format
    const bracketReleaseMatch = value.match(/^\[r(\d+)\]$/);
    if (bracketReleaseMatch && bracketReleaseMatch[1]) {
      setExtractedId(bracketReleaseMatch[1]);
      setSelectedType('release');
      return;
    }

    // If only numbers, assume it *could* be an ID, but don't set type yet
    if (/^\d+$/.test(value)) {
      setExtractedId(value);
      // Don't set selectedType here, let the user choose via radio buttons
    }
  };

  // Discogs search submit handler (mocked, just sets a response)
  const handleSearchClick = () => {
    if (!selectedType) {
      setInputError('Please select a type (Artist, Label, or List).');
      return;
    }
    if (!discogsInput.trim() || !extractedId) {
      setInputError(`Please enter a valid Discogs ${selectedType} URL.`);
      return;
    }
    setInputError('');
    setResults([]); // <-- Clear results on new submit
    discogsApiQuery(selectedType, extractedId);
  };

  // --- Display results ---
  const videoCount = flattenVideoData(results).length;

  // --- YouTube Playlist Links ---
  const videoIds = getAllVideoIds(results);
  const playlistLinks = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.youtube.com/watch_videos?video_ids=${batch.join(',')}`;
    playlistLinks.push(url);
  }

  // --- All video IDs as comma separated string ---
  const allVideoIdsString = videoIds.join(',');

  // --- Copy to clipboard handler ---
  const handleCopyIds = () => {
    navigator.clipboard.writeText(allVideoIdsString);
  };

  // --- ExportCSVButton component ---
  const ExportCSVButton = ({ data, fileName, headers }) => {
    const handleExport = () => {
      const generateCsvContent = (data, headers) => {
        const headerRow = headers.join(",");
        const dataRows = data
          .map((row) =>
            headers
              .map((header) => {
                let value = row[header];
                if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
                  value = `"${value.replace(/"/g, '""')}"`;
                }
                return value ?? "";
              })
              .join(",")
          )
          .join("\n");
        return `${headerRow}\n${dataRows}`;
      };

      const csvContent = generateCsvContent(data, headers);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", fileName || "videos.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };

    return (
      <button
        onClick={handleExport}
        style={{
          padding: '8px 16px',
          fontSize: 16,
          background: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          marginTop: 8
        }}
        disabled={!data || data.length === 0}
      >
        Export Table to CSV
      </button>
    );
  };

  return (
    <div >
      {/* --- Listogs Info Section --- */}
      <div style={{
        background: '#f5f7fa',
        border: '1px solid #e3e8ee',
        borderRadius: 8,
        padding: '24px 20px',
        marginBottom: 32,
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
      }}>
        <p style={{ fontSize: 17, marginBottom: 8 }}>
          <strong>Listogs</strong> is a tool for converting <a href="https://www.discogs.com/" target="_blank" rel="noopener noreferrer">Discogs</a> artist, label, or list pages into YouTube playlists.
        </p>
        <ul style={{ fontSize: 16, marginBottom: 8, paddingLeft: 22 }}>
          <li>Authenticate with Discogs to access your lists and releases.</li>
          <li>Paste a Discogs URL (artist, label, or list) and submit.</li>
          <li>Listogs will find YouTube videos for each release and generate playlists and tables.</li>
          <li>Export results to CSV or copy all YouTube video IDs for use elsewhere.</li>
        </ul>
     
      </div>
      {/* Discogs Auth Status and Button (combined in one line) */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
        {discogsAuthStatus.exists ? (
          <button
            style={{
              color: 'white',
              background: '#007bff',
              fontWeight: 'bold',
              padding: '10px 24px',
              border: 'none',
              borderRadius: 6,
              fontSize: 18,
              cursor: 'pointer',
              transition: 'background 0.2s, box-shadow 0.2s',
              boxShadow: '0 2px 8px rgba(0,0,0,0.07)'
            }}
            onClick={clearDiscogsAuth}
          >
            Clear Discogs Auth
          </button>
        ) : (
          <button
            style={{
              color: 'white',
              background: '#007bff',
              fontWeight: 'bold',
              padding: '10px 24px',
              border: 'none',
              borderRadius: 6,
              fontSize: 18,
              cursor: authUrlLoading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s, box-shadow 0.2s',
              boxShadow: '0 2px 8px rgba(0,0,0,0.07)'
            }}
            onClick={() => { if (!authUrlLoading && authUrl) window.location.href = authUrl; }}
            onMouseOver={e => {
              if (!authUrlLoading) {
                e.currentTarget.style.background = '#339dff';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,123,255,0.18)';
              }
            }}
            onMouseOut={e => {
              if (!authUrlLoading) {
                e.currentTarget.style.background = '#007bff';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)';
              }
            }}
            disabled={authUrlLoading || !authUrl || authUrl.startsWith('Error')}
          >
            {authUrlLoading
              ? 'Fetching Discogs URL...'
              : 'Authorize Discogs'}
          </button>
        )}
        <strong>Discogs Auth Status:</strong>{' '}
        {discogsAuthStatus.exists ? (
          <span style={{ color: 'green' }}>
            Signed In
          </span>
        ) : (
          <span style={{ color: 'red' }}>Not signed in</span>
        )}
      </div>

      {/* --- Discogs URL Submit Form --- */}
      <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Discogs URL Submit Form</h3>
        {/* Removed Artist/Label/List radio selection */}
        {/* <div style={{ marginBottom: 8 }}>
          ...radio buttons...
        </div> */}
        <input
          type="text"
          value={discogsInput}
          onChange={e => handleInputChange(e.target.value)}
          placeholder="Enter a Discogs URL (artist, label, release, or list)"
          style={{ width: '90%', padding: 8, marginBottom: 8, fontSize: 16 }}
          disabled={!discogsAuthStatus.exists}
        />
        <button
          onClick={handleSearchClick}
          style={{ padding: '8px 16px', fontSize: 16, }}
          disabled={!extractedId || !selectedType || !discogsAuthStatus.exists}
        >
          {(!extractedId || !selectedType || !discogsAuthStatus.exists)
            ? "Authenticate with discogs before submitting"
            : "Submit"}
        </button>
        {extractedId && (
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Detected ID: <b>{extractedId}</b> {selectedType ? `(Type: ${selectedType})` : ''}
          </div>
        )}
        {/* Show invalid URL message if input is non-empty and no type detected */}
        {discogsInput && !selectedType && (
          <div style={{ color: 'red', marginTop: 8 }}>
            Not a valid Discogs artist, label, or list URL.
          </div>
        )}
        {inputError && <div style={{ color: 'red', marginTop: 8 }}>{inputError}</div>}
        {discogsResponse && <pre style={{ color: 'green', marginTop: 8 }}>{discogsResponse}</pre>}
      </div>

      {/* Socket.io log output */}
      <div style={{  }}>
        <h3 style={{ marginTop: 0 }}>Progress:</h3>
        <textarea
          ref={logRef}
          onScroll={handleLogScroll}
          value={logLines.length === 0 ? 'Setting up socket.io..' : logLines.join('\n')}
          readOnly
          style={{
            background: '#111',
            color: '#0ff',
            padding: 8,
            minHeight: 10,
            maxHeight: 200,
            width: '100%',
            fontFamily: 'monospace',
            fontSize: 14,
            resize: 'vertical',
            overflowY: 'auto',
            borderRadius: 6,
            border: '1px solid #333'
          }}
        />
        {/* Display session status */}
        {sessionStatus && (
          <div style={{ marginTop: 12, padding: 8, background: '#222', color: '#fff', borderRadius: 6 }}>
            <strong>Status:</strong> {sessionStatus.status}
            <br />
            {sessionStatus.progress && (
              <span>
                {/* Always show progress index/total and video count, even if status is 'Waiting for rate limit' */}
                {(() => {
                  let { currentIndex, total, currentVideoIndex, totalVideoPages, videos } = sessionStatus.progress;
                  // If waiting for rate limit, use last non-zero progress
                  if (sessionStatus.status === 'Waiting for rate limit') {
                    currentIndex = lastProgressRef.current.currentIndex;
                    total = lastProgressRef.current.total;
                    currentVideoIndex = lastProgressRef.current.currentVideoIndex;
                    totalVideoPages = lastProgressRef.current.totalVideoPages;
                    videos = lastProgressRef.current.videos;
                  }
                  return (
                    <>
                      {typeof currentIndex !== 'undefined' && typeof total !== 'undefined' && total > 0 && (
                        <span>
                          Page Progress: {currentIndex} / {total}
                          <br />
                        </span>
                      )}
                      {typeof currentVideoIndex !== 'undefined' && typeof totalVideoPages !== 'undefined' && totalVideoPages > 0 && (
                        <span>
                          Analyzing Release: {currentVideoIndex} / {totalVideoPages}
                          <br />
                        </span>
                      )}
                      {typeof videos !== 'undefined' && (
                        <span>
                          Videos found: {videos}
                        </span>
                      )}
                    </>
                  );
                })()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* YouTube Playlist Links Section */}
      {playlistLinks.length > 0 && (
        <div style={{ marginTop: 32, marginBottom: 16 }}>
          <h3>YouTube Playlists:</h3>
          <ul style={{ paddingLeft: 20 }}>
            {playlistLinks.map((url, idx) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {`YouTube Playlist ${idx + 1} (${Math.min(50, videoIds.length - idx * 50)} videos)`}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Display results */}
      <div style={{ marginTop: 32 }}>
        <h3>
          {videoCount > 0 ? `Videos Table: ${videoCount} videos Found:` : 'Results:'}
        </h3>
        <VideoTable videoData={results} />
        {/* Export Table to CSV button directly under the table */}
        <div style={{ marginTop: 16 }}>
          <ExportCSVButton
            data={flattenVideoData(results)}
            fileName="videos.csv"
            headers={[
              "releaseTitle",
              "artist",
              "year",
              "title",
              "videoId",
              "fullUrl",
              "discogsUrl"
            ]}
          />
          <div style={{ fontSize: 14, color: '#555', marginTop: 8 }}>
            Exports all video rows currently loaded in the table.
          </div>
        </div>
      </div>

      {/* All YouTube Video IDs Section (bottom of page) */}
      {videoIds.length > 0 && (
        <div style={{ marginTop: 32, marginBottom: 32 }}>
          <h3>All YouTube Video IDs (comma separated):</h3>
          <textarea
            value={allVideoIdsString}
            readOnly
            rows={Math.min(6, Math.ceil(allVideoIdsString.length / 80))}
            style={{
              width: '100%',
              fontSize: 14,
              padding: 8,
              marginBottom: 8,
              resize: 'vertical'
            }}
          />
          <button
            onClick={handleCopyIds}
            style={{
              padding: '8px 16px',
              fontSize: 16,
              background: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            Copy to Clipboard
          </button>
        </div>
      )}
    </div>
  );
}

export default function DiscogsAuthTestPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DiscogsAuthTestPageInner />
    </Suspense>
  );
}