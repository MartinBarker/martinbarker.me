'use client';
import React, { useState } from 'react';
import { useEffect } from 'react';

export default function DiscogsAuthTestPage({ testString }) {

  console.log('testString:', testString);

  // Run this effect when urlVars changes
  useEffect(() => {
      console.log('testString: ', testString);
      //console.log('urlVars:', urlVars);
  }, [testString]);

  const [authUrl, setAuthUrl] = useState('');

  // DEBUG_fetchDiscogsAuthUrl: fetches the Discogs auth URL from backend
  const DEBUG_fetchDiscogsAuthUrl = async () => {
    try {
        console.log('💚 DEBUG_fetchDiscogsAuthUrl()');
        
      var apiBaseURL = "";
      
      var isDev = process.env.NODE_ENV === 'development';
      console.log('💚 isDev=',isDev)
      if(isDev){
        apiBaseURL = 'http://localhost:3030';
      }else{
        apiBaseURL = 'https://www.jermasearch.com/internal-api';
      }
      console.log('💚 apiBaseURL=',apiBaseURL)

      var requestUrl = `${apiBaseURL}/listogs/discogs/getURL`
      console.log('💚 requestUrl=', requestUrl)

      const res = await fetch(requestUrl);
      
      const data = await res.json();
      console.log('💚 response = ',data)

      setAuthUrl(data.url || '');
    } catch (err) {
      setAuthUrl('💚 Error fetching URL');
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
