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
  const [showVictory, setShowVictory] = useState(false);
  const canvasRef = useRef(null);
  const userId = useRef(getUserId());
  
  const local = useRef({
    attacker: { x: 200, y: 700, hp: 400, angle: -Math.PI / 2 },
    shield: { x: 200, y: 600, hp: 150 },
    treasure: { x: 100, y: 750, hp: 200 },
    bullets: [],
    charge: 0,
    isCharging: false,
    activeSprite: null,
    dragOffset: { x: 0, y: 0 }
  });

  const remote = useRef(null);

  const applyDamage = useCallback(async (target, amount, isHeal = false) => {
    const roomRef = doc(db, "rooms", roomId);
    const targetRole = isHost ? "guestState" : "hostState";
    const selfRole = isHost ? "hostState" : "guestState";
    try {
      if (isHeal) {
        await updateDoc(roomRef, { [`${selfRole}.attacker.hp`]: increment(amount) });
      } else {
        const snap = await getDoc(roomRef);
        const data = snap.data();
        if (!data || !data[targetRole]) return;
        const currentHp = data[targetRole][target].hp;
        const newHp = Math.max(0, currentHp - amount);
        await updateDoc(roomRef, { [`${targetRole}.${target}.hp`]: newHp });
      }
    } catch (err) { console.error("Damage Error:", err); }
  }, [isHost, roomId]);

  const sync = useCallback(async () => {
    const role = isHost ? "hostState" : "guestState";
    await updateDoc(doc(db, "rooms", roomId), {
      [role]: { 
        attacker: local.current.attacker,
        shield: local.current.shield,
        treasure: local.current.treasure
      } 
    });
  }, [isHost, roomId]);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      const data = snap.data();
      if (!data) return;
      setGameData(data);
      if (data.status === "finished") setShowVictory(true);
      
      const hostFlag = data.hostId === userId.current;
      setIsHost(hostFlag);
      
      // CRITICAL: Update remote ref whenever Firestore data changes
      remote.current = hostFlag ? data.guestState : data.hostState;

      const myState = hostFlag ? data.hostState : data.guestState;
      if (myState && myState.attacker.hp <= 0 && myState.treasure.hp <= 0 && data.status !== "finished") {
        updateDoc(doc(db, "rooms", roomId), { status: "finished", winner: hostFlag ? (data.guestName || "Guest") : (data.hostName || "Host") });
      }
    });
    return () => unsubscribe();
  }, [roomId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const l = local.current;
      if (l.isCharging) {
        l.charge = Math.min(100, l.charge + 10);
      } else if (l.attacker.hp > 0) {
        l.bullets.push({
          x: l.attacker.x, y: l.attacker.y,
          vx: Math.cos(l.attacker.angle) * 12,
          vy: Math.sin(l.attacker.angle) * 12,
          active: true, damage: 5
        });
      }
    }, 300);
    return () => clearInterval(interval);
  }, []);

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const tx = touch.clientX - rect.left;
    const ty = touch.clientY - rect.top;
    const l = local.current;
    const hit = (s, r) => Math.sqrt((tx - s.x)**2 + (ty - s.y)**2) < r;

    if (hit(l.attacker, 50)) { l.isCharging = true; l.charge = 0; }
    else if (hit(l.shield, 60)) l.activeSprite = 'shield';
    else if (hit(l.treasure, 40)) l.activeSprite = 'treasure';

    if (l.activeSprite) {
      l.dragOffset.x = tx - l[l.activeSprite].x;
      l.dragOffset.y = ty - l[l.activeSprite].y;
    }
  };

  const handleTouchEnd = () => {
    const l = local.current;
    if (l.isCharging && l.charge >= 50) {
      l.bullets.push({
        x: l.attacker.x, y: l.attacker.y,
        vx: Math.cos(l.attacker.angle) * 15,
        vy: Math.sin(l.attacker.angle) * 15,
        active: true, damage: 40, isGrenade: true
      });
    }
    l.isCharging = false;
    l.charge = 0;
    l.activeSprite = null;
    sync();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let loop;

    const render = () => {
      const l = local.current;
      const r = remote.current;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Draw Opponent (Mirrored Top)
      if (r && r.attacker) {
        l.bullets.forEach((b) => {
          if (!b.active) return;
          const oppShieldY = H - r.shield.y;
          const oppTreasureY = H - r.treasure.y;
          const oppAttackerY = H - r.attacker.y;

          if (Math.sqrt((b.x - r.shield.x)**2 + (b.y - oppShieldY)**2) < 50 && r.shield.hp > 0) {
            applyDamage("shield", b.damage); b.active = false;
          } 
          else if (Math.abs(b.x - r.treasure.x) < 30 && Math.abs(b.y - oppTreasureY) < 20 && r.treasure.hp > 0) {
            applyDamage("treasure", b.damage);
            applyDamage("attacker", 5, true); 
            b.active = false;
          }
          else if (Math.abs(b.x - r.attacker.x) < 25 && Math.abs(b.y - oppAttackerY) < 25) {
            applyDamage("attacker", b.damage); b.active = false;
          }
        });

        ctx.strokeStyle = r.shield.hp > 0 ? "red" : "transparent";
        ctx.beginPath(); ctx.arc(r.shield.x, H - r.shield.y, 50, 0, Math.PI); ctx.stroke();
        ctx.fillStyle = r.treasure.hp > 0 ? "#550000" : "transparent";
        ctx.fillRect(r.treasure.x - 20, H - r.treasure.y - 20, 40, 40);
        ctx.fillStyle = "red"; ctx.fillRect(r.attacker.x - 20, H - r.attacker.y - 20, 40, 40);
      }

      // Draw Local
      ctx.beginPath(); ctx.arc(l.shield.x, l.shield.y, 50, Math.PI, 0);
      ctx.strokeStyle = "#00f2ff"; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = "#ffd700"; ctx.fillRect(l.treasure.x - 25, l.treasure.y - 15, 50, 30);
      
      ctx.save();
      ctx.translate(l.attacker.x, l.attacker.y);
      ctx.rotate(l.attacker.angle);
      ctx.fillStyle = l.isCharging ? `rgb(255, ${255 - l.charge * 2}, 0)` : "#33ff33";
      ctx.fillRect(0, -10, 50, 20);
      ctx.restore();

      if (l.isCharging) {
        ctx.fillStyle = "white"; ctx.fillRect(l.attacker.x - 25, l.attacker.y + 35, l.charge / 2, 6);
      }

      l.bullets = l.bullets.filter(b => b.active && b.y > 0 && b.y < H);
      l.bullets.forEach(b => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = b.isGrenade ? "orange" : "white";
        ctx.beginPath(); ctx.arc(b.x, b.y, b.isGrenade ? 8 : 3, 0, Math.PI * 2); ctx.fill();
      });

      loop = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(loop);
  }, [applyDamage, isHost]);

  return (
    <div className="game-screen" onTouchStart={handleTouchStart} 
         onTouchMove={(e) => {
            const touch = e.touches[0];
            const rect = canvasRef.current.getBoundingClientRect();
            if (local.current.activeSprite) {
              local.current[local.current.activeSprite].x = touch.clientX - rect.left - local.current.dragOffset.x;
              local.current[local.current.activeSprite].y = touch.clientY - rect.top - local.current.dragOffset.y;
              sync(); // Sync in real-time as we move
            }
         }} 
         onTouchEnd={handleTouchEnd}>
      
      {showVictory && (
        <div className="victory-overlay">
          <h1>GAME OVER</h1>
          <p>Champion: {gameData?.winner}</p>
          <h2 className="prize-won">₦{gameData?.prizePool} Won!</h2>
          <button onClick={() => navigate('/')}>Return to Lobby</button>
        </div>
      )}

      <div className="hp-header">
         <div className="prize-display">PRIZE: ₦{gameData?.prizePool}</div>
         <div className="player-stats-row">
            <span>MY HP: {gameData?.[isHost ? 'hostState' : 'guestState']?.attacker.hp || 0}</span>
            <span>OPPONENT HP: {remote.current?.attacker.hp || 0}</span>
         </div>
      </div>

      <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight - 150} />

      <div className="angle-control">
        <input type="range" min="-3.14" max="0" step="0.01" value={local.current.attacker.angle}
               onChange={(e) => { local.current.attacker.angle = parseFloat(e.target.value); sync(); }} />
      </div>
    </div>
  );
}

export default GamePage;