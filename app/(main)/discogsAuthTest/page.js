'use client';
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

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
  const DEBUG_fetchDiscogsAuthUrl = async () => {
    try {
      console.log('💚 DEBUG_fetchDiscogsAuthUrl()');
      const apiBaseURL =
        process.env.NODE_ENV === 'development'
          ? 'http://localhost:3030'
          : 'https://www.jermasearch.com/internal-api';

      const res = await fetch(`${apiBaseURL}/listogs/discogs/getURL`);
      const data = await res.json();
      setAuthUrl(data.url || '');
    } catch (err) {
      setAuthUrl('💚 Error fetching URL');
    }
  };

  // Helper to format expiry date
  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString();
  }

  const [testDiscogsAuthResult, setTestDiscogsAuthResult] = useState(null);

  // Handler for test discogs auth request (refactored for style)
  const handleTestDiscogsAuth = async () => {
    try {
      console.log('💚 handleTestDiscogsAuth()');
      const apiBaseURL =
        process.env.NODE_ENV === 'development'
          ? 'http://localhost:3030'
          : 'https://www.jermasearch.com/internal-api';

      // Example values; you can make these dynamic if needed
      const discogsType = 'artist';
      const discogsId = '542436';
      const oauthToken = discogsAuthStatus.token;
      const oauthVerifier = discogsAuthStatus.verifier;

      const requestUrl = `${apiBaseURL}/discogs/api`;
      console.log('💚 requestUrl=', requestUrl);

      const res = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discogsType,
          discogsId,
          oauthToken,
          oauthVerifier
        })
      });

      const data = await res.json();
      console.log('💚 response = ', data);
      setTestDiscogsAuthResult(data);
    } catch (err) {
      setTestDiscogsAuthResult({ error: err.message });
    }
  };

  return (
    <div style={{ padding: 32 }}>
      <h2>Discogs Auth Test (DEBUG)</h2>

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

      {/* New button for test discogs auth request */}
      <button
        onClick={handleTestDiscogsAuth}
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

      <button onClick={DEBUG_fetchDiscogsAuthUrl} style={{ padding: 8, fontSize: 16 }}>
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
