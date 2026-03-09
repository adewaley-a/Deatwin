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
  const [boxHealth, setBoxHealth] = useState({ host: 200, guest: 200 });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(3);

  const W = 400, H = 700;
  const myPos = useRef({ x: 200, y: 600 });
  const myBoxPos = useRef({ x: 200, y: 500 });
  const myRot = useRef(0); 
  const activeTouchType = useRef(null); // 'steering', 'dragging', 'box'

  const enemyPos = useRef({ x: 200, y: 100 });
  const enemyBoxPos = useRef({ x: 200, y: 200 });
  const enemyRot = useRef(0);
  const enemyTarget = useRef({ x: 200, y: 100, rot: 0, boxX: 200, boxY: 200 }); 
  
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
    socket.current.on("opp_move", (data) => { enemyTarget.current = data; });
    socket.current.on("incoming_bullet", (b) => { enemyBullets.current.push(b); });
    socket.current.on("update_game_state", (data) => {
      setHealth(data.health);
      setBoxHealth(data.boxHealth);
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const iAmHost = socket.current.role === 'host';
        const lost = iAmHost ? data.health.host <= 0 : data.health.guest <= 0;
        setGameOver(lost ? "lose" : "win");
      }
    });

    return () => { unsub(); socket.current.disconnect(); };
  }, [roomId]);

  useEffect(() => { if (socket.current) socket.current.role = role; }, [role]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const angle = myRot.current;
      const tipX = myPos.current.x + Math.sin(angle) * 25;
      const tipY = myPos.current.y - Math.cos(angle) * 25;
      const vx = Math.sin(angle) * 14;
      const vy = -Math.cos(angle) * 14;

      socket.current.emit("fire", { 
        roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy, rot: -angle 
      });
      myBullets.current.push({ x: tipX, y: tipY, vx, vy, rot: angle });
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
      if (Math.hypot(touchX - myPos.current.x, touchY - (myPos.current.y + 85)) < 50) activeTouchType.current = 'steering';
      else if (Math.hypot(touchX - myPos.current.x, touchY - myPos.current.y) < 60) activeTouchType.current = 'dragging';
      else if (Math.hypot(touchX - myBoxPos.current.x, touchY - myBoxPos.current.y) < 40) activeTouchType.current = 'box';
    }

    if (e.type === "touchmove" && activeTouchType.current) {
      const touchX = (t.clientX - rect.left) * (W / rect.width);
      const touchY = (t.clientY - rect.top) * (H / rect.height);

      if (activeTouchType.current === 'steering') {
        myRot.current = Math.max(-1.22, Math.min(1.22, (touchX - myPos.current.x) * 0.02));
      } else if (activeTouchType.current === 'dragging') {
        myPos.current.x = Math.max(25, Math.min(W - 25, touchX));
        myPos.current.y = Math.max(H / 2 + 50, Math.min(H - 120, touchY));
        // Push box if ship hits it
        if (Math.hypot(myPos.current.x - myBoxPos.current.x, myPos.current.y - myBoxPos.current.y) < 50) {
            myBoxPos.current.x = myPos.current.x; myBoxPos.current.y = myPos.current.y - 60;
        }
      } else if (activeTouchType.current === 'box') {
        myBoxPos.current.x = Math.max(30, Math.min(W - 30, touchX));
        myBoxPos.current.y = Math.max(H / 2 + 20, Math.min(H - 50, touchY));
      }
      
      socket.current.emit("move", { 
        roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current,
        boxX: W - myBoxPos.current.x, boxY: H - myBoxPos.current.y
      });
    }
    if (e.type === "touchend") activeTouchType.current = null;
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      enemyPos.current.x = lerp(enemyPos.current.x, enemyTarget.current.x, 0.15);
      enemyPos.current.y = lerp(enemyPos.current.y, enemyTarget.current.y, 0.15);
      enemyRot.current = lerp(enemyRot.current, enemyTarget.current.rot, 0.15);
      enemyBoxPos.current.x = lerp(enemyBoxPos.current.x, enemyTarget.current.boxX, 0.15);
      enemyBoxPos.current.y = lerp(enemyBoxPos.current.y, enemyTarget.current.boxY, 0.15);

      // Draw Boxes
      [myBoxPos.current, enemyBoxPos.current].forEach((p, i) => {
        ctx.fillStyle = i === 0 ? "#00f2ff" : "#ff3e3e";
        ctx.globalAlpha = 0.3; ctx.fillRect(p.x - 25, p.y - 25, 50, 50);
        ctx.globalAlpha = 1.0; ctx.strokeStyle = ctx.fillStyle; ctx.strokeRect(p.x - 25, p.y - 25, 50, 50);
      });

      // Draw Shooters
      const drawS = (x, y, r, c, isE) => {
        ctx.save(); ctx.translate(x, y);
        if (!isE) {
            ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.beginPath(); ctx.moveTo(-40, 85); ctx.lineTo(40, 85); ctx.stroke();
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc((r / 1.22) * 40, 85, 10, 0, Math.PI * 2); ctx.fill();
        }
        ctx.rotate(r); ctx.fillStyle = c; ctx.shadowBlur = 15; ctx.shadowColor = c;
        ctx.beginPath();
        if (isE) { ctx.moveTo(0, 25); ctx.lineTo(-20, -15); ctx.lineTo(20, -15); } 
        else { ctx.moveTo(0, -25); ctx.lineTo(-20, 15); ctx.lineTo(20, 15); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      };
      drawS(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawS(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      // Bullets
      [myBullets, enemyBullets].forEach((ref) => {
        ref.current.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = (ref === myBullets) ? "#fffb00" : "#ff8c00";
          ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI * 2); ctx.fill();

          // Hit logic
          if (Math.hypot(b.x - (ref === myBullets ? enemyPos.current.x : myPos.current.x), b.y - (ref === myBullets ? enemyPos.current.y : myPos.current.y)) < 25) {
            ref.current.splice(i, 1);
            if (ref === enemyBullets) socket.current.emit("take_damage", { roomId, target: 'player', victimRole: role });
          } else if (Math.hypot(b.x - (ref === myBullets ? enemyBoxPos.current.x : myBoxPos.current.x), b.y - (ref === myBullets ? enemyBoxPos.current.y : myBoxPos.current.y)) < 30) {
            ref.current.splice(i, 1);
            if (ref === enemyBullets) socket.current.emit("take_damage", { roomId, target: 'box', victimRole: role });
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
  const myName = iAmHost ? playerNames.host : playerNames.guest;
  const oppName = iAmHost ? playerNames.guest : playerNames.host;
  
  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{oppName}</span>
          <div className="mini-hp"><div className="fill opponent" style={{width: `${(health[iAmHost?'guest':'host']/400)*100}%`}}/></div>
          <div className="box-hp-bar"><div className="fill box" style={{width: `${(boxHealth[iAmHost?'guest':'host']/200)*100}%`}}/></div>
        </div>
        <div className="stat-box">
          <span className="name">YOU ({myName})</span>
          <div className="mini-hp"><div className="fill local" style={{width: `${(health[role]/400)*100}%`}}/></div>
          <div className="box-hp-bar"><div className="fill box" style={{width: `${(boxHealth[role]/200)*100}%`}}/></div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><h1 className="countdown-text">{countdown}</h1></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}