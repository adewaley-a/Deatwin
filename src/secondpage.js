import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase'; 
import { doc, setDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
// REMOVED: getFunctions and httpsCallable (No longer needed on Spark plan)
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

      return () => {
        unsubscribeAuth();
        unsubscribeSnapshot();
      };
    });
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
        // --- CHANGE 1: REMOVED CLOUD FUNCTION CALL ---
        // Instead of calling verifyPayment (which requires Blaze), we just alert the user.
        // Your Render Webhook will handle the actual wallet update in the background.
        alert("Payment complete! Your wallet will update shortly.");
        console.log("Transaction Reference:", response.reference);
      },
      onClose: () => {
        console.log("Window closed.");
      }
    });
    handler.openIframe();
  };

  const handleWithdraw = () => {
    // NOTE: Withdrawal also uses a Cloud Function. 
    // Since you are on the Spark plan, this will still throw a CORS error.
    // You would need a similar Express route on Render for withdrawals.
    alert("Withdrawal feature requires a backend update to Render as well.");
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
        <div className='sectwo'>DEATWINO</div>
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