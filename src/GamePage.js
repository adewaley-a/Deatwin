import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com"; 

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  
  const [playerNames, setPlayerNames] = useState({ host: "Player 1", guest: "Player 2" });
  const [role, setRole] = useState(null); 
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [gameOver, setGameOver] = useState(null);

  const W = 400, H = 700;
  const myPos = useRef({ x: 200, y: 600, angle: 0 }); 
  const enemyPos = useRef({ x: 200, y: 100, angle: 0 });
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setPlayerNames({ host: d.hostName || "Host", guest: d.guestName || "Guest" });
      }
    });

    socket.current = io(SOCKET_URL);
    socket.current.emit("join_game", { roomId });
    socket.current.on("assign_role", (data) => setRole(data.role));
    
    socket.current.on("opp_move", (data) => { 
      enemyPos.current = { x: data.x, y: data.y, angle: data.angle }; 
    });

    socket.current.on("incoming_bullet", (b) => {
      enemyBullets.current.push(b);
    });

    socket.current.on("update_health", (h) => {
      setHealth(h);
      if (role && (h.host <= 0 || h.guest <= 0)) setGameOver(h[role] <= 0 ? "lose" : "win");
    });

    const fireInt = setInterval(() => {
      if (!role || gameOver) return;
      const speed = 15;
      const angle = myPos.current.angle;
      const bData = { 
        x: myPos.current.x, 
        y: myPos.current.y - 25, 
        vx: Math.sin(angle) * speed, 
        vy: -Math.cos(angle) * speed,
        angle: angle
      };
      socket.current.emit("fire", { ...bData, roomId });
      myBullets.current.push(bData);
    }, 300);

    return () => { unsub(); socket.current.disconnect(); clearInterval(fireInt); };
  }, [roomId, role, gameOver]);

  const handleTouch = (e) => {
    if (!role || gameOver) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches[0];
    let nX = (t.clientX - rect.left) * (W / rect.width);
    let nY = (t.clientY - rect.top) * (H / rect.height);
    
    nY = Math.max(H / 2 + 50, Math.min(H - 40, nY));
    nX = Math.max(25, Math.min(W - 25, nX));

    // Calculate angle relative to current shooter position (max 70 degrees)
    // dx is the horizontal distance from the shooter's center to the touch point
    const dx = nX - myPos.current.x; 
    const maxTilt = (70 * Math.PI) / 180;
    // Sensitivity: how much drag causes full tilt (e.g., 60 pixels)
    let angle = (dx / 60) * maxTilt;
    angle = Math.max(-maxTilt, Math.min(maxTilt, angle));

    myPos.current = { x: nX, y: nY, angle: angle };
    socket.current.emit("move", { roomId, x: W - nX, y: H - nY, angle: -angle });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const drawShooter = (pos, color, isOpponent) => {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        if (isOpponent) ctx.rotate(Math.PI); 
        ctx.rotate(pos.angle);

        // Pendulum Extension (Attached to BASE/Back of Triangle)
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 15); // Start at center of the base
        ctx.lineTo(0, 45); // Extend downwards from the base
        ctx.stroke();

        // Shooter Body (Tip points to bullets' direction)
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -25); // Tip
        ctx.lineTo(-20, 15); // Base Left
        ctx.lineTo(20, 15);  // Base Right
        ctx.fill();
        ctx.restore();
    };

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#333";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      drawShooter(myPos.current, "#00f2ff", false);
      drawShooter(enemyPos.current, "#ff3e3e", true);

      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
        ctx.fillStyle = "#fffb00"; ctx.fillRect(-2, -10, 4, 20);
        ctx.restore();
        if (Math.hypot(b.x - enemyPos.current.x, b.y - enemyPos.current.y) < 25) {
          myBullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role === 'host' ? 'guest' : 'host' });
        }
        if (b.y < -50 || b.x < -50 || b.x > W + 50) myBullets.current.splice(i, 1);
      });

      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        let dX = W - b.x; let dY = H - b.y;
        ctx.save(); ctx.translate(dX, dY); ctx.rotate(-b.angle + Math.PI);
        ctx.fillStyle = "#ff8c00"; ctx.fillRect(-2, -10, 4, 20);
        ctx.restore();
        if (Math.hypot(dX - myPos.current.x, dY - myPos.current.y) < 25) {
          enemyBullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role });
        }
        if (dY > H + 50) enemyBullets.current.splice(i, 1);
      });

      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, gameOver, roomId]);

  // IDENTITY FIX: Map strictly based on role
  const localName = role === 'host' ? playerNames.host : playerNames.guest;
  const oppName = role === 'host' ? playerNames.guest : playerNames.host;
  const localHP = role === 'host' ? health.host : health.guest;
  const oppHP = role === 'host' ? health.guest : health.host;

  return (
    <div className="game-container" onTouchMove={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{oppName}</span>
          <div className="mini-hp"><div className="fill opponent" style={{width: `${(oppHP/400)*100}%`}}/></div>
          <span className="hp-val red-text">{oppHP} HP</span>
        </div>
        <div className="stat-box">
          <span className="name">YOU ({localName})</span>
          <div className="mini-hp"><div className="fill local" style={{width: `${(localHP/400)*100}%`}}/></div>
          <span className="hp-val blue-text">{localHP} HP</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {gameOver && (
        <div className="overlay">
          <h1 className={gameOver}>{gameOver.toUpperCase()}</h1>
          <button onClick={() => navigate("/")}>EXIT</button>
        </div>
      )}
    </div>
  );
}