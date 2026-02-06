import React from 'react';
import { auth, provider } from './firebase';
import { signInWithPopup, signInWithRedirect } from 'firebase/auth'; // Switched to Popup for easier navigation
import { useNavigate } from 'react-router-dom'; // Import the hook
import './conquerorlogin.css';
import googlogo from './googlogo.png';

function Login() {
  

  return (
    <div className="second-container">
      <div className="second-card">
        <h1>Second page</h1>
      </div>
    </div>
  );
}

export default Login;