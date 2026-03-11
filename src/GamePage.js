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
  const [healAnim, setHealAnim] = useState({ show: false, target: null });

  const W = 400, H = 700;

  const myPos = useRef({ x: 320, y: 620 });
  const myBoxPos = useRef({ x: 340, y: 550 });
  const myShieldPos = useRef({ x: 300, y: 500 });
  const myRot = useRef(0); 
  const activeTouches = useRef({}); 

  const enemyPos = useRef({ x: 80, y: 80 });
  const enemyBoxPos = useRef({ x: 60, y: 150 });
  const enemyShieldPos = useRef({ x: 100, y: 200 });
  const enemyRot = useRef(0);
  const enemyTarget = useRef({ x: 80, y: 80, rot: 0, boxX: 60, boxY: 150, sX: 100, sY: 200 }); 
  
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]); 

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

    socket.current.on("opp_move", (d) => { enemyTarget.current = d; });
    socket.current.on("incoming_bullet", (b) => { enemyBullets.current.push(b); });
    
    socket.current.on("update_game_state", (data) => {
      if (data.targetHit === 'box') {
        setHealAnim({ show: true, target: data.attacker });
        setTimeout(() => setHealAnim({ show: false, target: null }), 800);
      }
      setHealth({...data.health});
      setBoxHealth({...data.boxHealth});
      setShieldHealth({...data.shieldHealth});
      
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
    // Bullet rate increased: 180ms instead of 280ms
    const fireInt = setInterval(() => {
      const angle = myRot.current;
      const vx = Math.sin(angle) * 16;
      const vy = -Math.cos(angle) * 16;
      const b = { x: myPos.current.x, y: myPos.current.y - 35, vx, vy };
      socket.current.emit("fire", { roomId, x: W - b.x, y: H - b.y, vx: -vx, vy: -vy, rot: -angle });
      myBullets.current.push(b);
    }, 180); 
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const createSparks = (x, y, color) => {
    for (let i = 0; i < 6; i++) {
      sparks.current.push({
        x, y, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5, life: 1.0, color
      });
    }
  };

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    for (let t of e.changedTouches) {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);
      
      if (e.type === "touchstart") {
        // Updated steering wheel touch detection area (y+55)
        if (Math.hypot(tx - myPos.current.x, ty - (myPos.current.y + 55)) < 45) activeTouches.current[t.identifier] = 'steering';
        else if (Math.hypot(tx - myPos.current.x, ty - myPos.current.y) < 45) activeTouches.current[t.identifier] = 'dragging';
        else if (boxHealth[role] > 0 && Math.hypot(tx - myBoxPos.current.x, ty - myBoxPos.current.y) < 40) activeTouches.current[t.identifier] = 'box';
        else if (shieldHealth[role] > 0 && Math.hypot(tx - myShieldPos.current.x, ty - myShieldPos.current.y) < 50) activeTouches.current[t.identifier] = 'shield';
      }
      
      if (e.type === "touchmove") {
        const type = activeTouches.current[t.identifier];
        if (!type) continue;
        const minY = H / 2 + 30;
        const maxY = H - 30;

        if (type === 'steering') myRot.current = Math.max(-1.3, Math.min(1.3, (tx - myPos.current.x) * 0.05));
        else if (type === 'dragging') {
          myPos.current.x = Math.max(25, Math.min(W - 25, tx));
          myPos.current.y = Math.max(minY, Math.min(maxY, ty));
        } else if (type === 'box') {
          myBoxPos.current.x = Math.max(25, Math.min(W - 25, tx));
          myBoxPos.current.y = Math.max(minY, Math.min(maxY, ty));
        } else if (type === 'shield') {
          myShieldPos.current.x = Math.max(55, Math.min(W - 55, tx));
          myShieldPos.current.y = Math.max(minY, Math.min(maxY, ty));
        }

        socket.current.emit("move", { 
          roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current,
          boxX: W - myBoxPos.current.x, boxY: H - myBoxPos.current.y,
          sX: W - myShieldPos.current.x, sY: H - myShieldPos.current.y
        });
      }
    }
    if (e.type === "touchend") for (let t of e.changedTouches) delete activeTouches.current[t.identifier];
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);

      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
      ctx.setLineDash([]);

      enemyPos.current.x = lerp(enemyPos.current.x, enemyTarget.current.x, 0.35);
      enemyPos.current.y = lerp(enemyPos.current.y, enemyTarget.current.y, 0.35);
      enemyRot.current = lerp(enemyRot.current, enemyTarget.current.rot, 0.35);
      enemyBoxPos.current.x = lerp(enemyBoxPos.current.x, enemyTarget.current.boxX, 0.35);
      enemyBoxPos.current.y = lerp(enemyBoxPos.current.y, enemyTarget.current.boxY, 0.35);
      enemyShieldPos.current.x = lerp(enemyShieldPos.current.x, enemyTarget.current.sX, 0.35);
      enemyShieldPos.current.y = lerp(enemyShieldPos.current.y, enemyTarget.current.sY, 0.35);

      const drawHPBar = (x, y, val, max, color) => {
        ctx.fillStyle = "#222"; ctx.fillRect(x - 20, y - 5, 40, 5);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y - 5, (val / max) * 40, 5);
      };

      const drawShield = (p, color, isE, hp) => {
        if (hp <= 0) return;
        // Attached closely to shield (y-15/y+15) and yellow color (#ffeb3b)
        drawHPBar(p.x, isE ? p.y + 15 : p.y - 15, hp, 150, "#ffeb3b");
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, isE ? 10 : -10, 50, isE ? 1 : Math.PI + 1, isE ? Math.PI - 1 : 2 * Math.PI - 1);
        ctx.stroke(); ctx.restore();
      };
      drawShield(myShieldPos.current, "#00f2ff", false, shieldHealth[role]);
      drawShield(enemyShieldPos.current, "#ff3e3e", true, shieldHealth[role === 'host' ? 'guest' : 'host']);

      const drawBox = (p, color, hp) => {
        if (hp <= 0) return;
        // Yellow HP bar for treasure box
        drawHPBar(p.x, p.y - 25, hp, 200, "#ffeb3b");
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.strokeRect(p.x - 20, p.y - 20, 40, 40);
      };
      drawBox(myBoxPos.current, "#00f2ff", boxHealth[role]);
      drawBox(enemyBoxPos.current, "#ff3e3e", boxHealth[role === 'host' ? 'guest' : 'host']);

      const drawS = (x, y, r, c, isE) => {
        ctx.save(); ctx.translate(x, y);
        if (!isE) {
            // Steering wheel space: 55px from center instead of 35px
            ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.beginPath(); ctx.arc(0, 55, 22, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc((r/1.3)*18, 55, 8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.rotate(r); ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0, 40); ctx.lineTo(-15, -15); ctx.lineTo(15, -15); } 
        else { ctx.moveTo(0, -40); ctx.lineTo(-15, 15); ctx.lineTo(15, 15); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      };
      drawS(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawS(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.life -= 0.05;
        if (s.life <= 0) sparks.current.splice(i, 1);
        else { ctx.globalAlpha = s.life; ctx.fillStyle = s.color; ctx.fillRect(s.x, s.y, 2, 2); ctx.globalAlpha = 1; }
      });

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

          // Shield collision: Only hit if touching the arc (radius check)
          const distToS = Math.hypot(b.x - tS.x, b.y - tS.y);
          if (shieldHealth[isMyB ? oppRole : role] > 0 && distToS > 45 && distToS < 60) {
            createSparks(b.x, b.y, isMyB ? "#00f2ff" : "#ff3e3e");
            ref.current.splice(i, 1);
            if (isMyB) socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: oppRole });
            return;
          }
          if (Math.hypot(b.x - tP.x, b.y - tP.y) < 28) {
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
  const myN = role === 'host' ? playerNames.host : playerNames.guest;
  const oppN = role === 'host' ? playerNames.guest : playerNames.host;

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{oppN}</span>
          <div className="mini-hp">
            <div className="fill red" style={{width: `${(h_opp/400)*100}%`}}/>
            {healAnim.show && healAnim.target !== role && <span className="heal-text">+5HP</span>}
          </div>
        </div>
        <div className="stat-box">
          <span className="name">{myN}</span>
          <div className="mini-hp">
            <div className="fill blue" style={{width: `${(h_me/400)*100}%`}}/>
            {healAnim.show && healAnim.target === role && <span className="heal-text">+5HP</span>}
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><h1 className="count">{countdown}</h1></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}