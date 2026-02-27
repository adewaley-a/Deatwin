import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from './firebase';
import { doc, onSnapshot, updateDoc, increment, getDoc } from 'firebase/firestore';
import './GamePage.css';

const getUserId = () => {
  let id = localStorage.getItem('game_user_id');
  if (!id) {
    id = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('game_user_id', id);
  }
  return id;
};

function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [gameData, setGameData] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const canvasRef = useRef(null);
  const userId = useRef(getUserId());
  
  const local = useRef({
    attacker: { x: 200, y: 600, hp: 400, angle: -Math.PI / 2 },
    shield: { x: 200, y: 500, hp: 150 },
    treasure: { x: 200, y: 700, hp: 200 },
    bullets: [],
    lastTap: 0,
    isCharging: false,
    activeSprite: null,
    dragOffset: { x: 0, y: 0 }
  });

  const remote = useRef(null);

  const sync = useCallback(async () => {
    const role = isHost ? "hostState" : "guestState";
    try {
      await updateDoc(doc(db, "rooms", roomId), {
        [role]: { 
          attacker: local.current.attacker,
          shield: local.current.shield,
          treasure: local.current.treasure,
        } 
      });
    } catch (err) {
      console.error("Sync Error:", err);
    }
  }, [isHost, roomId]);

  const checkVictory = useCallback(async (updatedData) => {
    const opponentState = isHost ? updatedData.guestState : updatedData.hostState;
    const localName = isHost ? updatedData.hostName : updatedData.guestName;

    if (opponentState && opponentState.attacker.hp <= 0 && opponentState.treasure.hp <= 0) {
      await updateDoc(doc(db, "rooms", roomId), {
        winner: localName,
        status: "finished"
      });
    }
  }, [isHost, roomId]);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      const data = snap.data();
      if (!data) return;
      if (data.winner) {
        alert(`GAME OVER! ${data.winner} wins!`);
        navigate('/');
        return;
      }
      setGameData(data);
      const hostFlag = data.hostId === userId.current;
      setIsHost(hostFlag);
      remote.current = hostFlag ? data.guestState : data.hostState;
      checkVictory(data);
    });
    return () => unsubscribe();
  }, [roomId, navigate, checkVictory]);

  const applyDamage = useCallback(async (target, amount, isHeal = false) => {
    const roomRef = doc(db, "rooms", roomId);
    const targetRole = isHost ? "guestState" : "hostState";
    const selfRole = isHost ? "hostState" : "guestState";
    try {
      if (isHeal) {
        await updateDoc(roomRef, { [`${selfRole}.attacker.hp`]: increment(amount) });
      } else {
        const snap = await getDoc(roomRef);
        const currentData = snap.data();
        if (currentData && currentData[targetRole]) {
          const currentHp = currentData[targetRole][target].hp;
          await updateDoc(roomRef, { [`${targetRole}.${target}.hp`]: Math.max(0, currentHp - amount) });
        }
      }
    } catch (err) { console.error(err); }
  }, [isHost, roomId]);

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const tx = touch.clientX - rect.left;
    const ty = touch.clientY - rect.top;
    const l = local.current;

    const hit = (s, r) => Math.sqrt((tx - s.x)**2 + (ty - s.y)**2) < r;

    if (hit(l.attacker, 40)) l.activeSprite = 'attacker';
    else if (hit(l.shield, 50)) l.activeSprite = 'shield';
    else if (hit(l.treasure, 30)) l.activeSprite = 'treasure';

    if (l.activeSprite) {
      l.dragOffset.x = tx - l[l.activeSprite].x;
      l.dragOffset.y = ty - l[l.activeSprite].y;
    }
  };

  const handleTouchMove = (e) => {
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const l = local.current;
    const canvas = canvasRef.current;
    
    if (l.activeSprite) {
      let newX = (touch.clientX - rect.left) - l.dragOffset.x;
      let newY = (touch.clientY - rect.top) - l.dragOffset.y;

      // BOUNDARIES: Keep within player's bottom half
      newX = Math.max(30, Math.min(canvas.width - 30, newX));
      newY = Math.max(canvas.height / 2 + 50, Math.min(canvas.height - 30, newY));

      l[l.activeSprite].x = newX;
      l[l.activeSprite].y = newY;
    }
  };

  const handleTouchEnd = () => {
    if (local.current.activeSprite) {
      sync();
      local.current.activeSprite = null;
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let loop;

    const render = () => {
      const l = local.current;
      const r = remote.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // --- Draw Local ---
      ctx.beginPath();
      ctx.arc(l.shield.x, l.shield.y, 40, Math.PI, 0);
      ctx.strokeStyle = "#00f2ff"; ctx.lineWidth = 5; ctx.stroke();
      
      ctx.fillStyle = "#ffd700";
      ctx.fillRect(l.treasure.x - 15, l.treasure.y - 15, 30, 30);

      ctx.save();
      ctx.translate(l.attacker.x, l.attacker.y);
      ctx.rotate(l.attacker.angle);
      ctx.fillStyle = "#33ff33";
      ctx.fillRect(0, -5, 40, 10);
      ctx.restore();

      // --- Draw Remote (Opponent) ---
      if (r) {
        ctx.fillStyle = "red"; ctx.fillRect(r.attacker.x - 20, 50, 40, 20);
        ctx.beginPath(); ctx.arc(r.shield.x, 80, 40, 0, Math.PI);
        ctx.strokeStyle = "red"; ctx.stroke();
      }

      loop = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(loop);
  }, [isHost, applyDamage]);

  return (
    <div className="game-screen" 
      onTouchStart={handleTouchStart} 
      onTouchMove={handleTouchMove} 
      onTouchEnd={handleTouchEnd}>
      
      <div className="hp-hud">
        <div className="prize-display">₦{gameData?.prizePool || 0}</div>
        <div className="bar-container">
            <div className="bar"><div className="fill red" style={{width: `${(remote.current?.attacker.hp / 400) * 100}%`}}></div></div>
            <div className="bar"><div className="fill green" style={{width: `${(local.current.attacker.hp / 400) * 100}%`}}></div></div>
        </div>
      </div>

      <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight - 150} />
      
      <div className="controls">
        <input type="range" min="-3.14" max="0" step="0.01" onChange={(e) => {
          local.current.attacker.angle = parseFloat(e.target.value);
          sync();
        }} />
      </div>
    </div>
  );
}

export default GamePage;