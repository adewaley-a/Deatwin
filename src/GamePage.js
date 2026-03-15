import React, { useEffect, useRef, useState } from "react";
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
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [overHealth, setOverHealth] = useState({ host: 0, guest: 0 });
  const [boxHealth, setBoxHealth] = useState({ host: 200, guest: 200 });
  const [shieldHealth, setShieldHealth] = useState({ host: 200, guest: 200 });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [showHeal, setShowHeal] = useState(false);

  const W = 400, H = 700; 
  // Randomized Start Positions
  const myShooter = useRef({ x: 50 + Math.random() * 300, y: 620, rot: 0 });
  const myShield = useRef({ x: 50 + Math.random() * 300, y: 530 });
  const myBox = useRef({ x: 50 + Math.random() * 300, y: 660 });
  
  const enemyShooter = useRef({ x: 200, y: 80, rot: 0 });
  const enemyShield = useRef({ x: 200, y: 170 });
  const enemyBox = useRef({ x: 200, y: 40 });

  const activeTouches = useRef(new Map()); // Supports Multi-Touch
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]);
  const shimmer = useRef(0);

  useEffect(() => {
    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current.emit("join_game", { roomId });
    socket.current.on("assign_role", (data) => setRole(data.role));
    socket.current.on("start_countdown", () => setCountdown(3));
    
    socket.current.on("opp_move_all", (data) => {
      enemyShooter.current = data.shooter;
      enemyShield.current = data.shield;
      enemyBox.current = data.box;
    });

    socket.current.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    
    socket.current.on("update_game_state", (data) => {
      if (data.targetHit === 'box' && data.attacker === socket.current.id) {
        setShowHeal(true);
        setTimeout(() => setShowHeal(false), 600);
      }
      setHealth(data.health);
      setOverHealth(data.overHealth);
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const iWon = socket.current.id === (data.health.host <= 0 ? data.guest : data.host);
        setGameOver(iWon ? "win" : "lose");
      }
    });

    return () => socket.current.disconnect();
  }, [roomId]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Higher Bullet Rate
  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const vx = Math.sin(myShooter.current.rot) * 18;
      const vy = -Math.cos(myShooter.current.rot) * 18;
      const b = { x: myShooter.current.x, y: myShooter.current.y - 40, vx, vy };
      myBullets.current.push(b);
      socket.current.emit("fire", { roomId, x: W - b.x, y: H - b.y, vx: -vx, vy: -vy });
    }, 120); 
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const createSparks = (x, y, color) => {
    for(let i=0; i<6; i++) {
      sparks.current.push({ x, y, vx: (Math.random()-0.5)*8, vy: (Math.random()-0.5)*8, alpha: 1, color });
    }
  };

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    
    Array.from(e.changedTouches).forEach(t => {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);

      if (e.type === "touchstart") {
        let id = null;
        if (Math.hypot(tx - myShooter.current.x, ty - (myShooter.current.y + 50)) < 40) id = "wheel";
        else if (Math.hypot(tx - myShooter.current.x, ty - myShooter.current.y) < 45) id = "shooter";
        else if (Math.hypot(tx - myShield.current.x, ty - myShield.current.y) < 65 && shieldHealth[role] > 0) id = "shield";
        else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 45 && boxHealth[role] > 0) id = "box";
        
        if (id) activeTouches.current.set(t.identifier, id);
      }

      if (e.type === "touchmove") {
        const draggingId = activeTouches.current.get(t.identifier);
        if (!draggingId) return;

        if (draggingId === "wheel") {
          myShooter.current.rot = Math.max(-1.22, Math.min(1.22, (tx - myShooter.current.x) / 40)); 
        } else {
          const target = draggingId === "shooter" ? myShooter : draggingId === "shield" ? myShield : myBox;
          target.current.x = Math.max(30, Math.min(W - 30, tx));
          target.current.y = Math.max(H / 2 + 45, Math.min(H - 35, ty));
        }

        socket.current.emit("move_all", { 
          roomId, 
          shooter: { x: W - myShooter.current.x, y: H - myShooter.current.y, rot: -myShooter.current.rot },
          shield: { x: W - myShield.current.x, y: H - myShield.current.y },
          box: { x: W - myBox.current.x, y: H - myBox.current.y }
        });
      }

      if (e.type === "touchend" || e.type === "touchcancel") {
        activeTouches.current.delete(t.identifier);
      }
    });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      shimmer.current += 0.05;
      const opp = role === 'host' ? 'guest' : 'host';

      // Demarcation
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.setLineDash([10, 5]);
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
      ctx.setLineDash([]);

      const drawMiniBar = (x, y, val, max, color) => {
        ctx.fillStyle = "#111"; ctx.fillRect(x - 20, y - 40, 40, 4);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y - 40, (val/max)*40, 4);
      };

      // Draw Boxes
      const drawBox = (pos, color, hp) => {
        if (hp <= 0) return;
        ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = color; ctx.fillStyle = color;
        ctx.fillRect(pos.x - 25, pos.y - 25, 50, 50); ctx.restore();
        drawMiniBar(pos.x, pos.y, hp, 200, color);
      };
      drawBox(myBox.current, "#00f2ff", boxHealth[role]);
      drawBox(enemyBox.current, "#ff3e3e", boxHealth[opp]);

      // Draw Shields
      const drawShield = (pos, color, hp, isEnemy) => {
        if (hp <= 0) return;
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath();
        const s = isEnemy ? 0.25 : -0.75; const e = isEnemy ? 0.75 : -0.25;
        ctx.arc(pos.x, pos.y, 60, Math.PI * s, Math.PI * e); ctx.stroke();
        drawMiniBar(pos.x, pos.y + (isEnemy ? 45 : -45), hp, 200, color);
      };
      drawShield(myShield.current, "#00f2ff", shieldHealth[role], false);
      drawShield(enemyShield.current, "#ff3e3e", shieldHealth[opp], true);

      // Bullet Physics & Collision
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        
        // Hit Enemy Box
        if (boxHealth[opp] > 0 && Math.abs(b.x - enemyBox.current.x) < 28 && Math.abs(b.y - enemyBox.current.y) < 28) {
          createSparks(b.x, b.y, "#ffeb3b");
          socket.current.emit("take_damage", { roomId, target: 'box', victimRole: opp });
          myBullets.current.splice(i, 1);
        }
        // Hit Enemy Shooter
        else if (Math.abs(b.x - enemyShooter.current.x) < 20 && Math.abs(b.y - enemyShooter.current.y) < 35) {
            createSparks(b.x, b.y, "#ff3e3e");
            socket.current.emit("take_damage", { roomId, target: 'player', victimRole: opp });
            myBullets.current.splice(i, 1);
        }
        if (b.y < -50 || b.y > H + 50) myBullets.current.splice(i, 1);
      });

      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        
        // Hit My Shield
        const dist = Math.hypot(b.x - myShield.current.x, b.y - myShield.current.y);
        const angle = Math.atan2(b.y - myShield.current.y, b.x - myShield.current.x);
        if (shieldHealth[role] > 0 && dist > 55 && dist < 70 && Math.abs(angle + Math.PI/2) < 0.8) {
          createSparks(b.x, b.y, "#00f2ff");
          socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: role });
          enemyBullets.current.splice(i, 1);
        }
        // Hit My Shooter
        else if (Math.abs(b.x - myShooter.current.x) < 20 && Math.abs(b.y - myShooter.current.y) < 35) {
            createSparks(b.x, b.y, "#00f2ff");
            socket.current.emit("take_damage", { roomId, target: 'player', victimRole: role });
            enemyBullets.current.splice(i, 1);
        }
        // Hit My Box (Blocker)
        else if (boxHealth[role] > 0 && Math.abs(b.x - myBox.current.x) < 28 && Math.abs(b.y - myBox.current.y) < 28) {
            createSparks(b.x, b.y, "#ffeb3b");
            enemyBullets.current.splice(i, 1);
        }
      });

      // Sparks
      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.alpha -= 0.05;
        ctx.fillStyle = s.color; ctx.globalAlpha = Math.max(0, s.alpha);
        ctx.fillRect(s.x, s.y, 2, 2);
        if (s.alpha <= 0) sparks.current.splice(i, 1);
      });
      ctx.globalAlpha = 1.0;

      // Draw Shooters
      const drawPlayerGroup = (pos, color, isEnemy) => {
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(pos.rot || 0);
        ctx.fillStyle = color; ctx.beginPath();
        if (isEnemy) { ctx.moveTo(0, 30); ctx.lineTo(-15, -10); ctx.lineTo(15, -10); }
        else { ctx.moveTo(0, -30); ctx.lineTo(-15, 10); ctx.lineTo(15, 10); }
        ctx.fill(); ctx.restore();
        // Wheel
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pos.x, pos.y + (isEnemy ? -50 : 50), 18, 0, Math.PI*2); ctx.stroke();
      };
      drawPlayerGroup(myShooter.current, "#00f2ff", false);
      drawPlayerGroup(enemyShooter.current, "#ff3e3e", true);

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, roomId, boxHealth, shieldHealth]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">ENEMY</span>
          <div className="mini-hp">
            <div className="fill red" style={{width: `${(health[role==='host'?'guest':'host']/400)*100}%`}}/>
            <div className="fill shield" style={{width: `${(overHealth[role==='host'?'guest':'host']/200)*100}%`}}/>
          </div>
        </div>
        <div className="stat-box">
          <span className="name">YOU</span>
          <div className="mini-hp">
            <div className="fill blue" style={{width: `${(health[role]/400)*100}%`}}/>
            <div className="fill shield" style={{width: `${(overHealth[role]/200)*100}%`}}/>
            {showHeal && <div className="heal-popup">+5 HP</div>}
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}