import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Import your page components
import Login from './conquerorlogin'; 
import SecondPage from './secondpage';

function App() {
  return (
    <Router>
      <Routes>
        {/* This sets the login page as the default home path */}
        <Route path="/" element={<Login />} />

        {/* This defines the URL for your second page */}
        <Route path="/second-page" element={<SecondPage />} />
      </Routes>
    </Router>
  );
}

export default App;