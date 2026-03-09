import React, { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com"; 
const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  
  const [playerNames, setPlayerNames] = useState(null); // Start null to prevent premature render
  const [role, setRole] = useState(null); 
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(3);

  const W = 400, H = 700;
  const myPos = useRef({ x: 200, y: 600 });
  const myRot = useRef(0); 
  const enemyPos = useRef({ x: 200, y: 100 });
  const enemyTarget = useRef({ x: 200, y: 100, rot: 0 }); 
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const isDraggingShip = useRef(false);
  const isSteering = useRef(false);

  // Identity logic - Memoized to prevent swapping during lag
  const identity = useMemo(() => {
    if (!role || !playerNames) return null;
    return {
      me: role === 'host' ? playerNames.host : playerNames.guest,
      opp: role === 'host' ? playerNames.guest : playerNames.host,
      myHP: role === 'host' ? health.host : health.guest,
      oppHP: role === 'host' ? health.guest : health.host
    };
  }, [role, playerNames, health]);

  useEffect(() => {
    // 1. Fetch Names First
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setPlayerNames({ host: d.hostName || "Host", guest: d.guestName || "Guest" });
      }
    });

    // 2. Connect Socket
    socket.current = io(SOCKET_URL);
    socket.current.emit("join_game", { roomId });
    
    socket.current.on("assign_role", (data) => setRole(data.role));
    socket.current.on("opp_move", (data) => { enemyTarget.current = data; });
    socket.current.on("incoming_bullet", (b) => { enemyBullets.current.push(b); });
    socket.current.on("update_health", (h) => setHealth(h));

    return () => { unsub(); socket.current.disconnect(); };
  }, [roomId]);

  // Handle Game Over
  useEffect(() => {
    if (role && (health.host <= 0 || health.guest <= 0)) {
      const lost = role === 'host' ? health.host <= 0 : health.guest <= 0;
      setGameOver(lost ? "lose" : "win");
    }
  }, [health, role]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Firing Logic
  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const angle = myRot.current;
      const tipX = myPos.current.x + Math.sin(angle) * 25;
      const tipY = myPos.current.y - Math.cos(angle) * 25;
      const vx = Math.sin(angle) * 14;
      const vy = -Math.cos(angle) * 14;
      const bData = { x: tipX, y: tipY, vx, vy, rot: angle };

      socket.current.emit("fire", { roomId, x: W-tipX, y: H-tipY, vx: -vx, vy: -vy, rot: -angle });
      myBullets.current.push(bData);
    }, 250);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches[0];
    const touchX = (t.clientX - rect.left) * (W / rect.width);
    const touchY = (t.clientY - rect.top) * (H / rect.height);

    if (e.type === "touchstart") {
      if (Math.hypot(touchX - myPos.current.x, touchY - (myPos.current.y + 75)) < 60) isSteering.current = true;
      else if (Math.hypot(touchX - myPos.current.x, touchY - myPos.current.y) < 80) isDraggingShip.current = true;
    }
    if (e.type === "touchmove") {
      if (isSteering.current) {
        myRot.current = Math.max(-1.22, Math.min(1.22, (touchX - myPos.current.x) * 0.02));
      } else if (isDraggingShip.current) {
        myPos.current.x = Math.max(25, Math.min(W - 25, touchX));
        myPos.current.y = Math.max(H / 2 + 50, Math.min(H - 120, touchY));
      }
      socket.current.emit("move", { roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current });
    }
    if (e.type === "touchend") { isSteering.current = false; isDraggingShip.current = false; }
  };

  useEffect(() => {
    if (!role || !playerNames) return; // THE GATE: Don't start rendering until ready
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const drawShooter = (x, y, rot, color, isEnemy) => {
      ctx.save();
      ctx.translate(x, y);
      if (!isEnemy) { // UI Controls for bottom player
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 60, 15, 0, Math.PI * 2); ctx.stroke();
        ctx.save(); ctx.translate(0, 60); ctx.rotate(rot * 1.5);
        ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();
        ctx.restore();
      }
      ctx.rotate(rot);
      ctx.fillStyle = color; ctx.shadowBlur = 15; ctx.shadowColor = color;
      ctx.beginPath();
      if (isEnemy) { ctx.moveTo(0, 25); ctx.lineTo(-20, -15); ctx.lineTo(20, -15); } 
      else { ctx.moveTo(0, -25); ctx.lineTo(-20, 15); ctx.lineTo(20, 15); }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    };

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#222"; ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      enemyPos.current.x = lerp(enemyPos.current.x, enemyTarget.current.x, 0.15);
      enemyPos.current.y = lerp(enemyPos.current.y, enemyTarget.current.y, 0.15);
      const eRot = lerp(enemyPos.current.rot || 0, enemyTarget.current.rot, 0.15);

      drawShooter(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawShooter(enemyPos.current.x, enemyPos.current.y, eRot, "#ff3e3e", true);

      [myBullets, enemyBullets].forEach((ref) => {
        ref.current.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.save(); ctx.translate(b.x, b.y);
          ctx.fillStyle = (ref === myBullets) ? "#fffb00" : "#ff8c00";
          ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();

          const target = (ref === myBullets) ? enemyPos.current : myPos.current;
          if (Math.hypot(b.x - target.x, b.y - target.y) < 25) {
            ref.current.splice(i, 1);
            socket.current.emit("take_damage", { roomId, victimRole: (ref === myBullets) ? (role==='host'?'guest':'host') : role });
          }
          if (b.y < -50 || b.y > H + 50) ref.current.splice(i, 1);
        });
      });
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, playerNames]);

  if (!identity) return <div className="loading">Initializing Battle...</div>;

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{identity.opp}</span>
          <div className="mini-hp"><div className="fill opponent" style={{width: `${(identity.oppHP/400)*100}%`}}/></div>
          <span className="hp-val red-text">{identity.oppHP} HP</span>
        </div>
        <div className="stat-box">
          <span className="name">YOU ({identity.me})</span>
          <div className="mini-hp"><div className="fill local" style={{width: `${(identity.myHP/400)*100}%`}}/></div>
          <span className="hp-val blue-text">{identity.myHP} HP</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><h1 className="countdown-text">{countdown}</h1></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}