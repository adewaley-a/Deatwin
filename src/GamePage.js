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
  const myBoxPos = useRef({ x: 150, y: 530 });
  const myShieldPos = useRef({ x: 200, y: 480 });
  const myRot = useRef(0); 
  const activeTouches = useRef({}); 

  const enemyPos = useRef({ x: 200, y: 100 });
  const enemyBoxPos = useRef({ x: 250, y: 170 });
  const enemyShieldPos = useRef({ x: 200, y: 220 });
  const enemyRot = useRef(0);
  const enemyTarget = useRef({ x: 200, y: 100, rot: 0, boxX: 250, boxY: 170, sX: 200, sY: 220 }); 
  
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]); // Particle system ref

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setPlayerNames({ host: d.hostName || "Host", guest: d.guestName || "Guest" });
      }
    });

    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current.emit("join_game", { roomId });
    
    socket.current.on("assign_role", (data) => { 
        setRole(data.role); 
        socket.current.role = data.role; 
    });

    socket.current.on("opp_move", (data) => { enemyTarget.current = data; });
    socket.current.on("incoming_bullet", (b) => { enemyBullets.current.push(b); });
    
    socket.current.on("update_game_state", (data) => {
      if(data.health) setHealth({...data.health});
      if(data.boxHealth) setBoxHealth({...data.boxHealth});
      if(data.shieldHealth) setShieldHealth({...data.shieldHealth});
      
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const lost = socket.current.role === 'host' ? data.health.host <= 0 : data.health.guest <= 0;
        setGameOver(lost ? "lose" : "win");
      }
    });

    return () => { unsub(); socket.current.disconnect(); };
  }, [roomId]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const angle = myRot.current;
      const vx = Math.sin(angle) * 15;
      const vy = -Math.cos(angle) * 15;
      const b = { x: myPos.current.x, y: myPos.current.y - 20, vx, vy };
      
      socket.current.emit("fire", { roomId, x: W - b.x, y: H - b.y, vx: -vx, vy: -vy, rot: -angle });
      myBullets.current.push(b);
    }, 280);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const createSparks = (x, y, color) => {
    for (let i = 0; i < 8; i++) {
      sparks.current.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        life: 1.0,
        color
      });
    }
  };

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();

    if (e.type === "touchstart") {
      for (let t of e.changedTouches) {
        const tx = (t.clientX - rect.left) * (W / rect.width);
        const ty = (t.clientY - rect.top) * (H / rect.height);
        let type = null;

        if (Math.hypot(tx - myPos.current.x, ty - (myPos.current.y + 45)) < 35) type = 'steering';
        else if (Math.hypot(tx - myPos.current.x, ty - myPos.current.y) < 45) type = 'dragging';
        else if (boxHealth[role] > 0 && Math.hypot(tx - myBoxPos.current.x, ty - myBoxPos.current.y) < 40) type = 'box';
        else if (shieldHealth[role] > 0 && Math.hypot(tx - myShieldPos.current.x, ty - myShieldPos.current.y) < 50) type = 'shield';
        
        if (type) activeTouches.current[t.identifier] = type;
      }
    }

    if (e.type === "touchmove") {
      for (let t of e.changedTouches) {
        const type = activeTouches.current[t.identifier];
        if (!type) continue;
        const tx = (t.clientX - rect.left) * (W / rect.width);
        const ty = (t.clientY - rect.top) * (H / rect.height);

        if (type === 'steering') myRot.current = Math.max(-1.2, Math.min(1.2, (tx - myPos.current.x) * 0.05));
        else if (type === 'dragging') {
          myPos.current.x = Math.max(30, Math.min(W - 30, tx));
          myPos.current.y = Math.max(H / 2 + 100, Math.min(H - 80, ty));
        } else if (type === 'box') {
          myBoxPos.current.x = Math.max(30, Math.min(W - 30, tx));
          myBoxPos.current.y = Math.max(H / 2 + 50, Math.min(H - 50, ty));
        } else if (type === 'shield') {
          myShieldPos.current.x = Math.max(50, Math.min(W - 50, tx));
          myShieldPos.current.y = Math.max(H / 2 + 20, Math.min(H - 120, ty));
        }
      }
      socket.current.emit("move", { 
        roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current,
        boxX: W - myBoxPos.current.x, boxY: H - myBoxPos.current.y,
        sX: W - myShieldPos.current.x, sY: H - myShieldPos.current.y
      });
    }
    if (e.type === "touchend") for (let t of e.changedTouches) delete activeTouches.current[t.identifier];
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      enemyPos.current.x = lerp(enemyPos.current.x, enemyTarget.current.x, 0.2);
      enemyPos.current.y = lerp(enemyPos.current.y, enemyTarget.current.y, 0.2);
      enemyRot.current = lerp(enemyRot.current, enemyTarget.current.rot, 0.2);
      enemyBoxPos.current.x = lerp(enemyBoxPos.current.x, enemyTarget.current.boxX, 0.2);
      enemyBoxPos.current.y = lerp(enemyBoxPos.current.y, enemyTarget.current.boxY, 0.2);
      enemyShieldPos.current.x = lerp(enemyShieldPos.current.x, enemyTarget.current.sX, 0.2);
      enemyShieldPos.current.y = lerp(enemyShieldPos.current.y, enemyTarget.current.sY, 0.2);

      const drawShield = (p, color, isE, hp) => {
        if (hp <= 0) return;
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, isE ? 10 : -10, 50, isE ? 0.9 : Math.PI + 0.9, isE ? Math.PI - 0.9 : 2 * Math.PI - 0.9);
        ctx.stroke(); ctx.restore();
      };
      drawShield(myShieldPos.current, "#00f2ff", false, shieldHealth[role]);
      drawShield(enemyShieldPos.current, "#ff3e3e", true, shieldHealth[role === 'host' ? 'guest' : 'host']);

      const drawBox = (p, color, hp) => {
        if (hp <= 0) return;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.strokeRect(p.x - 20, p.y - 20, 40, 40);
      };
      drawBox(myBoxPos.current, "#00f2ff", boxHealth[role]);
      drawBox(enemyBoxPos.current, "#ff3e3e", boxHealth[role === 'host' ? 'guest' : 'host']);

      const drawS = (x, y, r, c, isE) => {
        ctx.save(); ctx.translate(x, y);
        if (!isE) {
            ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.beginPath(); ctx.arc(0, 45, 18, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc((r/1.2)*14, 45, 7, 0, Math.PI * 2); ctx.fill();
        }
        ctx.rotate(r); ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0, 20); ctx.lineTo(-18, -12); ctx.lineTo(18, -12); } 
        else { ctx.moveTo(0, -20); ctx.lineTo(-18, 12); ctx.lineTo(18, 12); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      };
      drawS(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawS(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      // Render Sparks
      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.life -= 0.05;
        if (s.life <= 0) sparks.current.splice(i, 1);
        else {
          ctx.globalAlpha = s.life; ctx.fillStyle = s.color;
          ctx.fillRect(s.x, s.y, 2, 2); ctx.globalAlpha = 1;
        }
      });

      // Bullet Logic
      [myBullets, enemyBullets].forEach((ref) => {
        ref.current.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = ref === myBullets ? "#fffb00" : "#ff3e3e";
          ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();

          const isMyB = ref === myBullets;
          const oppRole = role === 'host' ? 'guest' : 'host';
          const tP = isMyB ? enemyPos.current : myPos.current;
          const tB = isMyB ? enemyBoxPos.current : myBoxPos.current;
          const tS = isMyB ? enemyShieldPos.current : myShieldPos.current;

          if (shieldHealth[isMyB ? oppRole : role] > 0 && Math.hypot(b.x - tS.x, b.y - tS.y) < 55) {
            createSparks(b.x, b.y, isMyB ? "#00f2ff" : "#ff3e3e");
            ref.current.splice(i, 1);
            if (isMyB) socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: oppRole });
            return;
          }
          if (Math.hypot(b.x - tP.x, b.y - tP.y) < 22) {
            createSparks(b.x, b.y, "#fff");
            ref.current.splice(i, 1);
            if (isMyB) socket.current.emit("take_damage", { roomId, target: 'player', victimRole: oppRole });
            return;
          }
          if (boxHealth[isMyB ? oppRole : role] > 0 && Math.hypot(b.x - tB.x, b.y - tB.y) < 25) {
            createSparks(b.x, b.y, "#ffd700");
            ref.current.splice(i, 1);
            if (isMyB) socket.current.emit("take_damage", { roomId, target: 'box', victimRole: oppRole });
            return;
          }
          if (b.y < -50 || b.y > H + 50) ref.current.splice(i, 1);
        });
      });
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, roomId, boxHealth, shieldHealth]);

  const h_opp = health[role === 'host' ? 'guest' : 'host'];
  const h_me = health[role];

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">OPPONENT</span>
          <div className="mini-hp"><div className="fill red" style={{width: `${(h_opp/400)*100}%`}}/></div>
        </div>
        <div className="stat-box">
          <span className="name">YOU</span>
          <div className="mini-hp"><div className="fill blue" style={{width: `${(h_me/400)*100}%`}}/></div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><h1 className="count">{countdown}</h1></div>}
      {gameOver && <div className="overlay"><h1>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}