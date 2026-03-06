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
  
  const [playerNames, setPlayerNames] = useState({ host: "...", guest: "..." });
  const [role, setRole] = useState(null); 
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [gameOver, setGameOver] = useState(null);

  const W = 400, H = 700;
  const myPos = useRef({ x: 200, y: 600 });
  const enemyPos = useRef({ x: 200, y: 100 });
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);

  useEffect(() => {
    // 1. Sync names from Firestore
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setPlayerNames({ 
          host: d.hostName || "Host", 
          guest: d.guestName || "Guest" 
        });
      }
    });

    // 2. Socket Connection
    socket.current = io(SOCKET_URL);
    socket.current.emit("join_game", { roomId });
    
    socket.current.on("assign_role", (data) => {
      setRole(data.role); // Server tells us if we are 'host' or 'guest'
    });
    
    socket.current.on("opp_move", (data) => { 
      enemyPos.current = { x: data.x, y: data.y }; 
    });

    socket.current.on("incoming_bullet", (b) => {
      enemyBullets.current.push(b);
    });

    socket.current.on("update_health", (h) => {
      setHealth(h);
      if (role && (h.host <= 0 || h.guest <= 0)) {
        // Check our specific role's health to determine win/loss
        setGameOver(h[role] <= 0 ? "lose" : "win");
      }
    });

    const fireInt = setInterval(() => {
      if (!role || gameOver) return;
      const bData = { x: myPos.current.x, y: myPos.current.y - 25, v: -12 };
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
    myPos.current = { x: nX, y: nY };
    socket.current.emit("move", { roomId, x: W - nX, y: H - nY });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#333";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      // LOCAL SHOOTER (Blue)
      ctx.fillStyle = "#00f2ff";
      ctx.beginPath();
      ctx.moveTo(myPos.current.x, myPos.current.y - 25);
      ctx.lineTo(myPos.current.x - 20, myPos.current.y + 15);
      ctx.lineTo(myPos.current.x + 20, myPos.current.y + 15);
      ctx.fill();

      // ENEMY SHOOTER (Red)
      ctx.fillStyle = "#ff3e3e";
      ctx.beginPath();
      ctx.moveTo(enemyPos.current.x, enemyPos.current.y + 25);
      ctx.lineTo(enemyPos.current.x - 20, enemyPos.current.y - 15);
      ctx.lineTo(enemyPos.current.x + 20, enemyPos.current.y - 15);
      ctx.fill();

      // Bullet Physics
      myBullets.current.forEach((b, i) => {
        b.y += b.v;
        ctx.fillStyle = "#fffb00";
        ctx.fillRect(b.x - 2, b.y - 10, 4, 20);
        if (Math.hypot(b.x - enemyPos.current.x, b.y - enemyPos.current.y) < 25) {
          myBullets.current.splice(i, 1);
          const victim = role === 'host' ? 'guest' : 'host';
          socket.current.emit("take_damage", { roomId, victimRole: victim });
        }
        if (b.y < -50) myBullets.current.splice(i, 1);
      });

      enemyBullets.current.forEach((b, i) => {
        b.y += b.v; 
        let drawX = W - b.x;
        let drawY = H - b.y;
        ctx.fillStyle = "#ff8c00";
        ctx.fillRect(drawX - 2, drawY - 10, 4, 20);
        if (Math.hypot(drawX - myPos.current.x, drawY - myPos.current.y) < 25) {
          enemyBullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role });
        }
        if (drawY > H + 50) enemyBullets.current.splice(i, 1);
      });

      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, gameOver, roomId]);

  // --- THE CORRECTED IDENTITY MAPPING ---
  // We use the 'role' assigned by the backend to determine which name goes where
  const localPlayerName = role === 'host' ? playerNames.host : playerNames.guest;
  const enemyPlayerName = role === 'host' ? playerNames.guest : playerNames.host;
  
  const localHP = role === 'host' ? health.host : health.guest;
  const enemyHP = role === 'host' ? health.guest : health.host;

  return (
    <div className="game-container" onTouchMove={handleTouch}>
      <div className="header-dashboard">
        {/* OPPONENT (RED) - Always Top */}
        <div className="stat-box">
          <span className="name">{enemyPlayerName}</span>
          <div className="mini-hp">
            <div className="fill opponent" style={{width: `${(enemyHP/400)*100}%`}}/>
          </div>
          <span className="hp-val red-text">{enemyHP} HP</span>
        </div>
        
        {/* YOU (BLUE) - Always Local */}
        <div className="stat-box">
          <span className="name">YOU ({localPlayerName})</span>
          <div className="mini-hp">
            <div className="fill local" style={{width: `${(localHP/400)*100}%`}}/>
          </div>
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