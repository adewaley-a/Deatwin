import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase'; 
import { doc, setDoc, collection, query, where, getDocs, onSnapshot, getDoc, addDoc, updateDoc, limit } from 'firebase/firestore';
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
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0); 
  const [isProcessing, setIsProcessing] = useState(false);

  // --- NEW GAME STATES ---
  const [showMainModal, setShowMainModal] = useState(false);
  const [activeSubModal, setActiveSubModal] = useState(null); // 'private' or 'public'
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

  // --- MATCHMAKING LOGIC ---

  const listenToRoom = (roomId) => {
    onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCurrentRoom({ id: snap.id, ...data });
        
        // AUTO-REDIRECT WHEN BACKEND ACTIVATES ROOM
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

  // --- AUTOMATIC LOCK-IN TRIGGER ---
  useEffect(() => {
    if (currentRoom && currentRoom.status === "negotiating") {
      const voteKeys = Object.keys(currentRoom.votes || {});
      const voteValues = Object.values(currentRoom.votes || {});
      
      if (voteKeys.length === 2 && voteValues[0] === voteValues[1]) {
        // CALL RENDER SERVER TO DEDUCT MONEY
        fetch('https://deatwin-server.onrender.com/lock-in-bet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: currentRoom.id, userId: user.uid })
        });
      }
    }
  }, [currentRoom]);

  // (Keep your handleDeposit and handleWithdraw functions here unchanged)

  if (loading) return <div>Loading...</div>;

  return (
    <div className="second-container">
      {/* Existing Username Overlay Logic */}
      {user && !username && (
         <div className="username-overlay">
           <form onSubmit={(e) => {/* your existing handleUsernameSubmit */}} className="username-form">
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

      <div className='gamebox'>
        <div className='gamebox1' onClick={() => setShowMainModal(true)}>
          <div className='ponline'>Play online</div>
        </div>
        <div className='gamebox2'></div>
      </div>

      {/* --- GAME MODAL SYSTEM --- */}
      {showMainModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="close-modal" onClick={() => {setShowMainModal(false); setCurrentRoom(null); setActiveSubModal(null);}}>X</div>
            
            {!activeSubModal && !currentRoom && (
              <div className="step">
                <h2>Choose Mode</h2>
                <button onClick={() => setActiveSubModal('private')}>Room (Private)</button>
                <button onClick={startPublicMatch}>Public Match</button>
              </div>
            )}

            {activeSubModal === 'private' && !currentRoom && (
              <div className="step">
                <h2>Private Room</h2>
                <button onClick={createPrivateRoom}>Create Room</button>
                <div className="or">OR</div>
                <input value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value)} placeholder="Enter Code" />
                <button onClick={joinPrivateRoom}>Join</button>
              </div>
            )}

            {currentRoom && currentRoom.status === "waiting" && (
              <div className="step">
                <h2>Searching...</h2>
                {currentRoom.roomCode && <h3>Code: {currentRoom.roomCode}</h3>}
                <p>Waiting for an opponent to join</p>
              </div>
            )}

            {currentRoom && currentRoom.status === "negotiating" && (
              <div className="step">
                <h2>Negotiate Stake</h2>
                <p>Opponent: {currentRoom.hostId === user.uid ? currentRoom.guestName : currentRoom.hostName}</p>
                <div className="price-grid">
                  {[100, 500, 1000].map(p => (
                    <button key={p} className={currentRoom.votes[user.uid] === p ? 'voted' : ''} onClick={() => handleVote(p)}>
                      ₦{p}
                    </button>
                  ))}
                </div>
                <p className="hint">Both players must click the same amount to start.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Login;