import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link
} from "react-router-dom";
// import MainSidebar from "./Home/MainSidebar.js"
import JermaSearch from "./JermaSearch/JermaSearch.js";

function Home() {
  return (
    <div>
      <h1>Home Page</h1>
      <p>Welcome to the home page!</p>
      <Link to="/jermasearch">Go to JermaSearch</Link>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        {/* <Route path="/" element={<MainSidebar />} /> */}
        <Route path="/" element={<JermaSearch />} />
      </Routes>
    </Router>
  );
}

export default App;
