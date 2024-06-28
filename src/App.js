import React, { useState } from 'react';
import logo from './logo.svg';
import './App.css';

function App() {
  const [data, setData] = useState('');
  const [error, setError] = useState('');

  const fetchData = async () => {
    console.log('fetching data..')
    try {
      const response = await fetch('http://jermasearch.com:3030/db/getCreds'); 
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.text(); // Adjust this if your server responds with JSON or another format
      setData(result);
      setError(''); // Clear any previous errors
    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error.message);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          MRRBARKERBAR.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
        <button onClick={fetchData}>Fetch Data</button>
        <div>
          {data && <p>Server Response: {data}</p>}
          {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        </div>
      </header>
    </div>
  );
}

export default App;
