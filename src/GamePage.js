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
  const [grenades, setGrenades] = useState({ host: 2, guest: 2 });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [showHeal, setShowHeal] = useState(false);
  const [muzzle, setMuzzle] = useState(false);

  const W = 400, H = 700;
  const myPos = useRef({ x: 200, y: 600 });
  const myRot = useRef(0);
  // REF for real-time movement (No interpolation)
  const enemyPos = useRef({ x: 200, y: 100, rot: 0 });
  
  const lastTap = useRef(0);
  const grenadeTimer = useRef(null);
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const activeGrenades = useRef([]);
  const activeExplosions = useRef([]);

  useEffect(() => {
    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current.emit("join_game", { roomId });
    
    socket.current.on("assign_role", (data) => setRole(data.role));
    
    socket.current.on("start_countdown", () => setCountdown(3));

    socket.current.on("opp_move", (d) => {
      // Direct ref update for zero-lag observation
      enemyPos.current.x = d.x;
      enemyPos.current.y = d.y;
      enemyPos.current.rot = d.rot;
    });

    socket.current.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    
    socket.current.on("update_game_state", (data) => {
      if (data.targetHit === 'box' && data.attacker === socket.current.id) {
        setShowHeal(true);
        setTimeout(() => setShowHeal(false), 800);
      }
      setHealth(data.health);
      setOverHealth(data.overHealth || { host: 0, guest: 0 });
      setGrenades(data.grenades);
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const iWon = socket.current.role === 'host' ? data.health.guest <= 0 : data.health.host <= 0;
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

  // Shooting Loop
  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const angle = myRot.current;
      const tipX = myPos.current.x + Math.sin(angle) * 40;
      const tipY = myPos.current.y - Math.cos(angle) * 40;
      const vx = Math.sin(angle) * 18;
      const vy = -Math.cos(angle) * 18;
      
      myBullets.current.push({ x: tipX, y: tipY, vx, vy });
      setMuzzle(true);
      setTimeout(() => setMuzzle(false), 50);

      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy });
    }, 150); 
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || (countdown !== 0 && countdown !== null)) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.changedTouches[0];
    const tx = (t.clientX - rect.left) * (W / rect.width);
    const ty = (t.clientY - rect.top) * (H / rect.height);

    if (e.type === "touchstart") {
      const now = Date.now();
      const dist = Math.hypot(tx - myPos.current.x, ty - myPos.current.y);
      if (dist < 70 && (now - lastTap.current) < 300 && grenades[role] > 0) {
        // Double tap for grenade logic
      }
      lastTap.current = now;
    }

    if (e.type === "touchmove") {
      myPos.current.x = tx;
      myPos.current.y = ty;
      socket.current.emit("move", { 
        roomId, x: W - tx, y: H - ty, rot: -myRot.current 
      });
    }
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      // Bullets & Collision Check (Authoritative emit)
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff";
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        
        // Simple collision with enemy area
        if (b.y < 150 && Math.abs(b.x - enemyPos.current.x) < 30) {
          socket.current.emit("take_damage", { roomId, target: 'player', victimRole: role === 'host' ? 'guest' : 'host' });
          myBullets.current.splice(i, 1);
        }
        if (b.y < -10 || b.y > H + 10) myBullets.current.splice(i, 1);
      });

      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e";
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        if (b.y > H + 10) enemyBullets.current.splice(i, 1);
      });

      // Muzzle
      if (muzzle) {
        ctx.fillStyle = "yellow";
        ctx.beginPath(); ctx.arc(myPos.current.x, myPos.current.y - 40, 10, 0, Math.PI*2); ctx.fill();
      }

      // Draw Players
      const drawPlayer = (x, y, rot, color, isEnemy) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.fillStyle = color; ctx.beginPath();
        if (isEnemy) { ctx.moveTo(0, 40); ctx.lineTo(-15, -15); ctx.lineTo(15, -15); }
        else { ctx.moveTo(0, -40); ctx.lineTo(-15, 15); ctx.lineTo(15, 15); }
        ctx.fill(); ctx.restore();
      };
      drawPlayer(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawPlayer(enemyPos.current.x, enemyPos.current.y, enemyPos.current.rot, "#ff3e3e", true);

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, muzzle, roomId]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">ENEMY</span>
          <div className="mini-hp"><div className="fill red" style={{width: `${(health[role==='host'?'guest':'host']/400)*100}%`}}/></div>
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