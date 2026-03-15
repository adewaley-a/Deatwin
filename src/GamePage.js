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

  const W = 400, H = 800; 
  const myShooter = useRef({ x: 200, y: 700 });
  const myShield = useRef({ x: 200, y: 600 });
  const myBox = useRef({ x: 200, y: 750 });
  
  const enemyShooter = useRef({ x: 200, y: 100 });
  const enemyShield = useRef({ x: 200, y: 200 });
  const enemyBox = useRef({ x: 200, y: 50 });

  const dragging = useRef(null);
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]);

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

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const b = { x: myShooter.current.x, y: myShooter.current.y - 40, vx: 0, vy: -18 };
      myBullets.current.push(b);
      socket.current.emit("fire", { roomId, x: W - b.x, y: H - b.y, vx: 0, vy: 18 });
    }, 180); 
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.changedTouches[0];
    const tx = (t.clientX - rect.left) * (W / rect.width);
    const ty = (t.clientY - rect.top) * (H / rect.height);

    if (e.type === "touchstart") {
      if (Math.hypot(tx - myShooter.current.x, ty - myShooter.current.y) < 40) dragging.current = "shooter";
      else if (Math.hypot(tx - myShield.current.x, ty - myShield.current.y) < 50 && shieldHealth[role] > 0) dragging.current = "shield";
      else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 40 && boxHealth[role] > 0) dragging.current = "box";
    }

    if (e.type === "touchmove" && dragging.current) {
      const target = dragging.current === "shooter" ? myShooter : dragging.current === "shield" ? myShield : myBox;
      target.current.x = Math.max(30, Math.min(W - 30, tx));
      target.current.y = Math.max(H / 2 + 40, Math.min(H - 30, ty));

      socket.current.emit("move_all", { 
        roomId, 
        shooter: { x: W - myShooter.current.x, y: H - myShooter.current.y },
        shield: { x: W - myShield.current.x, y: H - myShield.current.y },
        box: { x: W - myBox.current.x, y: H - myBox.current.y }
      });
    }

    if (e.type === "touchend") dragging.current = null;
  };

  const createSparks = (x, y, color) => {
    for(let i=0; i<8; i++) {
      sparks.current.push({ x, y, vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10, alpha: 1, color });
    }
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      // Perfect Center Demarcation
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
      ctx.setLineDash([]);

      const oppRole = role === 'host' ? 'guest' : 'host';

      // Draw Treasure Boxes
      const drawBox = (pos, color, hp) => {
        if (hp <= 0) return;
        ctx.fillStyle = color; ctx.fillRect(pos.x - 25, pos.y - 25, 50, 50);
        ctx.strokeStyle = "white"; ctx.strokeRect(pos.x - 25, pos.y - 25, 50, 50);
      };
      drawBox(myBox.current, "#00f2ff", boxHealth[role]);
      drawBox(enemyBox.current, "#ff3e3e", boxHealth[oppRole]);

      // Draw Shields
      const drawShield = (pos, color, hp, isEnemy) => {
        if (hp <= 0) return;
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath();
        const start = isEnemy ? 0.25 : -0.75;
        const end = isEnemy ? 0.75 : -0.25;
        ctx.arc(pos.x, pos.y, 60, Math.PI * start, Math.PI * end); ctx.stroke();
      };
      drawShield(myShield.current, "#00f2ff", shieldHealth[role], false);
      drawShield(enemyShield.current, "#ff3e3e", shieldHealth[oppRole], true);

      // Bullets & Sparks
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        if (boxHealth[oppRole] > 0 && Math.abs(b.x - enemyBox.current.x) < 30 && Math.abs(b.y - enemyBox.current.y) < 30) {
          createSparks(b.x, b.y, "#ffeb3b");
          socket.current.emit("take_damage", { roomId, target: 'box', victimRole: oppRole });
          myBullets.current.splice(i, 1);
        }
        if (b.y < -10) myBullets.current.splice(i, 1);
      });

      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        const dist = Math.hypot(b.x - myShield.current.x, b.y - myShield.current.y);
        const angle = Math.atan2(b.y - myShield.current.y, b.x - myShield.current.x);
        if (shieldHealth[role] > 0 && dist > 55 && dist < 70 && Math.abs(angle + Math.PI/2) < 0.8) {
          createSparks(b.x, b.y, "#00f2ff");
          socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: role });
          enemyBullets.current.splice(i, 1);
        }
      });

      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.alpha -= 0.04;
        ctx.fillStyle = s.color; ctx.globalAlpha = s.alpha;
        ctx.fillRect(s.x, s.y, 3, 3);
        if (s.alpha <= 0) sparks.current.splice(i, 1);
      });
      ctx.globalAlpha = 1;

      // Draw Shooters
      const drawTri = (pos, color, isEnemy) => {
        ctx.save(); ctx.translate(pos.x, pos.y);
        ctx.fillStyle = color; ctx.beginPath();
        if (isEnemy) { ctx.moveTo(0, 30); ctx.lineTo(-15, -10); ctx.lineTo(15, -10); }
        else { ctx.moveTo(0, -30); ctx.lineTo(-15, 10); ctx.lineTo(15, 10); }
        ctx.fill(); ctx.restore();
      };
      drawTri(myShooter.current, "#00f2ff", false);
      drawTri(enemyShooter.current, "#ff3e3e", true);

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