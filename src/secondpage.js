import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase'; 
import { doc, setDoc, collection, query, where, getDocs, onSnapshot, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import './secondpage.css';

const NIGERIAN_BANKS = [
  { name: "Access Bank", code: "044" },
  { name: "First Bank", code: "011" },
  { name: "GTBank", code: "058" },
  { name: "Kuda Bank", code: "50211" },
  { name: "Moniepoint", code: "50515" },
  { name: "OPay", code: "999992" },
  { name: "Palmpay", code: "999991" },
  { name: "UBA", code: "033" },
  { name: "Zenith Bank", code: "057" }
];

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

  const paystackHandler = useRef(null);

  const handleDeposit = () => {
    // 1. If a handler already exists, close it manually before starting a new one
    if (paystackHandler.current && paystackHandler.current.close) {
        paystackHandler.current.close();
    }
  
    const amount = prompt("Enter amount to deposit (₦):");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
  
    if (!window.PaystackPop) return alert("SDK not loaded.");
  
    // 2. Assign the setup to our 'useRef' so it doesn't get lost in memory
    paystackHandler.current = window.PaystackPop.setup({
      key: 'pk_test_c8808c973c0bcdcbb21c6f0dd83e3a5c889f59c0', 
      email: user.email,
      amount: Number(amount) * 100, 
      currency: 'NGN',
      callback: (response) => {
        // 3. Clear the ref on success
        if (paystackHandler.current) paystackHandler.current.close();
        paystackHandler.current = null; 
        
        alert("Payment complete!");
      },
      onClose: () => {
        // 4. Clear the ref on close
        paystackHandler.current = null;
        console.log("Closed.");
      }
    });
  
    paystackHandler.current.openIframe();
  };
  const handleWithdraw = async () => {
    if (!user) return;
    
    const amount = prompt("Enter amount to withdraw (₦):");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    if (Number(amount) > walletBalance) return alert("Insufficient funds!");

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data();

      let payload = { userId: user.uid, amount: Number(amount) };

      if (!userData?.paystack_recipient_code) {
        const acc = prompt("Enter 10-digit Account Number:");
        if (!acc || acc.length !== 10) return alert("Valid 10-digit account required.");
        
        const bankName = prompt("Enter Bank Name (e.g. GTBank, OPay, Kuda):");
        const selectedBank = NIGERIAN_BANKS.find(b => b.name.toLowerCase() === bankName?.toLowerCase());
        
        if (!selectedBank) return alert("Bank not supported. Please check spelling.");
        
        payload.accountNumber = acc;
        payload.bankCode = selectedBank.code;
      }

      // Replace with your actual Render URL
      const response = await fetch('https://your-backend-url.onrender.com/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (data.success) {
        alert("Withdrawal initiated successfully!");
      } else {
        alert("Withdrawal failed: " + data.message);
      }
    } catch (e) {
      console.error("Withdrawal error:", e);
      alert("Error connecting to server.");
    }
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
      }, { merge: true });
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
            <input 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              placeholder="Unique username..." 
            />
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
    </div>
  );
}

export default Login;