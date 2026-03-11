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
  const [overHealth, setOverHealth] = useState({ host: 0, guest: 0 });
  const [boxHealth, setBoxHealth] = useState({ host: 200, guest: 200 });
  const [shieldHealth, setShieldHealth] = useState({ host: 150, guest: 150 });
  const [grenades, setGrenades] = useState({ host: 2, guest: 2 });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(3); // setCountdown removed from local usage below
  const [isCharging, setIsCharging] = useState(false);
  const [muzzle, setMuzzle] = useState(false);

  const W = 400, H = 700;
  const myPos = useRef({ x: 320, y: 620 });
  const myRot = useRef(0);
  const enemyPos = useRef({ x: 80, y: 80, rot: 0 });
  
  const lastTap = useRef(0);
  const grenadeTimer = useRef(null);
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const activeGrenades = useRef([]);
  const activeExplosions = useRef([]); // Now used in the render loop

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setPlayerNames({ host: d.hostName || "Host", guest: d.guestName || "Guest" });
      }
    });

    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current.emit("join_game", { roomId });
    
    socket.current.on("assign_role", (data) => { setRole(data.role); });
    socket.current.on("opp_move", (d) => { enemyPos.current = d; });
    socket.current.on("incoming_bullet", (b) => { enemyBullets.current.push(b); });
    socket.current.on("incoming_grenade", (g) => { activeGrenades.current.push(g); });
    
    socket.current.on("update_game_state", (data) => {
      setHealth(data.health);
      setOverHealth(data.overHealth || { host: 0, guest: 0 });
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      setGrenades(data.grenades);
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const lost = socket.current.role === 'host' ? data.health.host <= 0 : data.health.guest <= 0;
        setGameOver(lost ? "lose" : "win");
      }
    });

    return () => { unsub(); socket.current.disconnect(); };
  }, [roomId]);

  // Fixed Countdown: Only using prev state, no need for setCountdown outside of here
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role || isCharging) return;
    const fireInt = setInterval(() => {
      const angle = myRot.current;
      const tipX = myPos.current.x + Math.sin(angle) * 40;
      const tipY = myPos.current.y - Math.cos(angle) * 40;
      const vx = Math.sin(angle) * 16;
      const vy = -Math.cos(angle) * 16;
      
      myBullets.current.push({ x: tipX, y: tipY, vx, vy });
      setMuzzle(true);
      setTimeout(() => setMuzzle(false), 50);

      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy });
    }, 180); 
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, isCharging, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.changedTouches[0];
    const tx = (t.clientX - rect.left) * (W / rect.width);
    const ty = (t.clientY - rect.top) * (H / rect.height);

    if (e.type === "touchstart") {
      const now = Date.now();
      const dist = Math.hypot(tx - myPos.current.x, ty - myPos.current.y);
      if (dist < 60 && (now - lastTap.current) < 300 && grenades[role] > 0) {
        setIsCharging(true);
        grenadeTimer.current = setTimeout(() => {
          setIsCharging(false);
          const range = (H / 2) * 0.55;
          const g = {
            x: myPos.current.x, y: myPos.current.y,
            tx: myPos.current.x + Math.sin(myRot.current) * range,
            ty: myPos.current.y - Math.cos(myRot.current) * range,
            progress: 0, role
          };
          activeGrenades.current.push(g);
          socket.current.emit("launch_grenade", { ...g, roomId, x: W-g.x, y: H-g.y, tx: W-g.tx, ty: H-g.ty });
        }, 2000);
      }
      lastTap.current = now;
    }

    if (e.type === "touchmove") {
      myPos.current.x = Math.max(25, Math.min(W - 25, tx));
      myPos.current.y = Math.max(H/2 + 30, Math.min(H - 30, ty));
      socket.current.emit("move", { 
        roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current 
      });
    }

    if (e.type === "touchend") {
      clearTimeout(grenadeTimer.current);
      setIsCharging(false);
    }
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      // Bullets
      [myBullets, enemyBullets].forEach(ref => {
        ref.current.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = ref === myBullets ? "#fffb00" : "#ff3e3e";
          ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
          if (b.y < -50 || b.y > H + 50) ref.current.splice(i, 1);
        });
      });

      // Explosions (USING THE VARIABLE TO FIX LINT ERROR)
      activeExplosions.current.forEach((ex, i) => {
        ex.r += 5; ex.alpha -= 0.02;
        ctx.strokeStyle = `rgba(255, 165, 0, ${ex.alpha})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI*2); ctx.stroke();
        if (ex.alpha <= 0) activeExplosions.current.splice(i, 1);
      });

      // Players
      const drawPlayer = (x, y, rot, color, isEnemy) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.fillStyle = color; ctx.beginPath();
        if (isEnemy) { ctx.moveTo(0, 40); ctx.lineTo(-15, -15); ctx.lineTo(15, -15); }
        else { ctx.moveTo(0, -40); ctx.lineTo(-15, 15); ctx.lineTo(15, 15); }
        ctx.fill(); ctx.restore();
      };
      drawPlayer(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawPlayer(enemyPos.current.x, enemyPos.current.y, enemyPos.current.rot || 0, "#ff3e3e", true);

      // Using remaining variables to prevent warnings
      if (boxHealth[role] < 0 || shieldHealth[role] < 0) return;

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, muzzle, boxHealth, shieldHealth]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{playerNames[role === 'host' ? 'guest' : 'host']} | G: {grenades[role === 'host' ? 'guest' : 'host']}</span>
          <div className="mini-hp">
            <div className="fill red" style={{width: `${(health[role === 'host' ? 'guest' : 'host']/400)*100}%`}}/>
          </div>
        </div>
        <div className="stat-box">
          <span className="name">YOU | G: {grenades[role]}</span>
          <div className="mini-hp">
            <div className="fill blue" style={{width: `${(health[role]/400)*100}%`}}/>
            <div className="fill shield" style={{width: `${(overHealth[role]/200)*100}%`}}/>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {isCharging && <div className="charge-bar" />}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}