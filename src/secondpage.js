import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase'; 
import { doc, getDoc, setDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions'; // Add this
import './secondpage.css';

function Login() {
  const [username, setUsername] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0); // Track balance

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        
        // Real-time listener for User Data (Balance & Username)
        const userDocRef = doc(db, "users", currentUser.uid);
        onSnapshot(userDocRef, (doc) => {
          if (doc.exists()) {
            setUsername(doc.data().username);
            setWalletBalance(doc.data().wallet_balance || 0);
          }
        });
      }
      setLoading(false);
    });git
    return () => unsubscribe();
  }, []);

  // --- SECURE DEPOSIT (Paystack) ---
  const handleDeposit = () => {
    const amount = prompt("Enter amount to deposit (₦):");
    if (!amount || isNaN(amount) || amount <= 0) return;

    const handler = window.PaystackPop.setup({
      key: 'pk_test_c8808c973c0bcdcbb21c6f0dd83e3a5c889f59c0', // Replace with your Test Public Key
      email: user.email,
      amount: amount * 100, // Naira to Kobo
      currency: 'NGN',
      callback: (response) => {
        // Call the backend to verify the reference
        const functions = getFunctions();
        const verifyPayment = httpsCallable(functions, 'verifyPaystackPayment');
        verifyPayment({ reference: response.reference })
          .then(() => alert("Deposit Successful!"))
          .catch(() => alert("Verification Failed."));
      }
    });
    handler.openIframe();
  };

  // --- SECURE WITHDRAWAL ---
  const handleWithdraw = () => {
    const amount = prompt("Enter amount to withdraw (₦):");
    if (!amount || isNaN(amount) || amount <= 0) return;

    const functions = getFunctions();
    const processWithdraw = httpsCallable(functions, 'processWithdrawal');
    processWithdraw({ amount: parseInt(amount) })
      .then(() => alert("Withdrawal processed!"))
      .catch((err) => alert(err.message));
  };

  const handleUsernameSubmit = async (e) => {
    e.preventDefault();
    if (!input || !user) return;
    const usernamesQuery = query(collection(db, "users"), where("username", "==", input.toLowerCase()));
    const querySnapshot = await getDocs(usernamesQuery);

    if (!querySnapshot.empty) {
      alert("Username already taken!");
    } else {
      await setDoc(doc(db, "users", user.uid), {
        username: input.toLowerCase(),
        displayName: input,
        email: user.email,
        wallet_balance: 0, // Initialize balance
        matches_completed: 0,
        createdAt: new Date()
      });
      setUsername(input);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="second-container">
      {user && !username && (
        <div className="username-overlay">
          <form onSubmit={handleUsernameSubmit} className="username-form">
            <h3>Set Your Username</h3>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Unique username..." />
            <button type="submit">Claim Name</button>
          </form>
        </div>
      )}

      <div className="divisionwan">
        <div className='secwan'>{username || "Guest"}</div>
        <div className='sectwo'>DEATWIN</div>
        <div className='secthree'>
          {/* Linked to functions */}
          <div className='deposit' onClick={handleDeposit}>+</div>
          <div className='moneybtn'>₦{walletBalance.toLocaleString()}</div>
          <div className='withdraw' onClick={handleWithdraw}>-</div>
        </div>
      </div>

      <div className='divibox'>
        <div className="divisiontwo"></div>
        <div className="divisionthree"></div>
      </div>
    </div>
  );
}

export default Login;