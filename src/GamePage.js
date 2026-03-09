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
  const activeTouchType = useRef(null); // 'steering' or 'dragging'

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
    
    socket.current.on("assign_role", (data) => {
      setRole(data.role);
    });
    
    socket.current.on("opp_move", (data) => { 
      enemyTarget.current = { x: data.x, y: data.y, rot: data.rot }; 
    });

    socket.current.on("incoming_bullet", (b) => { enemyBullets.current.push(b); });
    
    socket.current.on("update_health", (h) => {
      setHealth(h);
      if (h.host <= 0 || h.guest <= 0) {
        setGameOver((prev) => {
            if (prev) return prev;
            // Immediate check using local role state
            const iAmHost = socket.current.role === 'host'; 
            const lost = iAmHost ? h.host <= 0 : h.guest <= 0;
            return lost ? "lose" : "win";
        });
      }
    });

    return () => { unsub(); socket.current.disconnect(); };
  }, [roomId]);

  // Sync role to socket ref for immediate access in listeners
  useEffect(() => {
    if (socket.current) socket.current.role = role;
  }, [role]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const speed = 14;
      const angle = myRot.current;
      const apexDist = 25; 
      const tipX = myPos.current.x + Math.sin(angle) * apexDist;
      const tipY = myPos.current.y - Math.cos(angle) * apexDist;
      const vx = Math.sin(angle) * speed;
      const vy = -Math.cos(angle) * speed;

      const bData = { x: tipX, y: tipY, vx, vy, rot: angle };
      socket.current.emit("fire", { 
        roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy, rot: -angle 
      });
      myBullets.current.push(bData);
    }, 250);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches[0];
    if (!t && e.type !== "touchend") return;

    if (e.type === "touchstart") {
      const touchX = (t.clientX - rect.left) * (W / rect.width);
      const touchY = (t.clientY - rect.top) * (H / rect.height);
      
      const distToSlider = Math.hypot(touchX - myPos.current.x, touchY - (myPos.current.y + 85));
      const distToShip = Math.hypot(touchX - myPos.current.x, touchY - myPos.current.y);
      
      if (distToSlider < 50) activeTouchType.current = 'steering';
      else if (distToShip < 60) activeTouchType.current = 'dragging';
    }

    if (e.type === "touchmove" && activeTouchType.current) {
      const touchX = (t.clientX - rect.left) * (W / rect.width);
      const touchY = (t.clientY - rect.top) * (H / rect.height);

      if (activeTouchType.current === 'steering') {
        const deltaX = touchX - myPos.current.x;
        myRot.current = Math.max(-1.22, Math.min(1.22, deltaX * 0.02));
      } else {
        myPos.current.x = Math.max(25, Math.min(W - 25, touchX));
        myPos.current.y = Math.max(H / 2 + 50, Math.min(H - 120, touchY));
      }
      socket.current.emit("move", { roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current });
    }

    if (e.type === "touchend") activeTouchType.current = null;
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const drawShooter = (x, y, rot, color, isEnemy) => {
        ctx.save();
        ctx.translate(x, y);
        if (!isEnemy) {
          const deckY = 85;
          ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-40, deckY); ctx.lineTo(40, deckY); ctx.stroke();
          const knobX = (rot / 1.22) * 40;
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(knobX, deckY, 10, 0, Math.PI * 2); ctx.fill();
        }
        ctx.rotate(rot); 
        ctx.fillStyle = color; ctx.shadowBlur = 15; ctx.shadowColor = color;
        ctx.beginPath();
        if (isEnemy) {
          ctx.moveTo(0, 25); ctx.lineTo(-20, -15); ctx.lineTo(20, -15);
        } else {
          ctx.moveTo(0, -25); ctx.lineTo(-20, 15); ctx.lineTo(20, 15);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
    };

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      enemyPos.current.x = lerp(enemyPos.current.x, enemyTarget.current.x, 0.15);
      enemyPos.current.y = lerp(enemyPos.current.y, enemyTarget.current.y, 0.15);
      enemyRot.current = lerp(enemyRot.current, enemyTarget.current.rot, 0.15);

      drawShooter(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawShooter(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      [myBullets, enemyBullets].forEach((ref) => {
        ref.current.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = (ref === myBullets) ? "#fffb00" : "#ff8c00";
          ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI * 2); ctx.fill();

          const target = (ref === myBullets) ? enemyPos.current : myPos.current;
          if (Math.hypot(b.x - target.x, b.y - target.y) < 25) {
            ref.current.splice(i, 1);
            if (ref === enemyBullets) {
                socket.current.emit("take_damage", { roomId, victimRole: role });
            }
          }
          if (b.y < -50 || b.y > H + 50) ref.current.splice(i, 1);
        });
      });
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, roomId]);

  const iAmHost = role === 'host';
  const myDisplayName = iAmHost ? playerNames.host : playerNames.guest;
  const oppDisplayName = iAmHost ? playerNames.guest : playerNames.host;
  const myCurrentHP = iAmHost ? health.host : health.guest;
  const oppCurrentHP = iAmHost ? health.guest : health.host;

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{oppDisplayName}</span>
          <div className="mini-hp"><div className="fill opponent" style={{width: `${(oppCurrentHP/400)*100}%`}}/></div>
          <span className="hp-val red-text">{oppCurrentHP} HP</span>
        </div>
        <div className="stat-box">
          <span className="name">YOU ({myDisplayName})</span>
          <div className="mini-hp"><div className="fill local" style={{width: `${(myCurrentHP/400)*100}%`}}/></div>
          <span className="hp-val blue-text">{myCurrentHP} HP</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><h1 className="countdown-text">{countdown}</h1></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}