/* eslint-disable no-unused-vars */
import { auth } from "./firebase";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInAnonymously, 
  onAuthStateChanged 
} from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, useContext } from "react";
import React from 'react';
import { VisibilityContext } from './VisibilityContext'; 
import './profilerlogin.scss';
import ptagbot from './profilerbot.png'; 

function ProfilerLogin() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [error, setError] = useState(null);
    
    // Use setVisible (or equivalent from your context) instead of just toggle
    const { toggleVisibility, resetVisibility } = useContext(VisibilityContext); 
    const [loadingsign, setLoadingsign] = useState(false);
    const [loadinglog, setLoadinglog] = useState(false);

   
    const signIn = async () => {
        setLoadingsign(true);
        try { 
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const newUser = userCredential.user;
            
            // 1. Set visibility to TRUE only AFTER success
            toggleVisibility(); 
            
            navigate(`/user/${newUser.uid}`);
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoadingsign(false);
        }
    };

    const logIn = async () => {
        setLoadinglog(true);
        try { 
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const loggedUser = userCredential.user;
            
            // 2. Set visibility to TRUE only AFTER success
            toggleVisibility(); 

            navigate(`/user/${loggedUser.uid}`);
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoadinglog(false);
        }
    };

    const circles = Array.from({ length: 100 }, (_, i) => i + 1);

    return (
      <div className="bodyl">
        {circles.map((_, index) => (
          <div key={index} className="circle-container">
            <div className="circle"></div>
          </div>
        ))}

        <div className="botcover"> <img src={ptagbot} className='ptagbot' alt="bot" /> </div>

        <h1 className="pcover">PROFILERTAG </h1>

        <div className="logcover">
          <h3 className="gapes">New account?</h3>
            <input 
              className="sign"
              type="email"
              placeholder="randomuser@gmail.com"
              onChange={(e) => setEmail(e.target.value)}
            />

            <input
              className="pword"
              type="password"
              placeholder="Password"
              onChange={(e) => setPassword(e.target.value)}
            />
            {/* Removed toggleVisibility from onClick, moved inside function */}
            <button className="loginaccess" onClick={signIn} >Sign up</button>
            {loadingsign ? <p className="processing">processing...</p> : <p></p>}

          <h3 className="gapes">Registered?</h3>
            <input 
              className="log"
              type="email"
              placeholder="randomuser@gmail.com"
              onChange={(e) => setEmail(e.target.value)}
            />

            <input
              className="pword"
              type="password"
              placeholder="Password"
              onChange={(e) => setPassword(e.target.value)}
            />
            {/* Removed toggleVisibility from onClick, moved inside function */}
            <button className="loginaccess" onClick={logIn} >Login</button>
            {loadinglog ? <p className="processing">processing...</p> : <p></p>}
            {error && <p className="warning" style={{ color: 'red' }}>{error}</p>}
        </div>
      </div>  
    );
}

export default ProfilerLogin;