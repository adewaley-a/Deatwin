import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase'; 
import { doc, setDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions'; 
import './secondpage.css';

function Login() {
  const [username, setUsername] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0); 

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      let unsubscribeSnapshot = () => {};

      if (currentUser) {
        setUser(currentUser);
        
        const userDocRef = doc(db, "users", currentUser.uid);
        unsubscribeSnapshot = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            setUsername(docSnap.data().username);
            setWalletBalance(docSnap.data().wallet_balance || 0);
          }
        });
      }
      setLoading(false);

      // Clean up both the auth listener and the snapshot listener
      return () => {
        unsubscribeAuth();
        unsubscribeSnapshot();
      };
    });

    return () => unsubscribeAuth();
  }, []);

  const handleDeposit = () => {
    const amount = prompt("Enter amount to deposit (₦):");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;

    if (!window.PaystackPop) {
      alert("Paystack SDK not loaded.");
      return;
    }

    const handler = window.PaystackPop.setup({
      key: process.env.REACT_APP_PAYSTACK_PUBLIC_KEY || 'pk_test_c8808c973c0bcdcbb21c6f0dd83e3a5c889f59c0', 
      email: user.email,
      amount: Number(amount) * 100, 
      currency: 'NGN',
      callback: (response) => {
        const functions = getFunctions();
        const verifyPayment = httpsCallable(functions, 'verifyPaystackPayment');
        verifyPayment({ reference: response.reference })
          .then(() => alert("Deposit Successful!"))
          .catch(() => alert("Verification Failed."));
      }
    });
    handler.openIframe();
  };

  const handleWithdraw = () => {
    const amount = prompt("Enter amount to withdraw (₦):");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;

    const functions = getFunctions();
    const processWithdraw = httpsCallable(functions, 'processWithdrawal');
    processWithdraw({ amount: parseInt(amount, 10) })
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
        wallet_balance: 0, 
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