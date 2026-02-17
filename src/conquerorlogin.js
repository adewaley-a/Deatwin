import React from 'react';
import { auth, provider } from './firebase';
import { signInWithPopup } from 'firebase/auth'; 
import { useNavigate } from 'react-router-dom'; 
import './conquerorlogin.css';
import googlogo from './googlogo.png';

function Login() {
  const navigate = useNavigate(); 

  const signIn = () => {
    signInWithPopup(auth, provider)
      .then((result) => {
        console.log("User signed in:", result.user);
        
        // Navigation to the second page
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