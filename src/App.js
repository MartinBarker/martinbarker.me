import React, { useState } from 'react';
import logo from './logo.svg';
//import './App.css';

import JermaSearch from "./JermaSearch/JermaSearch.js"

function App() {
  
  return (
    <div>
      <JermaSearch />
      {/* 
        <div className="App">
          <header className="App-header">
            <img src={logo} className="App-logo" alt="logo" />
            <p>
              Jerma Search v1.0
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
        */}
    </div>
  );
}

export default App;
