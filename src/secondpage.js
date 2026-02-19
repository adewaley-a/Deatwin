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
      key: process.env.REACT_APP_PAYSTACK_PUBLIC_KEY || 'pk_test_c8808c973c0bcdcbb21c6f0dd83e3a5c889f59c0', 
      email: user.email,
      amount: Number(amount) * 100, 
      currency: 'NGN',
      callback: (response) => {
        // --- FIX: Cleanup the handler to prevent the 'language' null error ---
        if (handler.close) handler.close();
        alert("Payment complete! Your wallet will update shortly.");
        console.log("Transaction Reference:", response.reference);
      },
      onClose: () => {
        console.log("Payment window closed.");
      }
    });
    handler.openIframe();
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

      // Check if user needs to provide bank details
      if (!userData?.paystack_recipient_code) {
        const acc = prompt("Enter 10-digit Account Number:");
        if (!acc || acc.length !== 10) return alert("Valid 10-digit account required.");
        
        const bankName = prompt("Enter Bank Name (e.g. GTBank, OPay, Kuda):");
        const selectedBank = NIGERIAN_BANKS.find(b => b.name.toLowerCase() === bankName?.toLowerCase());
        
        if (!selectedBank) return alert("Bank not supported. Check spelling (e.g., 'GTBank').");
        
        payload.accountNumber = acc;
        payload.bankCode = selectedBank.code;
      }

      // Replace with your actual Render backend URL
      const response = await fetch('https://deatwin-server.onrender.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (data.success) {
        alert("Withdrawal successful! Money is on the way.");
      } else {
        alert("Withdrawal failed: " + data.message);
      }
    } catch (e) {
      console.error("Withdrawal Error:", e);
      alert("Server error. Please try again later.");
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
      }, { merge: true }); // Merge keeps bank details safe
      setUsername(input);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="second-container">
      {/* Username Overlay for new users */}
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

      <div className='divibox'>
        <div className="divisiontwo"></div>
        <div className="divisionthree"></div>
      </div>
    </div>
  );
}

export default Login;