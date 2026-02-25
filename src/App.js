import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Import your page components
import Login from './conquerorlogin'; 
import SecondPage from './secondpage';
import GamePage from './GamePage';

function App() {
  return (
    <Router>
      <Routes>
        {/* This sets the login page as the default home path */}
        <Route path="/" element={<Login />} />

        {/* This defines the URL for your second page */}
        <Route path="/second-page" element={<SecondPage />} />
        <Route path="/game/:roomId" element={<GamePage />} />
      </Routes>
    </Router>
  );
}

export default App;