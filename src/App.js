import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route
} from "react-router-dom";

import Sidebar from "./Sidebar/Sidebar.js"
import Home from "./Home/Home.js"
import JermaSearch from "./JermaSearch/JermaSearch.js";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/home" element={ <Sidebar> <Home/> </Sidebar> } /> 
        <Route path="/search" element={<JermaSearch />} />
        <Route path="/jermasearch/search" element={<JermaSearch />} />
        <Route path="/" element={<JermaSearch />} />
      </Routes>
    </Router>
  );
}

export default App;
