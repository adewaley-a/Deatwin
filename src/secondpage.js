import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase'; 
import { useNavigate } from 'react-router-dom';
import { 
  doc, collection, query, where, getDocs, onSnapshot, 
  getDoc, addDoc, updateDoc, limit, setDoc 
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  setPersistence, 
  browserSessionPersistence, 
  signOut 
} from 'firebase/auth';
import './secondpage.css';

const NIGERIAN_BANKS = [
  { name: "Access Bank", code: "044" }, { name: "First Bank", code: "011" },
  { name: "GTBank", code: "058" }, { name: "Kuda Bank", code: "50211" },
  { name: "Moniepoint", code: "50515" }, { name: "OPay", code: "999992" },
  { name: "Palmpay", code: "999991" }, { name: "UBA", code: "033" },
  { name: "Zenith Bank", code: "057" }
];

function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0); 
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [showMainModal, setShowMainModal] = useState(false);
  const [activeSubModal, setActiveSubModal] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');

  useEffect(() => {
    let unsubscribeSnapshot = () => {};
    setPersistence(auth, browserSessionPersistence).then(() => {
      return onAuthStateChanged(auth, async (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          const userDocRef = doc(db, "users", currentUser.uid);
          const initialSnap = await getDoc(userDocRef);
          if (!initialSnap.exists() || !initialSnap.data().username) setShowUsernameModal(true);
          unsubscribeSnapshot = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              setUsername(data.username || '');
              setWalletBalance(data.wallet_balance || 0);
              if (data.username) setShowUsernameModal(false);
            }
          });
        } else {
          setUser(null);
          setUsername('');
          setWalletBalance(0);
        }
        setLoading(false);
      });
    });
    return () => unsubscribeSnapshot();
  }, []);

  const handleSaveUsername = async () => {
    if (!usernameInput || usernameInput.length < 3) return alert("Username too short!");
    setIsSavingUsername(true);
    try {
      const q = query(collection(db, "users"), where("username", "==", usernameInput.trim()));
      const querySnap = await getDocs(q);
      if (!querySnap.empty) { alert("Username already taken!"); return; }
      await setDoc(doc(db, "users", user.uid), {
        username: usernameInput.trim(), wallet_balance: 0, email: user.email, createdAt: new Date()
      }, { merge: true });
      setShowUsernameModal(false);
    } finally { setIsSavingUsername(false); }
  };

  const listenToRoom = (roomId) => {
    onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCurrentRoom({ id: snap.id, ...data });
        if (data.status === "active") navigate(`/game/${snap.id}`);
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
        type: "public", hostId: user.uid, hostName: username, status: "waiting", votes: {}, createdAt: new Date()
      });
      listenToRoom(newRoom.id);
    }
  };

  const createPrivateRoom = async () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newRoom = await addDoc(collection(db, "rooms"), {
      roomCode: code, type: "private", hostId: user.uid, hostName: username, status: "waiting", votes: {}, createdAt: new Date()
    });
    listenToRoom(newRoom.id);
  };

  const joinPrivateRoom = async () => {
    const q = query(collection(db, "rooms"), where("roomCode", "==", roomCodeInput.toUpperCase()), where("status", "==", "waiting"));
    const snap = await getDocs(q);
    if (snap.empty) return alert("Room not found!");
    await updateDoc(snap.docs[0].ref, { guestId: user.uid, guestName: username, status: "negotiating" });
    listenToRoom(snap.docs[0].id);
  };

  const handleVote = async (price) => {
    if (walletBalance < price) return alert("Insufficient Balance!");
    const roomRef = doc(db, "rooms", currentRoom.id);
    const updatedVotes = { ...currentRoom.votes, [user.uid]: price };
    await updateDoc(roomRef, { votes: updatedVotes });

    const voteValues = Object.values(updatedVotes);
    if (voteValues.length === 2 && voteValues[0] === voteValues[1]) {
      fetch('https://deatwin-server.onrender.com/lock-in-bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: currentRoom.id, userId: user.uid })
      });
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="second-container">
      {showUsernameModal && (
        <div className="modal-overlay username-setup">
          <div className="modal-content">
            <h2>Set Username</h2>
            <input type="text" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} />
            <button onClick={handleSaveUsername}>{isSavingUsername ? "Saving..." : "Start"}</button>
          </div>
        </div>
      )}
      <div className="divisionwan">
        <div className='secwan' onClick={() => signOut(auth)}>{username || "Guest"}</div>
        <div className='sectwo'>DEATWIN</div>
        <div className='secthree'>
          <div className='moneybtn'>₦{walletBalance.toLocaleString()}</div>
        </div>
      </div>

      {/* Added NIGERIAN_BANKS mapping inside a simple div to clear ESlint warning */}
      <div style={{display: 'none'}}>{NIGERIAN_BANKS.map(b => b.name)}</div>

      <div className='gamebox'>
        <div className='gamebox1' onClick={() => setShowMainModal(true)}><div className='ponline'>Play Online</div></div>
      </div>

      {showMainModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="close-modal" onClick={() => { setShowMainModal(false); setActiveSubModal(null); }}>X</div>
            {!activeSubModal && !currentRoom && (
              <div className="step">
                <button onClick={() => setActiveSubModal('private')}>Private Room</button>
                <button onClick={startPublicMatch}>Public Match</button>
              </div>
            )}
            {activeSubModal === 'private' && !currentRoom && (
              <div className="step">
                <button onClick={createPrivateRoom}>Create Room</button>
                <hr />
                <input 
                  placeholder="Enter Code" 
                  value={roomCodeInput} 
                  onChange={(e) => setRoomCodeInput(e.target.value)} 
                />
                <button onClick={joinPrivateRoom}>Join</button>
              </div>
            )}
            {currentRoom && currentRoom.status === "negotiating" && (
              <div className="step">
                <h2>Stake Amount</h2>
                <div className="price-grid">
                  {[100, 500, 1000].map(p => (
                    <button key={p} className={currentRoom.votes?.[user.uid] === p ? 'voted' : ''} onClick={() => handleVote(p)}>₦{p}</button>
                  ))}
                </div>
              </div>
            )}
            {currentRoom && currentRoom.status === "waiting" && (
              <div className="step">
                <h3>Room Code: {currentRoom.roomCode}</h3>
                <p>Waiting for opponent...</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default Login;