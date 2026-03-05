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
      const speed = 14;
      const angle = myPos.current.angle;
      // Calculate directional velocity
      const bData = { 
        x: myPos.current.x, 
        y: myPos.current.y - 25, 
        vx: Math.sin(angle) * speed, 
        vy: -Math.cos(angle) * speed,
        angle: angle
      };
      socket.current.emit("fire", { ...bData, roomId });
      myBullets.current.push(bData);
    }, 333);

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

    // Calculate angle: 70 degrees max tilt (approx 1.22 radians)
    // Tilt is based on horizontal distance from center of screen
    const tiltRange = (70 * Math.PI) / 180;
    const angle = ((nX - W/2) / (W/2)) * tiltRange;

    myPos.current = { x: nX, y: nY, angle: angle };
    // Send mirrored data to opponent
    socket.current.emit("move", { roomId, x: W - nX, y: H - nY, angle: -angle });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const drawShooter = (pos, color, isOpponent) => {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        if (isOpponent) ctx.rotate(Math.PI); // Flip 180 for enemy
        ctx.rotate(pos.angle);

        // Pendulum Extension (The barrel)
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -45); // Length of extension
        ctx.stroke();

        // Shooter Body
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -25);
        ctx.lineTo(-20, 15);
        ctx.lineTo(20, 15);
        ctx.fill();
        ctx.restore();
    };

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#333";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      drawShooter(myPos.current, "#00f2ff", false);
      drawShooter(enemyPos.current, "#ff3e3e", true);

      // MY BULLETS
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        ctx.fillStyle = "#fffb00";
        ctx.fillRect(-2, -10, 4, 20);
        ctx.restore();

        if (Math.hypot(b.x - enemyPos.current.x, b.y - enemyPos.current.y) < 25) {
          myBullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role === 'host' ? 'guest' : 'host' });
        }
        if (b.y < -50 || b.x < -50 || b.x > W + 50) myBullets.current.splice(i, 1);
      });

      // ENEMY BULLETS (Mirrored)
      enemyBullets.current.forEach((b, i) => {
        // Apply velocity in enemy's coordinate space
        b.x += b.vx; b.y += b.vy;
        // Mirror coordinates for local display
        let dX = W - b.x;
        let dY = H - b.y;

        ctx.save();
        ctx.translate(dX, dY);
        ctx.rotate(-b.angle + Math.PI); // Rotate 180 + mirrored angle
        ctx.fillStyle = "#ff8c00";
        ctx.fillRect(-2, -10, 4, 20);
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

  const localName = role === 'host' ? playerNames.host : playerNames.guest;
  const oppName = role === 'host' ? playerNames.guest : playerNames.host;
  const lHP = role === 'host' ? health.host : health.guest;
  const oHP = role === 'host' ? health.guest : health.host;

  return (
    <div className="game-container" onTouchMove={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{oppName}</span>
          <div className="mini-hp"><div className="fill opponent" style={{width: `${(oHP/400)*100}%`}}/></div>
          <span className="hp-val red-text">{oHP} HP</span>
        </div>
        <div className="stat-box">
          <span className="name">YOU ({localName})</span>
          <div className="mini-hp"><div className="fill local" style={{width: `${(lHP/400)*100}%`}}/></div>
          <span className="hp-val blue-text">{lHP} HP</span>
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