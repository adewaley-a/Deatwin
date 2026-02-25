import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase'; 
import { doc, collection, query, where, getDocs, onSnapshot, getDoc, addDoc, updateDoc, limit } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import './secondpage.css';

const NIGERIAN_BANKS = [
  { name: "Access Bank", code: "044" }, { name: "First Bank", code: "011" },
  { name: "GTBank", code: "058" }, { name: "Kuda Bank", code: "50211" },
  { name: "Moniepoint", code: "50515" }, { name: "OPay", code: "999992" },
  { name: "Palmpay", code: "999991" }, { name: "UBA", code: "033" },
  { name: "Zenith Bank", code: "057" }
];

function Login() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0); 
  const [isProcessing, setIsProcessing] = useState(false);

  // GAME STATES
  const [showMainModal, setShowMainModal] = useState(false);
  const [activeSubModal, setActiveSubModal] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');

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
      return () => { unsubscribeAuth(); unsubscribeSnapshot(); };
    });
  }, []);

  // --- 1. DEPOSIT LOGIC ---
  const handleDeposit = async () => {
    const amount = prompt("Enter amount to deposit (₦):");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    
    setIsProcessing(true);
    try {
      const response = await fetch('https://deatwin-server.onrender.com/initialize-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, amount: Number(amount) }),
      });
      const data = await response.json();
      if (data.url) { 
        window.location.href = data.url; 
      } else { 
        alert("Failed to initialize payment."); 
        setIsProcessing(false); 
      }
    } catch (error) {
      console.error("Deposit error:", error);
      alert("Server error.");
      setIsProcessing(false);
    }
  };

  // --- 2. WITHDRAW LOGIC ---
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
        const bankName = prompt("Enter Bank Name (e.g. OPay, GTBank):");
        const selectedBank = NIGERIAN_BANKS.find(b => b.name.toLowerCase() === bankName?.toLowerCase());
        if (!selectedBank) return alert("Bank not supported.");
        payload.accountNumber = acc;
        payload.bankCode = selectedBank.code;
      }
      
      const response = await fetch('https://deatwin-server.onrender.com/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      alert(data.success ? "Withdrawal initiated!" : "Error: " + data.message);
    } catch (e) { 
      alert("Server error."); 
    }
  };

  // --- 3. MATCHMAKING LOGIC ---
  const listenToRoom = (roomId) => {
    onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCurrentRoom({ id: snap.id, ...data });
        if (data.status === "active") {
          window.location.href = `/game/${snap.id}`;
        }
      }
    });
  };

  const startPublicMatch = async () => {
    setActiveSubModal('public');
    const q = query(collection(db, "rooms"), where("type", "==", "public"), where("status", "==", "waiting"), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const roomDoc = snap.docs[0];
      await updateDoc(roomDoc.ref, { guestId: user.uid, guestName: username, status: "negotiating" });
      listenToRoom(roomDoc.id);
    } else {
      const newRoom = await addDoc(collection(db, "rooms"), {
        type: "public", hostId: user.uid, hostName: username, guestId: null, status: "waiting", votes: {}, createdAt: new Date()
      });
      listenToRoom(newRoom.id);
    }
  };

  const createPrivateRoom = async () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newRoom = await addDoc(collection(db, "rooms"), {
      roomCode: code, type: "private", hostId: user.uid, hostName: username, guestId: null, status: "waiting", votes: {}, createdAt: new Date()
    });
    listenToRoom(newRoom.id);
  };

  const joinPrivateRoom = async () => {
    if(!roomCodeInput) return alert("Please enter a code");
    const q = query(collection(db, "rooms"), where("roomCode", "==", roomCodeInput.toUpperCase()), where("status", "==", "waiting"));
    const snap = await getDocs(q);
    if (snap.empty) return alert("Room not found!");
    const roomDoc = snap.docs[0];
    await updateDoc(roomDoc.ref, { guestId: user.uid, guestName: username, status: "negotiating" });
    listenToRoom(roomDoc.id);
  };

  const handleVote = async (price) => {
    await updateDoc(doc(db, "rooms", currentRoom.id), {
      [`votes.${user.uid}`]: price
    });
  };

  // LOCK-IN TRIGGER
  useEffect(() => {
    if (currentRoom && currentRoom.status === "negotiating") {
      const voteKeys = Object.keys(currentRoom.votes || {});
      const voteValues = Object.values(currentRoom.votes || {});
      if (voteKeys.length === 2 && voteValues[0] === voteValues[1]) {
        fetch('https://deatwin-server.onrender.com/lock-in-bet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: currentRoom.id, userId: user.uid })
        });
      }
    }
  }, [currentRoom, user]);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="second-container">
      <div className="divisionwan">
        <div className='secwan'>{username || "Guest"}</div>
        <div className='sectwo'>DEATWINO</div>
        <div className='secthree'>
          <div className='deposit' onClick={isProcessing ? null : handleDeposit}>
            {isProcessing ? "..." : "+"}
          </div>
          <div className='moneybtn'>₦{walletBalance.toLocaleString()}</div>
          <div className='withdraw' onClick={handleWithdraw}>-</div>
        </div>
      </div>

      <div className='gamebox'>
        {/* Play Online Div triggers the modal */}
        <div className='gamebox1' onClick={() => setShowMainModal(true)}>
          <div className='ponline'>Play online</div>
        </div>
        <div className='gamebox2'></div>
      </div>

      {showMainModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="close-modal" onClick={() => {setShowMainModal(false); setCurrentRoom(null); setActiveSubModal(null);}}>X</div>
            
            {/* STEP 1: Choose Mode */}
            {!activeSubModal && !currentRoom && (
              <div className="step">
                <h2>Choose Mode</h2>
                <button onClick={() => setActiveSubModal('private')}>Private Room</button>
                <button onClick={startPublicMatch}>Public Match</button>
              </div>
            )}

            {/* STEP 2: Private Room Actions */}
            {activeSubModal === 'private' && !currentRoom && (
              <div className="step">
                <h2>Private Room</h2>
                <button onClick={createPrivateRoom}>Create Room</button>
                <div style={{margin: '10px 0'}}>OR</div>
                <input 
                  value={roomCodeInput} 
                  onChange={e => setRoomCodeInput(e.target.value)} 
                  placeholder="Enter Code" 
                />
                <button onClick={joinPrivateRoom}>Join</button>
              </div>
            )}

            {/* STEP 3: Waiting for opponent */}
            {currentRoom && currentRoom.status === "waiting" && (
              <div className="step">
                <h2>Waiting for opponent...</h2>
                {currentRoom.roomCode && <h3>Code: {currentRoom.roomCode}</h3>}
              </div>
            )}

            {/* STEP 4: Price Negotiation */}
            {currentRoom && currentRoom.status === "negotiating" && (
              <div className="step">
                <h2>Negotiate Stake</h2>
                <div className="price-grid">
                  {[100, 500, 1000].map(p => (
                    <button 
                      key={p} 
                      className={currentRoom.votes[user.uid] === p ? 'voted' : ''} 
                      onClick={() => handleVote(p)}
                    >
                      ₦{p}
                    </button>
                  ))}
                </div>
                <p style={{fontSize: '12px', marginTop: '10px'}}>Both players must select the same amount</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Login;