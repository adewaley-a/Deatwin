import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from './firebase';
import { doc, onSnapshot, updateDoc, increment } from 'firebase/firestore';
import './GamePage.css';

function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [gameData, setGameData] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const canvasRef = useRef(null);
  
  const local = useRef({
    attacker: { x: 250, y: 700, hp: 400, angle: -Math.PI / 2 },
    shield: { x: 250, y: 650, hp: 150 },
    treasure: { x: 250, y: 750, hp: 200 },
    bullets: [],
    grenades: [],
    lastTap: 0,
    isCharging: false
  });

  const remote = useRef(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      const data = snap.data();
      if (!data) return;
      if (data.winner) {
        alert(`Game Over! Winner: ${data.winner}`);
        navigate('/');
      }
      setGameData(data);
      const hostFlag = data.hostId === "USER_ID"; // Use your actual Auth logic here
      setIsHost(hostFlag);
      remote.current = hostFlag ? data.guestState : data.hostState;
    });
    return () => unsubscribe();
  }, [roomId, navigate]);

  // --- DAMAGE LOGIC ---
  const applyDamage = async (target, amount, isHeal = false) => {
    const roomRef = doc(db, "rooms", roomId);
    const targetRole = isHost ? "guestState" : "hostState";
    const selfRole = isHost ? "hostState" : "guestState";

    if (isHeal) {
      // Treasure Box Lifesteal: Opponent shoots box, you get +2 HP
      await updateDoc(roomRef, { [`${selfRole}.attacker.hp`]: increment(amount) });
    } else {
      await updateDoc(roomRef, { [`${targetRole}.${target}.hp`]: increment(-amount) });
    }
  };

  const sync = async () => {
    const role = isHost ? "hostState" : "guestState";
    await updateDoc(doc(doc(db, "rooms", roomId)), {
      [role]: { ...local.current, bullets: [] } 
    });
  };

  // --- GAME LOOP ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let loop;

    const update = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const l = local.current;
      const r = remote.current;

      // 1. Bullet Collision Physics
      l.bullets.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;

        // Vertical Wall Bounce
        if (b.x < 0 || b.x > canvas.width) {
          b.vx *= -0.8;
          b.damage = Math.max(0, b.damage - 1);
        }

        // Collision with Remote (Simplified)
        if (r && b.y < 200) {
          // Check Shield Hit
          const distToShield = Math.sqrt((b.x - r.shield.x)**2 + (b.y - 100)**2);
          if (distToShield < 45) {
            applyDamage("shield", b.damage);
            l.bullets.splice(i, 1);
          } 
          // Check Treasure Hit (Lifesteal)
          else if (Math.abs(b.x - r.treasure.x) < 20 && b.y < 80) {
            applyDamage("treasure", b.damage);
            applyDamage("attacker", 2, true); // Heal self
            l.bullets.splice(i, 1);
          }
        }
      });

      // 2. Render Loop (Drawing sprites, health bars, and grenades)
      // [Drawing logic from previous step remains here]
      
      loop = requestAnimationFrame(update);
    };

    update();
    return () => cancelAnimationFrame(loop);
  }, [isHost]);

  return (
    <div className="game-screen" 
      onTouchStart={(e) => {
        const now = Date.now();
        if (now - local.current.lastTap < 300) local.current.isCharging = true;
        local.current.lastTap = now;
      }}
      onTouchEnd={() => {
        if (local.current.isCharging) {
          // Launch Grenade Logic
          sync();
        }
        local.current.isCharging = false;
      }}>
      <div className="hp-hud">
        <div className="bar"><div className="fill red" style={{width: `${(remote.current?.attacker.hp / 400) * 100}%`}}></div></div>
        <div className="bar"><div className="fill green" style={{width: `${(local.current.attacker.hp / 400) * 100}%`}}></div></div>
      </div>
      <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight - 120} />
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