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

  const handleDeposit = () => {
    const amount = prompt("Enter amount to deposit (₦):");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    if (!window.PaystackPop) return alert("Paystack SDK not loaded.");

    const handler = window.PaystackPop.setup({
      key: process.env.REACT_APP_PAYSTACK_PUBLIC_KEY || 'pk_test_your_key', 
      email: user.email,
      amount: Number(amount) * 100, 
      currency: 'NGN',
      callback: (response) => alert("Deposit successful! Wallet updating...")
    });
    handler.openIframe();
  };

  const handleWithdraw = async () => {
    if (!user) return;
    
    const amount = prompt("Enter amount to withdraw (₦):");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    if (Number(amount) > walletBalance) return alert("Insufficient funds!");

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();

    let payload = { userId: user.uid, amount: Number(amount) };

    // If no saved details, we need the NUBAN info
    if (!userData.paystack_recipient_code) {
      const acc = prompt("Enter 10-digit Account Number:");
      if (!acc || acc.length !== 10) return alert("Valid 10-digit account required.");
      
      console.log("Available Banks:", NIGERIAN_BANKS.map(b => b.name).join(", "));
      const bankName = prompt("Enter Bank Name (e.g. GTBank, Kuda, OPay):");
      const selectedBank = NIGERIAN_BANKS.find(b => b.name.toLowerCase() === bankName?.toLowerCase());
      
      if (!selectedBank) return alert("Bank not supported or misspelt. Use GTBank, Zenith, OPay, etc.");
      
      payload.accountNumber = acc;
      payload.bankCode = selectedBank.code;
    }

    try {
      const response = await fetch('https://your-backend-url.onrender.com/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      alert(data.success ? "Success! Check your bank account." : "Error: " + data.message);
    } catch (e) {
      alert("Server error.");
    }
  };

  // ... rest of your handleUsernameSubmit logic ...

  if (loading) return <div>Loading...</div>;

  return (
    <div className="second-container">
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