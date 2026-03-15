import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com"; 

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  
  const [role, setRole] = useState(null); 
  const [gameState, setGameState] = useState(null);
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);

  const W = 400, H = 700;
  const MID = H / 2; 
  const GRENADE_RANGE = (H * 0.5) * 0.55;

  // Local Assets (Bottom Half)
  const myPos = useRef({ x: 100, y: 600, rot: 0 }); // Offset start
  const myBoxPos = useRef({ x: 200, y: 550 });
  const myShieldPos = useRef({ x: 300, y: 550 });

  // Opponent Assets (Mirrored)
  const oppPos = useRef({ x: 300, y: 100, rot: 0 });
  const oppBoxPos = useRef({ x: 200, y: 150 });
  const oppShieldPos = useRef({ x: 100, y: 150 });

  // Multi-touch & Combat Refs
  const touchMap = useRef(new Map()); 
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const particles = useRef([]);
  const grenades = useRef([]);
  const chargeTimer = useRef(null);
  const lastTap = useRef(0);

  useEffect(() => {
    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    const s = socket.current;
    s.emit("join_game", { roomId });
    
    s.on("assign_role", (data) => setRole(data.role));
    s.on("start_countdown", () => setCountdown(3));
    s.on("sync_all", (data) => {
      oppPos.current = { x: W - data.pos.x, y: H - data.pos.y, rot: -data.pos.rot };
      oppBoxPos.current = { x: W - data.box.x, y: H - data.box.y };
      oppShieldPos.current = { x: W - data.shield.x, y: H - data.shield.y };
    });
    s.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    s.on("incoming_grenade", (g) => grenades.current.push({ ...g, x: W - g.x, y: H - g.y, isOpp: true }));
    s.on("update_game_state", (data) => setGameState(data));

    return () => s.disconnect();
  }, [roomId, W, H]);

  const handleTouch = useCallback((e) => {
    if (!role || gameOver || (countdown !== null && countdown > 0)) return;
    const rect = canvasRef.current.getBoundingClientRect();

    Array.from(e.changedTouches).forEach(t => {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);

      if (e.type === "touchstart") {
        let target = null;
        if (Math.hypot(tx - myPos.current.x, ty - (myPos.current.y + 40)) < 40) target = 'wheel';
        else if (Math.hypot(tx - myBoxPos.current.x, ty - myBoxPos.current.y) < 40) target = 'box';
        else if (Math.hypot(tx - myShieldPos.current.x, ty - myShieldPos.current.y) < 40) target = 'shield';
        else if (Math.hypot(tx - myPos.current.x, ty - myPos.current.y) < 40) {
          target = 'player';
          const now = Date.now();
          if (now - lastTap.current < 300) {
            chargeTimer.current = setTimeout(() => {
              socket.current.emit("launch_grenade", { roomId, x: myPos.current.x, y: myPos.current.y - GRENADE_RANGE });
              grenades.current.push({ x: myPos.current.x, y: myPos.current.y - GRENADE_RANGE, timer: 60, isOpp: false });
            }, 2000);
          }
          lastTap.current = now;
        }
        touchMap.current.set(t.identifier, target);
      }

      if (e.type === "touchmove") {
        const target = touchMap.current.get(t.identifier);
        const cy = Math.max(MID + 40, ty);

        if (target === 'player') { myPos.current.x = tx; myPos.current.y = cy; }
        else if (target === 'box') { myBoxPos.current.x = tx; myBoxPos.current.y = cy; }
        else if (target === 'shield') { myShieldPos.current.x = tx; myShieldPos.current.y = cy; }
        else if (target === 'wheel') {
          const angle = Math.atan2(ty - myPos.current.y, tx - myPos.current.x) + Math.PI/2;
          myPos.current.rot = Math.max(-1.22, Math.min(1.22, angle));
        }

        socket.current.emit("client_movement", { roomId, pos: myPos.current, box: myBoxPos.current, shield: myShieldPos.current });
      }

      if (e.type === "touchend") {
        if (touchMap.current.get(t.identifier) === 'player') clearTimeout(chargeTimer.current);
        touchMap.current.delete(t.identifier);
      }
    });
  }, [role, gameOver, countdown, roomId, MID, W, H, GRENADE_RANGE]);

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const render = (time) => {
      ctx.clearRect(0, 0, W, H);
      
      // Draw Midline
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.beginPath(); ctx.moveTo(0, MID); ctx.lineTo(W, MID); ctx.stroke();

      const drawAsset = (x, y, hp, maxHp, color, type, rot = 0) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.fillStyle = color;
        if (type === 'box') {
          const glow = Math.sin(time / 200) * 10 + 10;
          ctx.shadowBlur = glow; ctx.shadowColor = color;
          ctx.fillRect(-20, -20, 40, 40);
        } else if (type === 'shield') {
          ctx.beginPath(); ctx.arc(0, 0, 30, Math.PI, 0); ctx.lineWidth = 5; ctx.strokeStyle = color; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(-15, 10); ctx.lineTo(15, 10); ctx.fill();
          // Steering Wheel
          ctx.beginPath(); ctx.arc(0, 40, 10, 0, Math.PI*2); ctx.strokeStyle = "white"; ctx.stroke();
        }
        ctx.restore();
        // HP Bar
        ctx.fillStyle = "#222"; ctx.fillRect(x - 20, y + 35, 40, 4);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y + 35, (Math.max(0, hp)/maxHp) * 40, 4);
      };

      if (gameState) {
        const myId = socket.current.id;
        const oppId = role === 'host' ? gameState.guest : gameState.host;
        drawAsset(myPos.current.x, myPos.current.y, gameState.health[myId], 400, "#00f2ff", 'player', myPos.current.rot);
        drawAsset(myBoxPos.current.x, myBoxPos.current.y, gameState.entities[myId].boxHp, 200, "#e1ff00", 'box');
        drawAsset(myShieldPos.current.x, myShieldPos.current.y, gameState.entities[myId].shieldHp, 200, "#00ff88", 'shield');
        
        drawAsset(oppPos.current.x, oppPos.current.y, gameState.health[oppId], 400, "#ff3e3e", 'player', oppPos.current.rot);
        drawAsset(oppBoxPos.current.x, oppBoxPos.current.y, gameState.entities[oppId].boxHp, 200, "#ffaa00", 'box');
        drawAsset(oppShieldPos.current.x, oppShieldPos.current.y, gameState.entities[oppId].shieldHp, 200, "#ff0066", 'shield');
      }

      // Grenade Physics
      grenades.current.forEach((g, i) => {
        g.timer--;
        if (g.timer <= 0) {
          // Explosion logic handled via damage_entity
          if (!g.isOpp) socket.current.emit("grenade_explosion", { roomId, x: g.x, y: g.y });
          grenades.current.splice(i, 1);
        }
        ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(g.x, g.y, 8, 0, Math.PI*2); ctx.fill();
      });

      // Bullet Hit detection
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI*2); ctx.fill();
        const hit = (target, type) => {
          if (Math.hypot(b.x - target.x, b.y - target.y) < 30) {
            socket.current.emit("damage_entity", { roomId, type, targetId: 'opponent' });
            for(let j=0; j<5; j++) particles.current.push({x: b.x, y: b.y, vx: (Math.random()-0.5)*5, vy: (Math.random()-0.5)*5, life: 20});
            myBullets.current.splice(i, 1);
          }
        };
        hit(oppBoxPos.current, 'box'); hit(oppShieldPos.current, 'shield'); hit(oppPos.current, 'player');
      });

      // Particles
      particles.current.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy; p.life--;
        ctx.fillStyle = `rgba(255,255,255,${p.life/20})`; ctx.fillRect(p.x, p.y, 2, 2);
        if (p.life <= 0) particles.current.splice(i, 1);
      });

      frame = requestAnimationFrame(render);
    };
    render(0); return () => cancelAnimationFrame(frame);
  }, [role, gameState, MID, W, H, roomId]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const vx = Math.sin(myPos.current.rot) * 20;
      const vy = -Math.cos(myPos.current.rot) * 20;
      myBullets.current.push({ x: myPos.current.x, y: myPos.current.y, vx, vy });
      socket.current.emit("fire", { roomId, x: W - myPos.current.x, y: H - myPos.current.y, vx: -vx, vy: -vy });
    }, 150); // Faster fire rate
    return () => clearInterval(fireInt);
  }, [role, countdown, gameOver, roomId, W, H]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <canvas ref={canvasRef} width={W} height={H} />
      {gameState && <div className="lifesteal-popup">+5HP</div>}
    </div>
  );
}