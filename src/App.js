import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route
} from "react-router-dom";

import Sidebar from "./Components/Sidebar/Sidebar.js"
import Home from "./Components/Home/Home.js"
import JermaSearch from "./Components/JermaSearch/JermaSearch.js";
import Tagger from "./Components/Tagger/Tagger.js";
import RenderTune from "./Components/RenderTune/RenderTune.js";
import Ffmpegwasm from "./Components/Ffmpegwasm/Ffmpegwasm.js";
import NotFound from "./Components/NotFound/NotFound.js";
import YouTube from "./Components/YouTube/YouTube.js";
import Discogs2Youtube from './Components/Discogs2Youtube/Discogs2Youtube';

function App() {
  const homeIconPath = "./ico/martinbarker.ico";
  const renderTuneIconPath = "./ico/rendertune.ico";

  return (
    <Router>
      <Routes>
        <Route 
          path="/" 
          element={
            <Sidebar 
              pageTitle="Martin Barker" 
              icon={homeIconPath}
            >
              <Home />
            </Sidebar>
          } 
        />
        
        <Route 
          path="/tagger" 
          element={
            <Sidebar 
              pageTitle="Tagger.site" 
              pageSubTitle="Generate timestamped tracklists for audio files" 
              icon={homeIconPath}
            >
              <Tagger />
            </Sidebar>
          } 
        />

        <Route 
          path="/jermasearch/search" 
          element={<JermaSearch />} 
        />

        <Route 
          path="/jermasearch" 
          element={<JermaSearch />} 
        />

        <Route 
          path="/rendertune/*" 
          element={
            <RenderTune 
              pageTitle="RenderTune" 
              icon={renderTuneIconPath} 
            />
          } 
        />

        <Route 
          path="/ffmpegwasm" 
          element={
            <Sidebar 
              pageTitle="FFmpeg WASM" 
              pageSubTitle={
                <>
                  In-browser video rendering using{' '}
                  <a 
                    href="https://github.com/ffmpegwasm/ffmpeg.wasm" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: 'inherit', textDecoration: 'underline' }}
                  >
                    ffmpeg.wasm
                  </a>
                </>
              }
            >
              <Ffmpegwasm />
            </Sidebar>
          } 
        />

        <Route 
          path="/youtube" 
          element={
            <Sidebar 
              pageTitle="YouTube OAuth"
              icon={homeIconPath}
            >
              <YouTube />
            </Sidebar>
          } 
        /> 

        <Route 
          path="/discogs2youtube" 
          element={
            <Sidebar 
              pageTitle="Discogs2Youtube" 
              pageSubTitle="Convert Discogs data to YouTube links"
              icon={homeIconPath}
            >
              <Discogs2Youtube />
            </Sidebar>
          } 
        />

        {/* 404 route - must be last */}
        <Route 
          path="*" 
          element={
            <Sidebar 
              pageTitle="404 Not Found"
              icon={homeIconPath}
            >
              <NotFound />
            </Sidebar>
          } 
        />
      </Routes>
    </Router>
  );
}

export default App;