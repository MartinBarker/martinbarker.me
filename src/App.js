import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route
} from "react-router-dom";

import Sidebar from "./Sidebar/Sidebar.js"
import Home from "./Home/Home.js"
import JermaSearch from "./JermaSearch/JermaSearch.js";
import Tagger from "./Tagger/Tagger.js";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={ <Sidebar><Home /></Sidebar> } />
        <Route path="/tagger" element={ <Sidebar><Tagger /></Sidebar> } />
        <Route path="/jermasearch/search" element={ <Sidebar><JermaSearch /></Sidebar> } />
        <Route path="/jermasearch" element={ <Sidebar><JermaSearch /></Sidebar> } />
      </Routes>
    </Router>
  );
}

export default App;
