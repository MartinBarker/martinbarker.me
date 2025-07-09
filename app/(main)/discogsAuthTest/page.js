'use client';
import React, { useState } from 'react';

export default function DiscogsAuthTest() {
  const [authUrl, setAuthUrl] = useState('');

  // DEBUG_fetchDiscogsAuthUrl: fetches the Discogs auth URL from backend
  const DEBUG_fetchDiscogsAuthUrl = async () => {
    try {
      const res = await fetch('/internal-api/DEBUG_discogsAuthUrl');
      const data = await res.json();
      setAuthUrl(data.url || '');
    } catch (err) {
      setAuthUrl('Error fetching URL');
    }
  };

  return (
    <div style={{ padding: 32 }}>
      <h2>Discogs Auth Test (DEBUG)</h2>
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
