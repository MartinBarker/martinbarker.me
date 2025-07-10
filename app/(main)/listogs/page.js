'use client';
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import io from 'socket.io-client';

function DiscogsAuthTestPageInner() {
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
  const getDiscogsURL = async () => {
    try {
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

  useEffect(() => {
    // Connect to socket.io server
    const sock = io(
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3030'
        : 'https://www.jermasearch.com/internal-api/',
      { withCredentials: true }
    );
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
      //console.log('[sessionLog]', msg);            
      setLogLines(prev => [...prev, msg]);      
    });

    // Listen for session results
    sock.on('sessionResults', (result) => {
      //console.log('[sessionResults]', result);
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

    const listMatch = value.match(/discogs\.com\/lists\/.*-(\d+)/);
    if (listMatch && listMatch[1]) {
      setExtractedId(listMatch[1]);
      setSelectedType('list');
      return;
    }
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
    discogsApiQuery(selectedType, extractedId);
  };

  return (
    <div >

      {/* --- Discogs URL Submit Form --- */}
      <div style={{ marginBottom: 24, padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
        <h3>Discogs URL Submit Form</h3>
        {/* Removed Artist/Label/List radio selection */}
        {/* <div style={{ marginBottom: 8 }}>
          ...radio buttons...
        </div> */}
        <input
          type="text"
          value={discogsInput}
          onChange={e => handleInputChange(e.target.value)}
          placeholder="Enter Discogs URL or ID"
          style={{ width: '90%', padding: 8, marginBottom: 8, fontSize: 16 }}
        />
        <button
          onClick={handleSearchClick}
          style={{ padding: '8px 16px', fontSize: 16, }}
          disabled={!extractedId || !selectedType}
        >
          Submit
        </button>
        {extractedId && (
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Detected ID: <b>{extractedId}</b> {selectedType ? `(Type: ${selectedType})` : ''}
          </div>
        )}
        {inputError && <div style={{ color: 'red', marginTop: 8 }}>{inputError}</div>}
        {discogsResponse && <pre style={{ color: 'green', marginTop: 8 }}>{discogsResponse}</pre>}
      </div>

      {/* Discogs Auth Status UI */}
      <div style={{ marginBottom: 24 }}>
        <strong>Discogs Auth Status:</strong>{' '}
        {discogsAuthStatus.exists ? (
          <span style={{ color: 'green' }}>
            Yes
            <pre style={{ background: '#222', color: '#0f0', padding: 8, marginTop: 8 }}>
              {`oauth_token   = ${discogsAuthStatus.token}
oauth_verifier = ${discogsAuthStatus.verifier}
set_time      = ${discogsAuthStatus.setTime ? formatDate(discogsAuthStatus.setTime) : 'unknown'}
expires_at    = ${discogsAuthStatus.expiresAt ? formatDate(discogsAuthStatus.expiresAt) : 'unknown'}`}
            </pre>
          </span>
        ) : (
          <span style={{ color: 'red' }}>No</span>
        )}
        {/* Add clear button */}
        <button
          onClick={clearDiscogsAuth}
          style={{ marginLeft: 16, padding: '4px 12px', fontSize: 14 }}
          disabled={!discogsAuthStatus.exists}
        >
          Clear Discogs Auth
        </button>
      </div>

      {/* Socket.io log output */}
      <div style={{ marginTop: 32 }}>
        <h3>Socket.io Session Log Output</h3>
        <pre style={{ background: '#111', color: '#0ff', padding: 8, minHeight: 80, maxHeight: 200, overflowY: 'auto' }}>
          {logLines.length === 0 ? 'No logs yet.' : logLines.join('\n')}
        </pre>
      </div>

      {/* New button for test discogs auth request */}
      <button
        onClick={() => discogsApiQuery()}
        style={{ padding: 8, fontSize: 16, marginBottom: 16 }}
        disabled={!discogsAuthStatus.exists}
      >
        make test discogs auth request
      </button>
      {testDiscogsAuthResult && (
        <pre style={{ background: '#222', color: '#fff', padding: 8, marginTop: 8 }}>
          {JSON.stringify(testDiscogsAuthResult, null, 2)}
        </pre>
      )}

      <button onClick={getDiscogsURL} style={{ padding: 8, fontSize: 16 }}>
        Get Discogs Auth URL
      </button>

      {authUrl && (
        <div style={{ marginTop: 24 }}>
          <a href={authUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'blue', fontWeight: 'bold' }}>
            {authUrl}
          </a>
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
