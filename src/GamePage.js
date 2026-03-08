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
  const [countdown, setCountdown] = useState(3);

  const W = 400, H = 700;
  const myPos = useRef({ x: 200, y: 600 });
  const myRot = useRef(0); 
  const isDraggingShip = useRef(false);
  const isSteering = useRef(false);

  const enemyPos = useRef({ x: 200, y: 100 });
  const enemyRot = useRef(0);
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
      enemyPos.current = { x: data.x, y: data.y }; 
      enemyRot.current = data.rot; 
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

  // Shooting Logic - Fixed Bullet Origin
  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const speed = 14;
      const angle = myRot.current;
      
      // Calculate tip of the triangle (25px from center)
      const tipX = myPos.current.x + Math.sin(angle) * -25;
      const tipY = myPos.current.y + Math.cos(angle) * -25;

      const vx = Math.sin(angle) * speed;
      const vy = -Math.cos(angle) * speed;

      const bData = { x: tipX, y: tipY, vx, vy, rot: angle };
      socket.current.emit("fire", { ...bData, roomId });
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
      const distToShip = Math.hypot(touchX - myPos.current.x, touchY - myPos.current.y);
      const distToSlider = Math.hypot(touchX - myPos.current.x, touchY - (myPos.current.y + 60));

      if (distToSlider < 40) {
        isSteering.current = true;
      } else if (distToShip < 40) {
        isDraggingShip.current = true;
      }
    }

    if (e.type === "touchmove") {
      if (isSteering.current) {
        // Corrected Direction: Sliding Right rotates Right (Positive Radians)
        const sensitivity = 0.015;
        const deltaX = touchX - myPos.current.x;
        myRot.current = Math.max(-1.22, Math.min(1.22, deltaX * sensitivity));
      } else if (isDraggingShip.current) {
        let nY = Math.max(H / 2 + 50, Math.min(H - 100, touchY));
        let nX = Math.max(25, Math.min(W - 25, touchX));
        myPos.current = { x: nX, y: nY };
      }
    }

    if (e.type === "touchend" || e.type === "touchcancel") {
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
        ctx.rotate(rot);
        
        // 1. Triangular Body
        ctx.fillStyle = color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
        ctx.beginPath();
        const tipY = isEnemy ? 25 : -25;
        const baseTop = isEnemy ? -15 : 15;
        ctx.moveTo(0, tipY);
        ctx.lineTo(-20, baseTop);
        ctx.lineTo(20, baseTop);
        ctx.fill();
        ctx.shadowBlur = 0;

        // 2. Control Deck (Moved Below Base)
        const deckY = 50; 
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        // Steering Wheel
        ctx.beginPath();
        ctx.arc(0, deckY, 12, 0, Math.PI * 2);
        ctx.stroke();
        // Spinning spokes
        ctx.save();
        ctx.translate(0, deckY);
        ctx.rotate(rot * 2); // Visual spin
        ctx.beginPath();
        ctx.moveTo(-12, 0); ctx.lineTo(12, 0);
        ctx.moveTo(0, -12); ctx.lineTo(0, 12);
        ctx.stroke();
        ctx.restore();

        // 3. Horizontal Slider Bar & Knob
        if (!isEnemy) {
          const sliderY = deckY + 25;
          ctx.beginPath();
          ctx.moveTo(-35, sliderY);
          ctx.lineTo(35, sliderY);
          ctx.stroke();

          // Movable Knob representing rotation
          const knobX = (rot / 1.22) * 35;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(knobX, sliderY, 6, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
    };

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#333";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      drawShooter(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawShooter(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      // Bullet Physics
      [myBullets, enemyBullets].forEach((ref, idx) => {
        const isLocal = idx === 0;
        ref.current.forEach((b, i) => {
          b.x += b.vx;
          b.y += b.vy;
          
          let dX = isLocal ? b.x : W - b.x;
          let dY = isLocal ? b.y : H - b.y;

          ctx.save();
          ctx.translate(dX, dY);
          ctx.rotate(isLocal ? b.rot : -b.rot);
          ctx.fillStyle = isLocal ? "#fffb00" : "#ff8c00";
          ctx.fillRect(-2, -10, 4, 20);
          ctx.restore();

          const targetPos = isLocal ? enemyPos.current : myPos.current;
          const dist = Math.hypot(dX - targetPos.x, dY - targetPos.y);
          
          if (dist < 25) {
            ref.current.splice(i, 1);
            socket.current.emit("take_damage", { roomId, victimRole: isLocal ? (role==='host'?'guest':'host') : role });
          }
          if (dY < -50 || dY > H + 50 || dX < -50 || dX > W + 50) ref.current.splice(i, 1);
        });
      });

      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, roomId]);

  const isHost = role === 'host';
  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{isHost ? playerNames.guest : playerNames.host}</span>
          <div className="mini-hp"><div className="fill opponent" style={{width: `${(health[isHost?'guest':'host']/400)*100}%`}}/></div>
          <span className="hp-val red-text">{health[isHost?'guest':'host']} HP</span>
        </div>
        <div className="stat-box">
          <span className="name">YOU ({isHost ? playerNames.host : playerNames.guest})</span>
          <div className="mini-hp"><div className="fill local" style={{width: `${(health[role]/400)*100}%`}}/></div>
          <span className="hp-val blue-text">{health[role]} HP</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay countdown-bg"><h1 className="countdown-text">{countdown}</h1></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}