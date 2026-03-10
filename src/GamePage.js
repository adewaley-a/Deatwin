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
  const [shieldHealth, setShieldHealth] = useState({ host: 150, guest: 150 });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(3);

  const W = 400, H = 700;
  const myPos = useRef({ x: 200, y: 600 });
  const myBoxPos = useRef({ x: 150, y: 500 });
  const myShieldPos = useRef({ x: 200, y: 450 });
  const myRot = useRef(0); 
  const activeTouches = useRef({}); 

  const enemyPos = useRef({ x: 200, y: 100 });
  const enemyBoxPos = useRef({ x: 250, y: 200 });
  const enemyShieldPos = useRef({ x: 200, y: 250 });
  const enemyRot = useRef(0);
  const enemyTarget = useRef({ x: 200, y: 100, rot: 0, boxX: 250, boxY: 200, sX: 200, sY: 250 }); 
  
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
    socket.current.on("assign_role", (data) => { setRole(data.role); socket.current.role = data.role; });
    socket.current.on("opp_move", (data) => { enemyTarget.current = data; });
    socket.current.on("incoming_bullet", (b) => { enemyBullets.current.push(b); });
    socket.current.on("update_game_state", (data) => {
      setHealth(data.health);
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const iAmHost = socket.current.role === 'host';
        const lost = iAmHost ? data.health.host <= 0 : data.health.guest <= 0;
        setGameOver(lost ? "lose" : "win");
      }
    });

    return () => { unsub(); socket.current.disconnect(); };
  }, [roomId]);

  useEffect(() => {
    if (countdown <= 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const angle = myRot.current;
      const tipX = myPos.current.x + Math.sin(angle) * 25;
      const tipY = myPos.current.y - Math.cos(angle) * 25;
      const vx = Math.sin(angle) * 14;
      const vy = -Math.cos(angle) * 14;
      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy, rot: -angle });
      myBullets.current.push({ x: tipX, y: tipY, vx, vy, rot: angle });
    }, 250);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();

    if (e.type === "touchstart") {
      for (let t of e.changedTouches) {
        const tx = (t.clientX - rect.left) * (W / rect.width);
        const ty = (t.clientY - rect.top) * (H / rect.height);
        let type = null;
        // Logic check: Shield and Box only draggable if HP > 0
        if (Math.hypot(tx - myPos.current.x, ty - (myPos.current.y + 40)) < 30) type = 'steering';
        else if (Math.hypot(tx - myPos.current.x, ty - myPos.current.y) < 50) type = 'dragging';
        else if (boxHealth[role] > 0 && Math.hypot(tx - myBoxPos.current.x, ty - myBoxPos.current.y) < 40) type = 'box';
        else if (shieldHealth[role] > 0 && Math.hypot(tx - myShieldPos.current.x, ty - myShieldPos.current.y) < 60) type = 'shield';
        
        if (type) activeTouches.current[t.identifier] = type;
      }
    }

    if (e.type === "touchmove") {
      for (let t of e.changedTouches) {
        const type = activeTouches.current[t.identifier];
        if (!type) continue;
        const tx = (t.clientX - rect.left) * (W / rect.width);
        const ty = (t.clientY - rect.top) * (H / rect.height);

        if (type === 'steering') {
          myRot.current = Math.max(-1.22, Math.min(1.22, (tx - myPos.current.x) * 0.04));
        } else if (type === 'dragging') {
          myPos.current.x = Math.max(25, Math.min(W - 25, tx));
          myPos.current.y = Math.max(H / 2 + 50, Math.min(H - 80, ty));
        } else if (type === 'box') {
          myBoxPos.current.x = Math.max(30, Math.min(W - 30, tx));
          myBoxPos.current.y = Math.max(H / 2 + 20, Math.min(H - 50, ty));
        } else if (type === 'shield') {
          myShieldPos.current.x = Math.max(50, Math.min(W - 50, tx));
          myShieldPos.current.y = Math.max(H / 2 + 10, Math.min(H - 100, ty));
        }
      }
      socket.current.emit("move", { 
        roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current,
        boxX: W - myBoxPos.current.x, boxY: H - myBoxPos.current.y,
        sX: W - myShieldPos.current.x, sY: H - myShieldPos.current.y
      });
    }

    if (e.type === "touchend" || e.type === "touchcancel") {
      for (let t of e.changedTouches) delete activeTouches.current[t.identifier];
    }
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
      enemyShieldPos.current.x = lerp(enemyShieldPos.current.x, enemyTarget.current.sX, 0.15);
      enemyShieldPos.current.y = lerp(enemyShieldPos.current.y, enemyTarget.current.sY, 0.15);

      const drawShield = (p, color, isE, hp) => {
        if (hp <= 0) return;
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.shadowBlur = 10; ctx.shadowColor = color;
        ctx.beginPath();
        // Arc covering ~80% width (~120px wide)
        ctx.arc(0, isE ? 10 : -10, 80, isE ? 0.4 : Math.PI + 0.4, isE ? Math.PI - 0.4 : 2 * Math.PI - 0.4);
        ctx.stroke(); ctx.restore();
      };

      drawShield(myShieldPos.current, "#00f2ff", false, shieldHealth[role]);
      drawShield(enemyShieldPos.current, "#ff3e3e", true, shieldHealth[role === 'host' ? 'guest' : 'host']);

      // Boxes
      if (boxHealth[role] > 0) {
        ctx.strokeStyle = "#00f2ff"; ctx.strokeRect(myBoxPos.current.x - 25, myBoxPos.current.y - 25, 50, 50);
      }
      if (boxHealth[role === 'host' ? 'guest' : 'host'] > 0) {
        ctx.strokeStyle = "#ff3e3e"; ctx.strokeRect(enemyBoxPos.current.x - 25, enemyBoxPos.current.y - 25, 50, 50);
      }

      // Shooters
      const drawS = (x, y, r, c, isE) => {
        ctx.save(); ctx.translate(x, y);
        if (!isE) {
            ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.beginPath(); ctx.arc(0, 40, 20, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc((r/1.22)*15, 40, 8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.rotate(r); ctx.fillStyle = c; ctx.shadowBlur = 15; ctx.shadowColor = c;
        ctx.beginPath();
        if (isE) { ctx.moveTo(0, 25); ctx.lineTo(-20, -15); ctx.lineTo(20, -15); } 
        else { ctx.moveTo(0, -25); ctx.lineTo(-20, 15); ctx.lineTo(20, 15); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      };
      drawS(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawS(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      // Bullets (smaller 4px)
      [myBullets, enemyBullets].forEach((ref) => {
        ref.current.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = (ref === myBullets) ? "#fffb00" : "#ff8c00";
          ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();

          const isMyB = ref === myBullets;
          const oppRole = role === 'host' ? 'guest' : 'host';
          const tP = isMyB ? enemyPos.current : myPos.current;
          const tB = isMyB ? enemyBoxPos.current : myBoxPos.current;
          const tS = isMyB ? enemyShieldPos.current : myShieldPos.current;

          // Hit Collision
          if (Math.hypot(b.x - tP.x, b.y - tP.y) < 20) {
            ref.current.splice(i, 1);
            if (isMyB) socket.current.emit("take_damage", { roomId, target: 'player', victimRole: oppRole });
          } else if (shieldHealth[isMyB ? oppRole : role] > 0 && Math.hypot(b.x - tS.x, b.y - tS.y) < 70) {
            ref.current.splice(i, 1);
            if (isMyB) socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: oppRole });
          } else if (boxHealth[isMyB ? oppRole : role] > 0 && Math.hypot(b.x - tB.x, b.y - tB.y) < 30) {
            ref.current.splice(i, 1);
            if (isMyB) socket.current.emit("take_damage", { roomId, target: 'box', victimRole: oppRole });
          }
          if (b.y < -50 || b.y > H + 50) ref.current.splice(i, 1);
        });
      });
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, roomId, boxHealth, shieldHealth]);

  const iAmH = role === 'host';
  const oppR = iAmH ? 'guest' : 'host';

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{iAmH ? playerNames.guest : playerNames.host}</span>
          <div className="mini-hp"><div className="fill opponent" style={{width: `${(health[oppR]/400)*100}%`}}/></div>
          <div className="sub-hp">
            <div className="bar b-box" style={{width: `${(boxHealth[oppR]/200)*100}%`}}/>
            <div className="bar b-shield" style={{width: `${(shieldHealth[oppR]/150)*100}%`}}/>
          </div>
        </div>
        <div className="stat-box">
          <span className="name">YOU ({iAmH ? playerNames.host : playerNames.guest})</span>
          <div className="mini-hp"><div className="fill local" style={{width: `${(health[role]/400)*100}%`}}/></div>
          <div className="sub-hp">
            <div className="bar b-box" style={{width: `${(boxHealth[role]/200)*100}%`}}/>
            <div className="bar b-shield" style={{width: `${(shieldHealth[role]/150)*100}%`}}/>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><h1 className="countdown-text">{countdown}</h1></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}