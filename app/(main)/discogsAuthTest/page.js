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
      // Redirect to /discogsAuthTest without query params
      router.replace('/discogsAuthTest');
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

    let errorCount = 0;
    const MAX_ERRORS = 5;

    sock.on('connect', () => {
      //console.log('[Socket.IO] Connected:', sock.id);
      setSocketId(sock.id);
      errorCount = 0; // reset on successful connect
    });

    sock.on('connect_error', (err) => {
      errorCount++;
      console.error('[Socket.IO] connect_error →', err.message, `(errorCount=${errorCount})`);
      if (errorCount >= MAX_ERRORS) {
        console.error(`[Socket.IO] Too many connection errors (${errorCount}), disconnecting socket and stopping retries.`);
        sock.disconnect();
      }
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
OLD
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
