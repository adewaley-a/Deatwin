import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { db } from './firebase';
import { doc, onSnapshot } from 'firebase/firestore';

function GamePage() {
  const { roomId } = useParams();
  const [gameData, setGameData] = useState(null);

  useEffect(() => {
    // Listen to the room for moves and game state
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      setGameData(snap.data());
    });
    return () => unsubscribe();
  }, [roomId]);

  if (!gameData) return <div>Loading Game...</div>;

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>Game Started!</h1>
      <h2>Prize Pool: ₦{gameData.prizePool}</h2>
      <p>Host: {gameData.hostName} vs Guest: {gameData.guestName}</p>
      {/* Your game board (X/O, Ludo, etc.) goes here */}
    </div>
  );
}

export default GamePage;