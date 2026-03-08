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
  const myRot = useRef(0); // Rotation in radians (max +/- 1.22 for 70deg)
  const isSteering = useRef(false); // Flag to separate move vs steer action

  const enemyPos = useRef({ x: 200, y: 100 });
  const enemyRot = useRef(0);
  
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);

  // 1. Sync & Role Assignment
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

  // 2. Countdown Timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // 3. Shooting Logic (Unlocked at countdown 0)
  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const speed = 12;
      // Use rotation for bullet trajectory
      const vx = Math.sin(myRot.current) * speed;
      const vy = -Math.cos(myRot.current) * speed;

      const bData = { x: myPos.current.x, y: myPos.current.y, vx, vy, rot: myRot.current };
      socket.current.emit("fire", { ...bData, roomId });
      myBullets.current.push(bData);
    }, 333);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  // 4. Input Handling: Move vs Steer
  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return; 
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches[0];
    const touchX = (t.clientX - rect.left) * (W / rect.width);
    const touchY = (t.clientY - rect.top) * (H / rect.height);

    // Coordinate system translation for ship base
    // The handle is directly at the base of the ship (myPos)
    const handleYOffset = 30; // Handle is 30px below ship center
    const handleDistX = Math.abs(touchX - myPos.current.x);
    const handleDistY = Math.abs(touchY - (myPos.current.y + handleYOffset));

    // A. Detect if initial touch hits the small drag handle
    if (e.type === "touchstart") {
      // Handle bounds: within +/- 20px horizontally, +/- 15px vertically of handle center
      if (handleDistX < 20 && handleDistY < 15) {
        isSteering.current = true;
      } else {
        isSteering.current = false;
      }
    }

    // B. If steering, change rotation based on horizontal delta from ship center
    if (isSteering.current) {
        const sensitivity = 0.01; // Radians per pixel delta
        const deltaX = touchX - myPos.current.x;
        // Cap rotation at +/- 1.22 radians (70 degrees)
        myRot.current = Math.max(-1.22, Math.min(1.22, deltaX * sensitivity));
    } else {
        // C. If not steering, move the ship (X/Y)
        let nY = Math.max(H / 2 + 50, Math.min(H - 80, touchY)); // Slightly higher min boundary for handle space
        let nX = Math.max(25, Math.min(W - 25, touchX));
        myPos.current = { x: nX, y: nY };
    }

    if (e.type === "touchend" || e.type === "touchcancel") {
        isSteering.current = false;
    }

    // D. Emit updated position and rotation
    // Note: Rotation is negated for the mirrored system
    socket.current.emit("move", { roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current });
  };

  // 5. Rendering: Drawing the dynamic, steering shooters
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const drawShooter = (x, y, rot, color, isEnemy) => {
        ctx.save();
        ctx.translate(x, y);
        // Apply ship rotation
        ctx.rotate(rot);
        
        // 5a. Triangular Shooter Body
        ctx.fillStyle = color;
        ctx.beginPath();
        const tipY = isEnemy ? 25 : -25;
        const baseTop = isEnemy ? -15 : 15;
        ctx.moveTo(0, tipY);
        ctx.lineTo(-20, baseTop);
        ctx.lineTo(20, baseTop);
        ctx.fill();

        // 5b. Steering Wheel (The Circle)
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 10, 15, 0, Math.PI * 2);
        ctx.stroke();

        // 5c. Rotating Wheel Spokes (Visually spins with rotation)
        // We draw the spokes at an angle equal to the current rotation
        ctx.save();
        ctx.rotate(rot); // Additional visual spin matching steering angle
        ctx.beginPath();
        ctx.moveTo(-15, 10); ctx.lineTo(15, 10); // Horizontal spoke
        ctx.moveTo(0, -5); ctx.lineTo(0, 25);   // Vertical spoke
        ctx.stroke();
        ctx.restore();

        // 5d. The Drag Handle/Slider (Small, fixed at ship base, draggable with ship)
        // We draw this slightly below the wheel circle.
        // It's cyan to indicate interactivity, small (20x10), and flat-bottomed.
        if (!isEnemy) {
            ctx.fillStyle = "#00f2ff"; 
            ctx.beginPath();
            ctx.rect(-10, 30, 20, 8); // x, y, width, height (Relative to ship base)
            ctx.fill();
            // A small glow to highlight the interaction point
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00f2ff";
            ctx.fill();
        }
        
        ctx.restore();
    };

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#333";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

      // Draw Local (Blue, Steerable)
      drawShooter(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      // Draw Enemy (Red, Mirrored)
      drawShooter(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      // Bullet Physics (Angular updates)
      myBullets.current.forEach((b, i) => {
        b.x += b.vx;
        b.y += b.vy;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = "#fffb00";
        ctx.fillRect(-2, -10, 4, 20);
        ctx.restore();

        if (Math.hypot(b.x - enemyPos.current.x, b.y - enemyPos.current.y) < 25) {
          myBullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role === 'host' ? 'guest' : 'host' });
        }
        if (b.y < -50 || b.x < -50 || b.x > W + 50) myBullets.current.splice(i, 1);
      });

      // Enemy Bullet Physics (Mirrored Angular updates)
      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx;
        b.y += b.vy;
        let drawX = W - b.x;
        let drawY = H - b.y;

        ctx.save();
        ctx.translate(drawX, drawY);
        // Mirror the bullet's rotation
        ctx.rotate(-b.rot);
        ctx.fillStyle = "#ff8c00";
        ctx.fillRect(-2, -10, 4, 20);
        ctx.restore();

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
  }, [role, roomId]);

  // Identity Mapping (preserved)
  const isHost = role === 'host';
  const localName = isHost ? playerNames.host : playerNames.guest;
  const oppName = isHost ? playerNames.guest : playerNames.host;
  const localHP = isHost ? health.host : health.guest;
  const oppHP = isHost ? health.guest : health.host;

  return (
    // We explicitly bind touchstart and touchend to manage the drag-handle state
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch} onTouchCancel={handleTouch}>
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
      {countdown > 0 && (
        <div className="overlay countdown-bg">
          <h1 className="countdown-text">{countdown}</h1>
          <p className="countdown-sub">GET READY...</p>
        </div>
      )}
      {gameOver && (
        <div className="overlay">
          <h1 className={gameOver}>{gameOver.toUpperCase()}</h1>
          <button onClick={() => navigate("/")}>EXIT</button>
        </div>
      )}
    </div>
  );
}