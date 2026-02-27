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
    attacker: { x: 250, y: 700, hp: 400, angle: -Math.PI / 2 },
    shield: { x: 250, y: 650, hp: 150 },
    treasure: { x: 250, y: 750, hp: 200 },
    bullets: [],
    grenades: [],
    lastTap: 0,
    isCharging: false,
    shakeIntensity: 0 // For visual screen shake
  });

  const remote = useRef(null);

  // FIX: Removed 'opponentName' to resolve Netlify build error
  const checkVictory = useCallback(async (updatedData) => {
    const opponentState = isHost ? updatedData.guestState : updatedData.hostState;
    const localName = isHost ? updatedData.hostName : updatedData.guestName;

    if (opponentState.attacker.hp <= 0 && opponentState.treasure.hp <= 0) {
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
        alert(`GAME OVER! ${data.winner} is the Champion!`);
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

    // Trigger local shake effect
    local.current.shakeIntensity = 10;

    try {
      if (isHeal) {
        await updateDoc(roomRef, { [`${selfRole}.attacker.hp`]: increment(amount) });
      } else {
        const snap = await getDoc(roomRef);
        const currentHp = snap.data()[targetRole][target].hp;
        const newHp = Math.max(0, currentHp - amount);
        await updateDoc(roomRef, { [`${targetRole}.${target}.hp`]: newHp });
      }
    } catch (err) {
      console.error("Damage Sync Error:", err);
    }
  }, [isHost, roomId]);

  const sync = useCallback(async () => {
    const role = isHost ? "hostState" : "guestState";
    try {
      await updateDoc(doc(db, "rooms", roomId), {
        [role]: { 
          attacker: local.current.attacker,
          shield: local.current.shield,
          treasure: local.current.treasure,
          grenades: local.current.grenades
        } 
      });
    } catch (err) {
      console.error("Sync Error:", err);
    }
  }, [isHost, roomId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let loop;

    const update = () => {
      const l = local.current;
      const r = remote.current;

      // SCREEN SHAKE LOGIC
      ctx.save();
      if (l.shakeIntensity > 0) {
        const dx = (Math.random() - 0.5) * l.shakeIntensity;
        const dy = (Math.random() - 0.5) * l.shakeIntensity;
        ctx.translate(dx, dy);
        l.shakeIntensity *= 0.9; // Decay the shake
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Bullet Physics
      l.bullets.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        if (b.x < 0 || b.x > canvas.width) {
          b.vx *= -0.8;
          b.damage = Math.max(0, b.damage - 1);
        }
        if (r && b.y < 200) {
          const distToShield = Math.sqrt((b.x - r.shield.x)**2 + (b.y - 100)**2);
          if (distToShield < 45 && r.shield.hp > 0) {
            applyDamage("shield", b.damage);
            l.bullets.splice(i, 1);
          } else if (Math.abs(b.x - r.treasure.x) < 20 && b.y < 80) {
            applyDamage("treasure", b.damage);
            applyDamage("attacker", 2, true); 
            l.bullets.splice(i, 1);
          } else if (Math.abs(b.x - r.attacker.x) < 20 && b.y < 50) {
            applyDamage("attacker", b.damage);
            l.bullets.splice(i, 1);
          }
        }
      });

      // Rendering Attacker
      ctx.fillStyle = l.attacker.hp > 0 ? "#33ff33" : "#444";
      ctx.save();
      ctx.translate(l.attacker.x, l.attacker.y);
      ctx.rotate(l.attacker.angle);
      ctx.fillRect(0, -5, 40, 10);
      ctx.restore();

      ctx.restore(); // End Shake
      loop = requestAnimationFrame(update);
    };

    update();
    return () => cancelAnimationFrame(loop);
  }, [isHost, applyDamage]);

  return (
    <div className="game-screen" 
      onTouchStart={(e) => {
        const now = Date.now();
        if (now - local.current.lastTap < 300) local.current.isCharging = true;
        local.current.lastTap = now;
      }}
      onTouchEnd={() => {
        if (local.current.isCharging) sync();
        local.current.isCharging = false;
      }}>
      
      <div className="hp-hud">
        <div className="prize-display">₦{gameData?.prizePool || 0}</div>
        <div className="status-text">
            Opponent: {remote.current?.attacker.hp || 0} HP | {remote.current?.treasure.hp || 0} BOX
        </div>
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