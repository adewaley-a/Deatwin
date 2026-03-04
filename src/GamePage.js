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
  
  const [playerNames, setPlayerNames] = useState({ host: "Player A", guest: "Player B" });
  const [role, setRole] = useState(null);
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [gameOver, setGameOver] = useState(null);
  const [muzzle, setMuzzle] = useState(false);

  const W = 400;
  const H = 700;

  const myPos = useRef({ x: 200, y: 550 });
  const enemyPos = useRef({ x: 200, y: 150 });
  const bullets = useRef([]);

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
    socket.current.on("opp_move", (data) => { enemyPos.current = data; });
    socket.current.on("incoming_bullet", (b) => bullets.current.push(b));
    socket.current.on("update_health", (h) => {
      setHealth(h);
      if ((h.host <= 0 || h.guest <= 0) && role) setGameOver(h[role] <= 0 ? "lose" : "win");
    });

    const fireInterval = setInterval(() => {
      if (!role || gameOver) return;
      const bData = { 
        x: myPos.current.x, 
        y: myPos.current.y - 30, // Spawn at tip
        v: -12, 
        owner: role, 
        roomId 
      };
      socket.current.emit("fire", bData);
      bullets.current.push(bData);
      setMuzzle(true);
      setTimeout(() => setMuzzle(false), 50);
    }, 333);

    return () => { unsub(); socket.current.disconnect(); clearInterval(fireInterval); };
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
      
      // Draw Mid-line
      ctx.strokeStyle = "#222";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      // LOCAL SHOOTER (Bottom Cyan)
      ctx.fillStyle = "#00f2ff";
      ctx.beginPath();
      ctx.moveTo(myPos.current.x, myPos.current.y - 25);
      ctx.lineTo(myPos.current.x - 20, myPos.current.y + 15);
      ctx.lineTo(myPos.current.x + 20, myPos.current.y + 15);
      ctx.fill();

      // MUZZLE FLASH
      if (muzzle) {
        ctx.fillStyle = "rgba(255, 255, 0, 0.4)";
        ctx.beginPath(); ctx.arc(myPos.current.x, myPos.current.y - 30, 10, 0, 7); ctx.fill();
      }

      // OPPONENT SHOOTER (Top Red)
      ctx.fillStyle = "#ff3e3e";
      ctx.beginPath();
      ctx.moveTo(enemyPos.current.x, enemyPos.current.y + 25);
      ctx.lineTo(enemyPos.current.x - 20, enemyPos.current.y - 15);
      ctx.lineTo(enemyPos.current.x + 20, enemyPos.current.y - 15);
      ctx.fill();

      // BULLET RENDERING
      bullets.current.forEach((b, i) => {
        // Apply vertical movement
        b.y += b.v;

        // MIRROR LOGIC: If I don't own it, flip the perspective
        let drawX = b.owner === role ? b.x : W - b.x;
        let drawY = b.owner === role ? b.y : H - b.y;

        ctx.fillStyle = "#fffb00";
        ctx.fillRect(drawX - 2, drawY - 8, 4, 16);

        // COLLISION: Only check bullets I DON'T own against MY triangle
        if (b.owner !== role && Math.hypot(drawX - myPos.current.x, drawY - myPos.current.y) < 25) {
          bullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role });
        }

        // Remove out-of-bounds bullets
        if (drawY < -50 || drawY > H + 50) bullets.current.splice(i, 1);
      });

      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, gameOver, roomId, muzzle]);

  return (
    <div className="game-container" onTouchMove={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{role === 'host' ? playerNames.guest : playerNames.host}</span>
          <div className="mini-hp">
             <div className="fill enemy" style={{width: `${(health[role==='host'?'guest':'host']/400)*100}%`}}/>
          </div>
          <span className="hp-val">{health[role==='host'?'guest':'host']} HP</span>
        </div>
        <div className="stat-box">
          <span className="name">{role === 'host' ? playerNames.host : playerNames.guest}</span>
          <div className="mini-hp">
             <div className="fill local" style={{width: `${(health[role]/400)*100}%`}}/>
          </div>
          <span className="hp-val">{health[role]} HP</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {gameOver && (
        <div className="overlay">
          <h1 className={gameOver}>{gameOver.toUpperCase()}</h1>
          <button onClick={() => navigate("/")}>REMATCH</button>
        </div>
      )}
    </div>
  );
}