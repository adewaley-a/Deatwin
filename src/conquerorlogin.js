import React from 'react';
import { auth, provider } from './firebase';
import { signInWithPopup, signInWithRedirect } from 'firebase/auth'; // Switched to Popup for easier navigation
import { useNavigate } from 'react-router-dom'; // Import the hook
import './conquerorlogin.css';
import googlogo from './googlogo.png';

function Login() {
  const navigate = useNavigate(); // Initialize the navigate function

  const signIn = () => {
    signInWithPopup(auth, provider)
      .then((result) => {
        console.log("User signed in:", result.user);
        
        // This is the magic line that sends them to the second page
        navigate('/second-page'); 
      })
      .catch((error) => {
        alert(error.message);
      });
  };
      

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Welcome Back</h1>
        <p>Please sign in to continue</p>
        <button className="google-btn" onClick={signIn}>
          <img src={googlogo} alt="Google logo" />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

export default Login;