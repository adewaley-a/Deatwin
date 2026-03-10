import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com"; 
// Ultra-fast interpolation (0.8) for near-zero latency perception
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
  const grenades = useRef([]); // {x, y, targetY, stage: 'moving'|'exploding', life: 1.5}

  // Grenade Logic Refs
  const lastTap = useRef(0);
  const chargeTimer = useRef(null);
  const [isCharging, setIsCharging] = useState(false);

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
    socket.current.on("incoming_grenade", (g) => { grenades.current.push(g); });
    
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

  // Standard Auto-Fire
  useEffect(() => {
    if (countdown > 0 || gameOver || !role || isCharging) return;
    const fireInt = setInterval(() => {
      const angle = myRot.current;
      // Bullet comes from tip (40px from center)
      const tipX = myPos.current.x + Math.sin(angle) * 40;
      const tipY = myPos.current.y - Math.cos(angle) * 40;
      const vx = Math.sin(angle) * 16;
      const vy = -Math.cos(angle) * 16;
      const b = { x: tipX, y: tipY, vx, vy, muzzle: 5 }; // muzzle for flash anim
      socket.current.emit("fire", { roomId, x: W - b.x, y: H - b.y, vx: -vx, vy: -vy, rot: -angle });
      myBullets.current.push(b);
    }, 280);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId, isCharging]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const now = Date.now();

    for (let t of e.changedTouches) {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);
      
      if (e.type === "touchstart") {
        const isShooter = Math.hypot(tx - myPos.current.x, ty - myPos.current.y) < 45;
        
        // Double Tap Detection for Grenade
        if (isShooter) {
            if (now - lastTap.current < 300) {
                setIsCharging(true);
                chargeTimer.current = setTimeout(() => launchGrenade(), 2000);
            }
            lastTap.current = now;
            activeTouches.current[t.identifier] = 'dragging';
        } else if (Math.hypot(tx - myPos.current.x, ty - (myPos.current.y + 60)) < 45) {
            activeTouches.current[t.identifier] = 'steering';
        } else if (boxHealth[role] > 0 && Math.hypot(tx - myBoxPos.current.x, ty - myBoxPos.current.y) < 40) {
            activeTouches.current[t.identifier] = 'box';
        } else if (shieldHealth[role] > 0 && Math.hypot(tx - myShieldPos.current.x, ty - myShieldPos.current.y) < 50) {
            activeTouches.current[t.identifier] = 'shield';
        }
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

      if (e.type === "touchend") {
          if (chargeTimer.current) {
              clearTimeout(chargeTimer.current);
              chargeTimer.current = null;
          }
          setIsCharging(false);
          delete activeTouches.current[t.identifier];
      }
    }
  };

  const launchGrenade = () => {
    const range = (H / 2) * 0.55;
    const g = { 
        x: myPos.current.x, 
        y: myPos.current.y - 40, 
        targetY: myPos.current.y - 40 - range,
        stage: 'moving',
        life: 1.5,
        owner: role
    };
    socket.current.emit("throw_grenade", { roomId, x: W - g.x, y: H - g.y, targetY: H - g.targetY });
    grenades.current.push(g);
    setIsCharging(false);
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);

      // Interpolation (Very fast)
      enemyPos.current.x = lerp(enemyPos.current.x, enemyTarget.current.x, 0.8);
      enemyPos.current.y = lerp(enemyPos.current.y, enemyTarget.current.y, 0.8);
      enemyRot.current = lerp(enemyRot.current, enemyTarget.current.rot, 0.8);
      enemyBoxPos.current.x = lerp(enemyBoxPos.current.x, enemyTarget.current.boxX, 0.8);
      enemyBoxPos.current.y = lerp(enemyBoxPos.current.y, enemyTarget.current.boxY, 0.8);
      enemyShieldPos.current.x = lerp(enemyShieldPos.current.x, enemyTarget.current.sX, 0.8);
      enemyShieldPos.current.y = lerp(enemyShieldPos.current.y, enemyTarget.current.sY, 0.8);

      const drawHPBar = (x, y, val, max, color, offset = 35) => {
        ctx.fillStyle = "#222"; ctx.fillRect(x - 20, y - offset, 40, 5);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y - offset, (val / max) * 40, 5);
      };

      // Shield with close HP bar
      const drawShield = (p, color, isE, hp) => {
        if (hp <= 0) return;
        drawHPBar(p.x, p.y, hp, 150, color, isE ? -15 : 25);
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, isE ? 10 : -10, 50, isE ? 1 : Math.PI + 1, isE ? Math.PI - 1 : 2 * Math.PI - 1);
        ctx.stroke(); ctx.restore();
      };
      drawShield(myShieldPos.current, "#00f2ff", false, shieldHealth[role]);
      drawShield(enemyShieldPos.current, "#ff3e3e", true, shieldHealth[role === 'host' ? 'guest' : 'host']);

      // Glowing Treasure Box
      const drawBox = (p, color, hp) => {
        if (hp <= 0) return;
        drawHPBar(p.x, p.y, hp, 200, color, 30);
        ctx.shadowBlur = 15; ctx.shadowColor = color;
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.strokeRect(p.x - 20, p.y - 20, 40, 40);
        ctx.shadowBlur = 0;
      };
      drawBox(myBoxPos.current, "#00f2ff", boxHealth[role]);
      drawBox(enemyBoxPos.current, "#ff3e3e", boxHealth[role === 'host' ? 'guest' : 'host']);

      // Shooter with Muzzle Flash logic
      const drawS = (x, y, r, c, isE) => {
        ctx.save(); ctx.translate(x, y);
        if (!isE) {
            // Steering Wheel further away (60px)
            ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.beginPath(); ctx.arc(0, 60, 22, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc((r/1.3)*18, 60, 8, 0, Math.PI * 2); ctx.fill();
            if (isCharging) {
                ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath();
                ctx.arc(0, 0, 50, 0, Math.PI * 2 * (Date.now() % 2000 / 2000)); ctx.stroke();
            }
        }
        ctx.rotate(r); ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0, 40); ctx.lineTo(-15, -15); ctx.lineTo(15, -15); } 
        else { ctx.moveTo(0, -40); ctx.lineTo(-15, 15); ctx.lineTo(15, 15); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      };
      drawS(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawS(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      // Bullet & Muzzle Animation
      [myBullets, enemyBullets].forEach((ref) => {
        ref.current.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          if (b.muzzle > 0) {
              ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(b.x, b.y, 8 * (b.muzzle/5), 0, Math.PI*2); ctx.fill();
              b.muzzle--;
          }
          ctx.fillStyle = ref === myBullets ? "#fffb00" : "#ff3e3e";
          ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
          // Hit logic (Condensed for brevity)
          const isMyB = ref === myBullets;
          const oppR = role === 'host' ? 'guest' : 'host';
          const targets = isMyB ? [
              {p: enemyPos.current, r: 28, id: 'player'},
              {p: enemyBoxPos.current, r: 25, id: 'box', hp: boxHealth[oppR]},
              {p: enemyShieldPos.current, r: 55, id: 'shield', hp: shieldHealth[oppR]}
          ] : [
              {p: myPos.current, r: 28, id: 'player'},
              {p: myBoxPos.current, r: 25, id: 'box', hp: boxHealth[role]},
              {p: myShieldPos.current, r: 55, id: 'shield', hp: shieldHealth[role]}
          ];
          for (let t of targets) {
              if ((t.hp === undefined || t.hp > 0) && Math.hypot(b.x - t.p.x, b.y - t.p.y) < t.r) {
                  ref.current.splice(i, 1);
                  if (isMyB) socket.current.emit("take_damage", { roomId, target: t.id, victimRole: oppR });
                  break;
              }
          }
          if (b.y < -50 || b.y > H + 50) ref.current.splice(i, 1);
        });
      });

      // Grenade Logic
      grenades.current.forEach((g, i) => {
          if (g.stage === 'moving') {
              g.y += (g.targetY < g.y) ? -8 : 8;
              ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(g.x, g.y, 6, 0, Math.PI*2); ctx.fill();
              if (Math.abs(g.y - g.targetY) < 10) g.stage = 'exploding';
          } else {
              g.life -= 0.03;
              const radius = 80 * (1.5 - g.life);
              ctx.strokeStyle = "rgba(255,255,255," + g.life + ")"; ctx.lineWidth = 3;
              ctx.beginPath(); ctx.arc(g.x, g.y, radius, 0, Math.PI*2); ctx.stroke();
              // Damage on initial explosion frame
              if (g.life > 1.45 && g.owner === role) {
                  const oppR = role === 'host' ? 'guest' : 'host';
                  const victims = [
                      {p: enemyPos.current, id: 'player'},
                      {p: enemyBoxPos.current, id: 'box', hp: boxHealth[oppR]},
                      {p: enemyShieldPos.current, id: 'shield', hp: shieldHealth[oppR]}
                  ];
                  victims.forEach(v => {
                      const dist = Math.hypot(g.x - v.p.x, g.y - v.p.y);
                      if (dist < 100 && (v.hp === undefined || v.hp > 0)) {
                          const dmg = Math.floor(70 * (1 - dist/100));
                          if (dmg > 0) socket.current.emit("take_damage", { roomId, target: v.id, victimRole: oppR, amount: dmg });
                      }
                  });
              }
              if (g.life <= 0) grenades.current.splice(i, 1);
          }
      });

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, roomId, boxHealth, shieldHealth, isCharging]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">{role === 'host' ? playerNames.guest : playerNames.host}</span>
          <div className="mini-hp">
            <div className="fill red" style={{width: `${(health[role === 'host' ? 'guest' : 'host']/400)*100}%`}}/>
            {healAnim.show && healAnim.target !== role && <span className="heal-text">+5HP</span>}
          </div>
        </div>
        <div className="stat-box">
          <span className="name">{role === 'host' ? playerNames.host : playerNames.guest}</span>
          <div className="mini-hp">
            <div className="fill blue" style={{width: `${(health[role]/400)*100}%`}}/>
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