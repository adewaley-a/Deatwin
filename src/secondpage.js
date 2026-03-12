import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase'; 
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
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0); 
  const [isProcessing, setIsProcessing] = useState(false);

  // USERNAME SETTING STATES
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [isSavingUsername, setIsSavingUsername] = useState(false);

  // GAME STATES
  const [showMainModal, setShowMainModal] = useState(false);
  const [activeSubModal, setActiveSubModal] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');

  useEffect(() => {
    let unsubscribeSnapshot = () => {};

    setPersistence(auth, browserSessionPersistence)
      .then(() => {
        return onAuthStateChanged(auth, async (currentUser) => {
          if (currentUser) {
            setUser(currentUser);
            const userDocRef = doc(db, "users", currentUser.uid);
            
            // Initial check for username existence
            const initialSnap = await getDoc(userDocRef);
            if (!initialSnap.exists() || !initialSnap.data().username) {
              setShowUsernameModal(true);
            }

            unsubscribeSnapshot = onSnapshot(userDocRef, (docSnap) => {
              if (docSnap.exists()) {
                const data = docSnap.data();
                setUsername(data.username || '');
                setWalletBalance(data.wallet_balance || 0);
                
                // Close modal if username finally exists
                if (data.username) setShowUsernameModal(false);
              } else {
                setShowUsernameModal(true);
              }
            });
          } else {
            setUser(null);
            setUsername('');
            setWalletBalance(0);
          }
          setLoading(false);
        });
      })
      .catch((error) => {
        console.error("Auth Persistence Error:", error);
        setLoading(false);
      });

    return () => unsubscribeSnapshot();
  }, []);

  // --- USERNAME SAVING LOGIC ---
  const handleSaveUsername = async () => {
    if (!usernameInput || usernameInput.length < 3) return alert("Username too short!");
    if (!user) return;

    setIsSavingUsername(true);
    try {
      // Check for uniqueness
      const q = query(collection(db, "users"), where("username", "==", usernameInput.trim()));
      const querySnap = await getDocs(q);

      if (!querySnap.empty) {
        alert("Username already taken!");
        setIsSavingUsername(false);
        return;
      }

      // Save to Firestore
      await setDoc(doc(db, "users", user.uid), {
        username: usernameInput.trim(),
        wallet_balance: 0,
        email: user.email,
        createdAt: new Date()
      }, { merge: true });

      setShowUsernameModal(false);
    } catch (error) {
      console.error("Error saving username:", error);
      alert("Failed to save username.");
    } finally {
      setIsSavingUsername(false);
    }
  };

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

  useEffect(() => {
    if (currentRoom && currentRoom.status === "negotiating") {
      const voteKeys = Object.keys(currentRoom.votes || {});
      const voteValues = Object.values(currentRoom.votes || {});
      
      if (voteKeys.length === 2 && voteValues[0] === voteValues[1]) {
        fetch('https://deatwin-server.onrender.com/lock-in-bet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: currentRoom.id, userId: user.uid })
        })
        .catch(err => console.error("Lock-in error:", err));
      }
    }
  }, [currentRoom, user]);

  const handleLogout = () => {
    signOut(auth).then(() => {
        window.location.reload();
    });
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="second-container">
      {/* USERNAME MODAL OVERLAY */}
      {showUsernameModal && (
        <div className="modal-overlay username-setup">
          <div className="modal-content">
            <h2>Set Your Username</h2>
            <p>Choose a unique name to start playing.</p>
            <input 
              type="text"
              placeholder="Username..."
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
            />
            <button disabled={isSavingUsername} onClick={handleSaveUsername}>
              {isSavingUsername ? "Saving..." : "Start Playing"}
            </button>
          </div>
        </div>
      )}

      <div className="divisionwan">
        <div className='secwan' onClick={handleLogout} style={{cursor: 'pointer'}}>
          {username || "Guest"} (Logout)
        </div>
        <div className='sectwo'>DEATWIN</div>
        <div className='secthree'>
          <div className='deposit' onClick={isProcessing ? null : handleDeposit}>
            {isProcessing ? "..." : "+"}
          </div>
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

      {showMainModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="close-modal" onClick={() => {setShowMainModal(false); setCurrentRoom(null); setActiveSubModal(null);}}>X</div>
            
            {!activeSubModal && !currentRoom && (
              <div className="step">
                <h2>Choose Mode</h2>
                <button onClick={() => setActiveSubModal('private')}>Private Room</button>
                <button onClick={startPublicMatch}>Public Match</button>
              </div>
            )}

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

            {currentRoom && currentRoom.status === "waiting" && (
              <div className="step">
                <h2>Waiting for opponent...</h2>
                {currentRoom.roomCode && <h3>Code: {currentRoom.roomCode}</h3>}
              </div>
            )}

            {currentRoom && currentRoom.status === "negotiating" && (
              <div className="step">
                <h2>Negotiate Stake</h2>
                <div className="price-grid">
                  {[100, 500, 1000].map(p => (
                    <button 
                      key={p} 
                      className={currentRoom.votes && currentRoom.votes[user.uid] === p ? 'voted' : ''} 
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