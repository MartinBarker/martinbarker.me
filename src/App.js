import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link
} from "react-router-dom";

import Sidebar from "./Sidebar/Sidebar.js"
import Home from "./Home/Home.js"
import JermaSearch from "./JermaSearch/JermaSearch.js";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/home" element={ <Sidebar> <Home/> </Sidebar> } /> 
        <Route path="/" element={<JermaSearch />} />
      </Routes>
    </Router>
  );
}

export default App;
