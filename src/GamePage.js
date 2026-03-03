import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import "./GamePage.css";

// ⚠️ Ensure this matches your live Render Backend URL
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

  const W = 400;
  const H = 700;

  const myPos = useRef({ x: 200, y: 600 });
  const enemyPos = useRef({ x: 200, y: 100 });
  const bullets = useRef([]);

  // EFFECT 1: Socket Connection & Firebase Data
  useEffect(() => {
    // Fetch usernames from Firestore
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setPlayerNames({ 
          host: data.hostName || "Player A", 
          guest: data.guestName || "Player B" 
        });
      }
    });

    socket.current = io(SOCKET_URL);
    socket.current.emit("join_game", { roomId });

    socket.current.on("assign_role", (data) => {
      setRole(data.role);
      myPos.current.y = data.role === 'host' ? 600 : 100;
    });

    socket.current.on("opp_move", (data) => { enemyPos.current = data; });
    socket.current.on("incoming_bullet", (b) => { bullets.current.push(b); });
    
    socket.current.on("update_health", (h) => {
      setHealth(h);
      if (h.host <= 0 || h.guest <= 0) {
        setGameOver(h[role] <= 0 ? "lose" : "win");
      }
    });

    // Auto-fire loop (1 bullet per second)
    const fireInterval = setInterval(() => {
      if (!role || gameOver) return;
      const bData = {
        x: myPos.current.x,
        y: role === 'host' ? myPos.current.y - 40 : myPos.current.y + 40,
        vy: role === 'host' ? -10 : 10,
        owner: role,
        roomId
      };
      socket.current.emit("fire", bData);
      bullets.current.push(bData);
    }, 1000);

    return () => { 
      unsub(); 
      socket.current.disconnect(); 
      clearInterval(fireInterval); 
    };
    // Added roomId and role to prevent ESLint build failure
  }, [roomId, role, gameOver]); 

  // EFFECT 2: The Rendering Engine
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let animationFrame;

    const loop = () => {
      ctx.clearRect(0, 0, W, H);

      // Divide the canvas in two halves
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      const drawShooter = (x, y, isEnemy) => {
        let rX = x, rY = y;
        // Mirroring logic: Guest sees everything flipped
        if (role === 'guest' || (role === 'host' && isEnemy)) {
            rX = W - x; rY = H - y;
        }
        ctx.fillStyle = isEnemy ? "#ff3e3e" : "#00f2ff";
        
        // Draw Triangle Shooters
        ctx.beginPath();
        ctx.moveTo(rX, isEnemy ? rY + 25 : rY - 25);
        ctx.lineTo(rX - 25, isEnemy ? rY - 25 : rY + 25);
        ctx.lineTo(rX + 25, isEnemy ? rY - 25 : rY + 25);
        ctx.closePath();
        ctx.fill();
      };

      drawShooter(myPos.current.x, myPos.current.y, false);
      drawShooter(enemyPos.current.x, enemyPos.current.y, true);

      // Vertical "slug" bullets
      bullets.current.forEach((b, i) => {
        b.y += b.vy;
        let bX = role === 'guest' ? W - b.x : b.x;
        let bY = role === 'guest' ? H - b.y : b.y;
        
        ctx.fillStyle = "#fffb00";
        ctx.fillRect(bX - 2, bY - 10, 4, 20); 

        // Hit Detection (Server handles health subtraction)
        if (Math.hypot(b.x - myPos.current.x, b.y - myPos.current.y) < 25 && b.owner !== role) {
          bullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role });
        }
      });
      animationFrame = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(animationFrame);
    // Added roomId and role here to satisfy ESLint
  }, [role, gameOver, roomId]); 

  const handleTouch = (e) => {
    if (!role || gameOver) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches[0];
    let nX = (t.clientX - rect.left) * (W / rect.width);
    let nY = (t.clientY - rect.top) * (H / rect.height);

    if (role === 'guest') { nX = W - nX; nY = H - nY; }

    // Each player can drag shooter ONLY within their own half
    nY = Math.max(H / 2 + 50, Math.min(H - 40, nY));
    nX = Math.max(40, Math.min(W - 40, nX));
    
    myPos.current = { x: nX, y: nY };
    socket.current.emit("move", { roomId, x: nX, y: nY, role });
  };

  return (
    <div className="game-container" onTouchMove={handleTouch}>
      <div className="player-info opponent">
        <span className="name-label">{role === 'host' ? playerNames.guest : playerNames.host}</span>
        <div className="hp-bar">
          <div className="fill" style={{ width: `${(health[role === 'host' ? 'guest' : 'host'] / 400) * 100}%` }} />
        </div>
      </div>

      <canvas ref={canvasRef} width={W} height={H} />

      <div className="player-info local">
        <div className="hp-bar">
          <div className="fill" style={{ width: `${(health[role] / 400) * 100}%` }} />
        </div>
        <span className="name-label">{role === 'host' ? playerNames.host : playerNames.guest}</span>
      </div>

      {gameOver && (
        <div className="game-over-screen">
          <h1 className={gameOver}>{gameOver.toUpperCase()}</h1>
          <button onClick={() => navigate("/")}>REMATCH</button>
        </div>
      )}
    </div>
  );
}