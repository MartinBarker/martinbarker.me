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

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={ <Sidebar pageTitle="Martin Barker"><Home/></Sidebar> } />
        <Route path="/tagger" element={ <Sidebar pageTitle="Tagger.site" pageSubTitle="Generate timestamped tracklists for audio files" ><Tagger /></Sidebar> } />
        <Route path="/jermasearch/search" element={ <Sidebar><JermaSearch /></Sidebar> } />
        <Route path="/jermasearch" element={ <Sidebar><JermaSearch /></Sidebar> } />
      </Routes>
    </Router>
  );
}

export default App;
