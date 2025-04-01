import React, { useState } from 'react';
import axios from 'axios';

const YouTube = () => {
  const [authUrl, setAuthUrl] = useState('');
  const [callbackCode, setCallbackCode] = useState('');
  const [response, setResponse] = useState(null);

  const getAuthUrl = async () => {
    try {
      const baseUrl = window.location.hostname === 'localhost' 
        ? 'http://localhost:3030' 
        : 'http://jermasearch.com';
      const res = await axios.get(`${baseUrl}/getYtUrl?port=3030`);
      setAuthUrl(res.data.url);
    } catch (error) {
      console.error('Error fetching auth URL:', error);
    }
  };

  const submitCallbackCode = async () => {
    try {
      const res = await axios.get(`/getOauth2Client?token=${callbackCode}`);
      setResponse(res.data);
    } catch (error) {
      console.error('Error submitting callback code:', error);
    }
  };

  return (
    <div>
      <h1>YouTube OAuth</h1>
      <button onClick={getAuthUrl}>Get Auth URL</button>
      {authUrl && (
        <div>
          <p>Auth URL: <a href={authUrl} target="_blank" rel="noopener noreferrer">{authUrl}</a></p>
        </div>
      )}
      <div>
        <input 
          type="text" 
          placeholder="Enter callback code" 
          value={callbackCode} 
          onChange={(e) => setCallbackCode(e.target.value)} 
        />
        <button onClick={submitCallbackCode}>Submit Callback Code</button>
      </div>
      {response && (
        <div>
          <h2>Response</h2>
          <pre>{JSON.stringify(response, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default YouTube;
