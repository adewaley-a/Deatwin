import React, { useEffect, useRef, useState } from "react";
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
  
  const [playerNames, setPlayerNames] = useState({ host: "Player 1", guest: "Player 2" });
  const [role, setRole] = useState(null); 
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(3);

  const W = 400, H = 700;
  const myPos = useRef({ x: 200, y: 600 });
  const myRot = useRef(0); 
  const isDraggingShip = useRef(false);
  const isSteering = useRef(false);

  const enemyPos = useRef({ x: 200, y: 100 });
  const enemyRot = useRef(0);
  const enemyTarget = useRef({ x: 200, y: 100, rot: 0 }); 
  
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
      enemyTarget.current = { x: data.x, y: data.y, rot: data.rot }; 
    });

    socket.current.on("incoming_bullet", (b) => { enemyBullets.current.push(b); });
    socket.current.on("update_health", (h) => {
      setHealth(h);
      if (role && (h.host <= 0 || h.guest <= 0)) setGameOver(h[role] <= 0 ? "lose" : "win");
    });

    return () => { unsub(); socket.current.disconnect(); };
  }, [roomId, role]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Shooting Logic
  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const speed = 14;
      const angle = myRot.current;
      const apexDist = 25; 

      // My apex (Points Up)
      const tipX = myPos.current.x + Math.sin(angle) * apexDist;
      const tipY = myPos.current.y - Math.cos(angle) * apexDist;

      const vx = Math.sin(angle) * speed;
      const vy = -Math.cos(angle) * speed;

      const bData = { x: tipX, y: tipY, vx, vy, rot: angle };
      
      // Emit mirrored: Rotation and Velocity are inverted for the other screen
      socket.current.emit("fire", { 
        roomId, 
        x: W - tipX, 
        y: H - tipY, 
        vx: -vx, 
        vy: -vy, 
        rot: -angle 
      });
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
      const distToSlider = Math.hypot(touchX - myPos.current.x, touchY - (myPos.current.y + 75));
      const distToShip = Math.hypot(touchX - myPos.current.x, touchY - myPos.current.y);
      if (distToSlider < 60) { isSteering.current = true; }
      else if (distToShip < 80) { isDraggingShip.current = true; }
    }

    if (e.type === "touchmove") {
      if (isSteering.current) {
        const sensitivity = 0.02; 
        const deltaX = touchX - myPos.current.x;
        myRot.current = Math.max(-1.22, Math.min(1.22, deltaX * sensitivity));
      } else if (isDraggingShip.current) {
        myPos.current.x = Math.max(25, Math.min(W - 25, touchX));
        myPos.current.y = Math.max(H / 2 + 50, Math.min(H - 120, touchY));
      }
    }

    if (e.type === "touchend") {
      isSteering.current = false;
      isDraggingShip.current = false;
    }

    socket.current.emit("move", { roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const drawShooter = (x, y, rot, color, isEnemy) => {
        ctx.save();
        ctx.translate(x, y);

        // Control Deck (Only for local player)
        if (!isEnemy) {
          const deckY = 60;
          ctx.strokeStyle = color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, deckY, 15, 0, Math.PI * 2); ctx.stroke();
          ctx.save(); ctx.translate(0, deckY); ctx.rotate(rot * 1.5);
          ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();
          ctx.restore();
          ctx.beginPath(); ctx.moveTo(-40, deckY + 25); ctx.lineTo(40, deckY + 25); ctx.stroke();
          const knobX = (rot / 1.22) * 40;
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(knobX, deckY + 25, 8, 0, Math.PI * 2); ctx.fill();
        }

        // --- FIXED MIRRORING ---
        // If it's the enemy, we rotate the whole coordinate system by 180 deg (Math.PI)
        if (isEnemy) ctx.rotate(Math.PI); 
        
        ctx.rotate(rot); // Apply the steered tilt
        ctx.fillStyle = color; ctx.shadowBlur = 15; ctx.shadowColor = color;
        
        ctx.beginPath();
        // Now "Up" (-25) is always the tip facing the opponent
        ctx.moveTo(0, -25); 
        ctx.lineTo(-20, 15);
        ctx.lineTo(20, 15);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    };

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#333"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      enemyPos.current.x = lerp(enemyPos.current.x, enemyTarget.current.x, 0.15);
      enemyPos.current.y = lerp(enemyPos.current.y, enemyTarget.current.y, 0.15);
      enemyRot.current = lerp(enemyRot.current, enemyTarget.current.rot, 0.15);

      drawShooter(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawShooter(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      [myBullets, enemyBullets].forEach((ref) => {
        ref.current.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.fillStyle = (ref === myBullets) ? "#fffb00" : "#ff8c00";
          ctx.shadowBlur = 10; ctx.shadowColor = ctx.fillStyle;
          ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

          const target = (ref === myBullets) ? enemyPos.current : myPos.current;
          if (Math.hypot(b.x - target.x, b.y - target.y) < 25) {
            ref.current.splice(i, 1);
            socket.current.emit("take_damage", { roomId, victimRole: (ref === myBullets) ? (role==='host'?'guest':'host') : role });
          }
          if (b.y < -50 || b.y > H + 50 || b.x < -50 || b.x > W + 50) ref.current.splice(i, 1);
        });
      });
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, roomId]);

  const localName = role === 'host' ? playerNames.host : playerNames.guest;
  const oppName = role === 'host' ? playerNames.guest : playerNames.host;
  const localHP = role === 'host' ? health.host : health.guest;
  const oppHP = role === 'host' ? health.guest : health.host;

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
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
      {countdown > 0 && <div className="overlay"><h1 className="countdown-text">{countdown}</h1></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}