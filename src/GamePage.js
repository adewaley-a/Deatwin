import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import "./GamePage.css";

// ⚠️ Update this URL after deploying your Render backend
const SOCKET_URL = "https://deatgame-server.onrender.com"; 

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  
  // State for usernames from Firestore
  const [playerNames, setPlayerNames] = useState({ host: "Player A", guest: "Player B" });
  const [role, setRole] = useState(null);
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [gameOver, setGameOver] = useState(null); // Now properly utilized to pass ESLint

  const W = 400;
  const H = 700;

  const myPos = useRef({ x: 200, y: 600 });
  const enemyPos = useRef({ x: 200, y: 100 });
  const bullets = useRef([]);

  useEffect(() => {
    // 1. Fetch usernames from Firestore based on Room ID
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setPlayerNames({ 
          host: data.hostName || "Player A", 
          guest: data.guestName || "Player B" 
        });
      }
    });

    // 2. Socket.io setup for real-time sync
    socket.current = io(SOCKET_URL);
    socket.current.emit("join_game", { roomId });

    socket.current.on("assign_role", (data) => {
      setRole(data.role);
      myPos.current.y = data.role === 'host' ? 600 : 100;
    });

    socket.current.on("opp_move", (data) => { 
      enemyPos.current = data; 
    });

    socket.current.on("incoming_bullet", (b) => { 
      bullets.current.push(b); 
    });

    socket.current.on("update_health", (h) => {
      setHealth(h);
      // Logic to setGameOver clears the ESLint "unused variable" error
      if (h.host <= 0 || h.guest <= 0) {
        const result = h[role] <= 0 ? "lose" : "win";
        setGameOver(result); 
      }
    });

    // 3. Automatic Firing Loop
    const fireInterval = setInterval(() => {
      if (!role || gameOver) return;
      const bData = {
        x: myPos.current.x,
        y: role === 'host' ? myPos.current.y - 40 : myPos.current.y + 40,
        vy: role === 'host' ? -10 : 10, // Velocity based on role
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
  }, [roomId, role, gameOver]);

  // Handle local player movement (Constraint: Stay in bottom half)
  const handleTouch = (e) => {
    if (!role || gameOver) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches[0];
    let nX = (t.clientX - rect.left) * (W / rect.width);
    let nY = (t.clientY - rect.top) * (H / rect.height);

    // Mirroring for touch input if Guest
    if (role === 'guest') { 
        nX = W - nX; 
        nY = H - nY; 
    }

    // Constraint: Vertical movement limited to your half
    nY = Math.max(H / 2 + 50, Math.min(H - 40, nY));
    nX = Math.max(40, Math.min(W - 40, nX));
    
    myPos.current = { x: nX, y: nY };
    socket.current.emit("move", { roomId, x: nX, y: nY, role });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    const loop = () => {
      ctx.clearRect(0, 0, W, H);

      // Draw Center Line to divide halves
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      const drawShooter = (x, y, isEnemy) => {
        let rX = x, rY = y;
        // Apply mirroring to the render
        if (role === 'guest' || (role === 'host' && isEnemy)) {
            rX = W - x; rY = H - y;
        }
        ctx.fillStyle = isEnemy ? "#ff3e3e" : "#00f2ff";
        ctx.beginPath();
        // Draw Triangle Shooter as per sketch
        ctx.moveTo(rX, isEnemy ? rY + 25 : rY - 25);
        ctx.lineTo(rX - 25, isEnemy ? rY - 25 : rY + 25);
        ctx.lineTo(rX + 25, isEnemy ? rY - 25 : rY + 25);
        ctx.closePath();
        ctx.fill();
      };

      drawShooter(myPos.current.x, myPos.current.y, false);
      drawShooter(enemyPos.current.x, enemyPos.current.y, true);

      // Draw vertical "slug" bullets
      bullets.current.forEach((b, i) => {
        b.y += b.vy;
        let bX = role === 'guest' ? W - b.x : b.x;
        let bY = role === 'guest' ? H - b.y : b.y;
        
        ctx.fillStyle = "#fffb00";
        ctx.fillRect(bX - 2, bY - 10, 4, 20); // Bullet shape

        // Local collision detection
        if (Math.hypot(b.x - myPos.current.x, b.y - myPos.current.y) < 25 && b.owner !== role) {
          bullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role });
        }
      });
      requestAnimationFrame(loop);
    };
    loop();
  }, [role, gameOver]);

  return (
    <div className="game-container" onTouchMove={handleTouch}>
      {/* Top Bar for Opponent */}
      <div className="player-info opponent">
        <span className="name-label">{role === 'host' ? playerNames.guest : playerNames.host}</span>
        <div className="hp-bar">
          <div className="fill" style={{ width: `${(health[role === 'host' ? 'guest' : 'host'] / 400) * 100}%` }} />
        </div>
      </div>

      <canvas ref={canvasRef} width={W} height={H} />

      {/* Bottom Bar for Local Player */}
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