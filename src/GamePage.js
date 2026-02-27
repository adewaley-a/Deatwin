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
    attacker: { x: 300, y: 700, hp: 400, angle: -Math.PI / 2 },
    shield: { x: 250, y: 600, hp: 150 },
    treasure: { x: 100, y: 750, hp: 200 },
    bullets: [],
    grenades: [],
    lastTap: 0,
    isCharging: false,
    activeSprite: null,
    dragOffset: { x: 0, y: 0 }
  });

  const remote = useRef(null);

  // Syncs movement to Firebase so the opponent sees it
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
    } catch (err) { console.error("Sync Error:", err); }
  }, [isHost, roomId]);

  // Handle Real-time Listeners
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      const data = snap.data();
      if (!data) return;
      if (data.winner) { alert(`${data.winner} Wins!`); navigate('/'); return; }
      setGameData(data);
      const hostFlag = data.hostId === userId.current;
      setIsHost(hostFlag);
      // Remote data is the "other" player's state
      remote.current = hostFlag ? data.guestState : data.hostState;
    });
    return () => unsubscribe();
  }, [roomId, navigate]);

  // Automatic Bullet Firing (Constantly unless charging grenade)
  useEffect(() => {
    const interval = setInterval(() => {
      const l = local.current;
      if (!l.isCharging && l.attacker.hp > 0) {
        l.bullets.push({
          x: l.attacker.x,
          y: l.attacker.y,
          vx: Math.cos(l.attacker.angle) * 8,
          vy: Math.sin(l.attacker.angle) * 8,
          active: true
        });
      }
    }, 400); // Shoot every 400ms
    return () => clearInterval(interval);
  }, []);

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const tx = touch.clientX - rect.left;
    const ty = touch.clientY - rect.top;
    const l = local.current;

    const hit = (s, r) => Math.sqrt((tx - s.x)**2 + (ty - s.y)**2) < r;

    if (hit(l.attacker, 50)) l.activeSprite = 'attacker';
    else if (hit(l.shield, 60)) l.activeSprite = 'shield';
    else if (hit(l.treasure, 40)) l.activeSprite = 'treasure';

    if (l.activeSprite) {
      l.dragOffset.x = tx - l[l.activeSprite].x;
      l.dragOffset.y = ty - l[l.activeSprite].y;
    }

    const now = Date.now();
    if (now - l.lastTap < 300 && l.activeSprite === 'attacker') l.isCharging = true;
    l.lastTap = now;
  };

  const handleTouchMove = (e) => {
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const l = local.current;
    if (l.activeSprite) {
      const tx = touch.clientX - rect.left;
      const ty = touch.clientY - rect.top;
      l[l.activeSprite].x = tx - l.dragOffset.x;
      l[l.activeSprite].y = ty - l.dragOffset.y;
      sync(); // Real-time sync of dragging
    }
  };

  const handleTouchEnd = () => {
    if (local.current.isCharging) {
      // Logic for throwing grenade would go here
      local.current.isCharging = false;
    }
    local.current.activeSprite = null;
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

      // --- 1. DRAW REMOTE OPPONENT (Mirrored at Top) ---
      if (r) {
        // Opponent Attacker (Flipped Y)
        ctx.fillStyle = "red";
        ctx.fillRect(r.attacker.x - 20, H - r.attacker.y - 20, 40, 40);
        
        // Opponent Shield (Flipped Arc)
        ctx.beginPath();
        ctx.arc(r.shield.x, H - r.shield.y, 50, 0, Math.PI);
        ctx.strokeStyle = "red"; ctx.lineWidth = 4; ctx.stroke();

        // Opponent Treasure
        ctx.strokeRect(r.treasure.x - 20, H - r.treasure.y - 20, 40, 40);
      }

      // --- 2. DRAW LOCAL PLAYER (Bottom) ---
      // Curved Shield
      ctx.beginPath();
      ctx.arc(l.shield.x, l.shield.y, 50, Math.PI, 0);
      ctx.strokeStyle = "#00f2ff"; ctx.lineWidth = 5; ctx.stroke();

      // Treasure Box
      ctx.fillStyle = "#ffd700";
      ctx.fillRect(l.treasure.x - 25, l.treasure.y - 15, 50, 30);

      // Attacker Turret
      ctx.save();
      ctx.translate(l.attacker.x, l.attacker.y);
      ctx.rotate(l.attacker.angle);
      ctx.fillStyle = l.isCharging ? "orange" : "#33ff33";
      ctx.fillRect(0, -10, 50, 20); // The barrel
      ctx.restore();

      // Bullets
      l.bullets.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "white";
        ctx.fillRect(b.x - 2, b.y - 2, 4, 10);
        if (b.y < 0) l.bullets.splice(i, 1);
      });

      loop = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(loop);
  }, []);

  return (
    <div className="game-screen" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="hp-header">
         {/* HP Bars per your sketch */}
         <div className="player-stats">Player A: {local.current.attacker.hp}HP | {local.current.treasure.hp}HP</div>
         <div className="player-stats">Player B: {remote.current?.attacker.hp || 400}HP | {remote.current?.treasure.hp || 200}HP</div>
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