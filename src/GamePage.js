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

  const W = 400;
  const H = 700;

  // Use refs for positions to prevent re-render lag
  const myPos = useRef({ x: 200, y: 550 });
  const enemyPos = useRef({ x: 200, y: 150 });
  const bullets = useRef([]);

  useEffect(() => {
    // Sync names from Firestore
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setPlayerNames({ host: data.hostName || "Host", guest: data.guestName || "Guest" });
      }
    });

    socket.current = io(SOCKET_URL);
    socket.current.emit("join_game", { roomId });

    socket.current.on("assign_role", (data) => setRole(data.role));
    socket.current.on("opp_move", (data) => { enemyPos.current = data; });
    socket.current.on("incoming_bullet", (b) => bullets.current.push(b));
    socket.current.on("update_health", (h) => {
      setHealth(h);
      if ((h.host <= 0 || h.guest <= 0) && role) {
        setGameOver(h[role] <= 0 ? "lose" : "win");
      }
    });

    const fireInterval = setInterval(() => {
      if (!role || gameOver) return;
      const bData = {
        x: myPos.current.x,
        y: myPos.current.y - 30, // Shoots "up" from my perspective
        v: -10,
        owner: role,
        roomId
      };
      socket.current.emit("fire", bData);
      bullets.current.push(bData);
    }, 800);

    return () => {
      unsub();
      socket.current.disconnect();
      clearInterval(fireInterval);
    };
  }, [roomId, role, gameOver]);

  const handleTouch = (e) => {
    if (!role || gameOver) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches[0];
    
    // Calculate local X/Y
    let nX = (t.clientX - rect.left) * (W / rect.width);
    let nY = (t.clientY - rect.top) * (H / rect.height);

    // LOCK TO BOTTOM HALF: 
    // This stops the "jumping" into the opponent's half
    nY = Math.max(H / 2 + 50, Math.min(H - 50, nY));
    nX = Math.max(30, Math.min(W - 30, nX));

    myPos.current = { x: nX, y: nY };
    
    // SEND MIRRORED POSITION:
    // We send our X/Y "flipped" so the opponent sees us at the top
    socket.current.emit("move", { 
      roomId, 
      x: W - nX, 
      y: H - nY 
    });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const render = () => {
      ctx.clearRect(0, 0, W, H);

      // Halfway line
      ctx.strokeStyle = "#333";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      // Draw Me (Cyan Triangle at Bottom)
      ctx.fillStyle = "#00f2ff";
      ctx.beginPath();
      ctx.moveTo(myPos.current.x, myPos.current.y - 20);
      ctx.lineTo(myPos.current.x - 20, myPos.current.y + 20);
      ctx.lineTo(myPos.current.x + 20, myPos.current.y + 20);
      ctx.fill();

      // Draw Opponent (Red Triangle at Top)
      ctx.fillStyle = "#ff3e3e";
      ctx.beginPath();
      ctx.moveTo(enemyPos.current.x, enemyPos.current.y + 20);
      ctx.lineTo(enemyPos.current.x - 20, enemyPos.current.y - 20);
      ctx.lineTo(enemyPos.current.x + 20, enemyPos.current.y - 20);
      ctx.fill();

      // Bullets
      bullets.current.forEach((b, i) => {
        b.y += b.v;
        
        // If bullet is mine, it goes up. If opponent's, it comes from mirrored pos.
        let renderX = b.owner === role ? b.x : W - b.x;
        let renderY = b.owner === role ? b.y : H - b.y;

        ctx.fillStyle = "yellow";
        ctx.fillRect(renderX - 2, renderY - 10, 4, 20);

        // Collision check
        if (b.owner !== role && Math.hypot(renderX - myPos.current.x, renderY - myPos.current.y) < 30) {
            bullets.current.splice(i, 1);
            socket.current.emit("take_damage", { roomId, victimRole: role });
        }

        if (renderY < -50 || renderY > H + 50) bullets.current.splice(i, 1);
      });

      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, gameOver, roomId]); // roomId added to fix ESLint

  return (
    <div className="game-container" onTouchMove={handleTouch}>
      <div className="player-info opponent">
        <span>{role === 'host' ? playerNames.guest : playerNames.host}</span>
        <div className="hp-bar"><div className="fill" style={{width: `${(health[role === 'host' ? 'guest' : 'host']/400)*100}%`}}/></div>
      </div>

      <canvas ref={canvasRef} width={W} height={H} />

      <div className="player-info local">
        <div className="hp-bar"><div className="fill" style={{width: `${(health[role]/400)*100}%`}}/></div>
        <span>{role === 'host' ? playerNames.host : playerNames.guest}</span>
      </div>

      {gameOver && (
        <div className="overlay">
          <h1 className={gameOver}>{gameOver.toUpperCase()}</h1>
          <button onClick={() => navigate("/")}>EXIT</button>
        </div>
      )}
    </div>
  );
}