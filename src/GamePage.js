import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com"; 

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  const audioCtx = useRef(null);
  
  const [role, setRole] = useState(null); 
  const [health, setHealth] = useState({ host: 650, guest: 650 }); 
  const [overHealth, setOverHealth] = useState({ host: 0, guest: 0 });
  const [boxHealth, setBoxHealth] = useState({ host: 300, guest: 300 }); 
  const [shieldHealth, setShieldHealth] = useState({ host: 350, guest: 350 }); 
  const [grenades, setGrenades] = useState({ host: 2, guest: 2 });
  const [gameOver, setGameOver] = useState(null);
  const [finalScore, setFinalScore] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [showHealHost, setShowHealHost] = useState(false);
  const [showHealGuest, setShowHealGuest] = useState(false);

  const W = 400, H = 700; 
  const myBox = useRef({ x: 60, y: 650 });
  const myShield = useRef({ x: 60, y: 580 });
  const myShooter = useRef({ x: 130, y: 630, rot: 0 });
  const enemyBox = useRef({ x: 340, y: 50 });
  const enemyShield = useRef({ x: 340, y: 120 });
  const enemyShooter = useRef({ x: 270, y: 70, rot: 0 });

  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const activeGrenades = useRef([]);
  const sparks = useRef([]); 
  const activeTouches = useRef(new Map());

  // Grenade Cooking Refs
  const lastTapTime = useRef(0);
  const isCooking = useRef(false);
  const cookPower = useRef(0);

  const opp = role === 'host' ? 'guest' : 'host';

  const playImpactSound = (type) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.connect(gain); gain.connect(audioCtx.current.destination);
    
    if (type === 'shield') {
      osc.frequency.setValueAtTime(160, audioCtx.current.currentTime);
    } else if (type === 'grenade') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(50, audioCtx.current.currentTime);
    } else {
      osc.frequency.setValueAtTime(110, audioCtx.current.currentTime);
    }
    
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.15);
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.15);
  };

  const createBurst = (x, y, color, count = 10) => {
    for (let i = 0; i < count; i++) {
      sparks.current.push({
        x, y,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.5) * 14,
        alpha: 1, color
      });
    }
  };

  useEffect(() => {
    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current.emit("join_game", { roomId });
    
    socket.current.on("assign_role", (data) => setRole(data.role));
    socket.current.on("start_countdown", () => setCountdown(3));
    socket.current.on("opp_move_all", (data) => {
      enemyShooter.current = data.shooter;
      enemyShield.current = data.shield;
      enemyBox.current = data.box;
    });

    socket.current.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    socket.current.on("incoming_grenade", (g) => {
        activeGrenades.current.push({ ...g, isEnemy: true });
    });
    
    socket.current.on("update_game_state", (data) => {
      if (data.targetHit) playImpactSound(data.targetHit);
      if (data.targetHit === 'box') {
        if (data.attackerRole === 'host') { setShowHealHost(true); setTimeout(() => setShowHealHost(false), 800); }
        else { setShowHealGuest(true); setTimeout(() => setShowHealGuest(false), 800); }
      }
      setHealth(data.health);
      setOverHealth(data.overHealth);
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      setGrenades(data.grenades);

      if (data.health.host <= 0 || data.health.guest <= 0) {
        const winnerRole = data.health.host <= 0 ? 'guest' : 'host';
        const winnerId = winnerRole === 'host' ? data.hostId : data.guestId;
        // Calculation is now a static sum of current values
        const total = data.health[winnerRole] + data.shieldHealth[winnerRole] + data.boxHealth[winnerRole];
        setFinalScore(total);
        setGameOver(socket.current.id === winnerId ? "win" : "lose");
      }
    });

    return () => { if (socket.current) socket.current.disconnect(); };
  }, [roomId]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      if (isCooking.current) return; 
      const vx = Math.sin(myShooter.current.rot) * 18;
      const vy = -Math.cos(myShooter.current.rot) * 18;
      const tipX = myShooter.current.x + Math.sin(myShooter.current.rot) * 30;
      const tipY = myShooter.current.y - Math.cos(myShooter.current.rot) * 30;
      myBullets.current.push({ x: tipX, y: tipY, vx, vy });
      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy });
    }, 150); 
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const now = Date.now();

    Array.from(e.changedTouches).forEach(t => {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);

      if (e.type === "touchstart") {
        // Double Tap and Hold detection
        if (now - lastTapTime.current < 300 && grenades[role] > 0) {
          isCooking.current = true;
          cookPower.current = 0;
        }
        lastTapTime.current = now;

        let id = null;
        if (Math.hypot(tx - myShooter.current.x, ty - (myShooter.current.y + 50)) < 45) id = "wheel";
        else if (Math.hypot(tx - myShooter.current.x, ty - myShooter.current.y) < 45) id = "shooter";
        else if (Math.hypot(tx - myShield.current.x, ty - (myShield.current.y + 15)) < 45) id = "shield";
        else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 45) id = "box";
        if (id) activeTouches.current.set(t.identifier, id);
      }

      if (e.type === "touchmove" && !isCooking.current) {
        const draggingId = activeTouches.current.get(t.identifier);
        if (draggingId === "wheel") {
          myShooter.current.rot = Math.max(-1.22, Math.min(1.22, (tx - myShooter.current.x) / 45)); 
        } else if (draggingId) {
          const target = draggingId === "shooter" ? myShooter : draggingId === "shield" ? myShield : myBox;
          target.current.x = Math.max(30, Math.min(W - 30, tx));
          target.current.y = Math.max(H / 2 + 50, Math.min(H - 40, ty));
        }
        socket.current.emit("move_all", { 
          roomId, 
          shooter: { x: W - myShooter.current.x, y: H - myShooter.current.y, rot: -myShooter.current.rot },
          shield: { x: W - myShield.current.x, y: H - myShield.current.y },
          box: { x: W - myBox.current.x, y: H - myBox.current.y }
        });
      }

      if (e.type === "touchend") {
        if (isCooking.current) {
          const vx = Math.sin(myShooter.current.rot) * (8 + cookPower.current * 12);
          const vy = -Math.cos(myShooter.current.rot) * (8 + cookPower.current * 12);
          const gData = { x: myShooter.current.x, y: myShooter.current.y, vx, vy, timer: 70 };
          activeGrenades.current.push(gData);
          socket.current.emit("throw_grenade", { roomId, x: W - gData.x, y: H - gData.y, vx: -vx, vy: -vy });
          isCooking.current = false;
        }
        activeTouches.current.delete(t.identifier);
      }
    });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      if (isCooking.current) {
          cookPower.current = Math.min(1, cookPower.current + 0.02);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(myShooter.current.x, myShooter.current.y);
          ctx.lineTo(myShooter.current.x + Math.sin(myShooter.current.rot) * 180 * cookPower.current, 
                     myShooter.current.y - Math.cos(myShooter.current.rot) * 180 * cookPower.current);
          ctx.stroke(); ctx.setLineDash([]);
      }

      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.alpha -= 0.03;
        ctx.fillStyle = s.color; ctx.globalAlpha = Math.max(0, s.alpha);
        ctx.fillRect(s.x, s.y, 3, 3);
        if (s.alpha <= 0) sparks.current.splice(i, 1);
      });
      ctx.globalAlpha = 1;

      activeGrenades.current.forEach((g, i) => {
          g.x += g.vx; g.y += g.vy; g.timer--;
          ctx.fillStyle = "#ffaa00"; ctx.beginPath(); ctx.arc(g.x, g.y, 10, 0, Math.PI*2); ctx.fill();
          if (g.timer <= 0) {
              createBurst(g.x, g.y, "#ff4400", 25);
              playImpactSound('grenade');
              const distBox = Math.hypot(g.x - enemyBox.current.x, g.y - enemyBox.current.y);
              if (distBox < 90) socket.current.emit("take_damage", { roomId, target: 'box', victimRole: opp, amount: 60 });
              activeGrenades.current.splice(i, 1);
          }
      });

      const drawBar = (x, y, val, max, color) => {
        ctx.fillStyle = "#111"; ctx.fillRect(x - 20, y - 40, 40, 4);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y - 40, Math.max(0, (val/max)*40), 4);
      };

      if (boxHealth[role] > 0) {
        ctx.fillStyle = "#00f2ff"; ctx.fillRect(myBox.current.x-25, myBox.current.y-25, 50, 50);
        drawBar(myBox.current.x, myBox.current.y, boxHealth[role], 300, "#00f2ff");
      }
      if (boxHealth[opp] > 0) {
        ctx.fillStyle = "#ff3e3e"; ctx.fillRect(enemyBox.current.x-25, enemyBox.current.y-25, 50, 50);
        drawBar(enemyBox.current.x, enemyBox.current.y, boxHealth[opp], 300, "#ff3e3e");
      }

      const drawShieldComp = (pos, color, hp, isEnemy) => {
        if (hp <= 0) return;
        ctx.fillStyle = isEnemy ? "rgba(255, 62, 62, 0.15)" : "rgba(0, 242, 255, 0.15)";
        ctx.beginPath(); ctx.arc(pos.x, pos.y + (isEnemy ? -15 : 15), 25, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath();
        const s = isEnemy ? 0.25 : -0.75; const e = isEnemy ? 0.75 : -0.25;
        ctx.arc(pos.x, pos.y, 60, Math.PI * s, Math.PI * e); ctx.stroke();
        drawBar(pos.x, isEnemy ? pos.y + 45 : pos.y - 45, hp, 350, "#00ff88");
      };
      drawShieldComp(myShield.current, "#00f2ff", shieldHealth[role], false);
      drawShieldComp(enemyShield.current, "#ff3e3e", shieldHealth[opp], true);

      const drawShooterComp = (pos, color, isEnemy) => {
        ctx.strokeStyle = isEnemy ? "rgba(255, 62, 62, 0.3)" : "rgba(0, 242, 255, 0.3)";
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pos.x, pos.y + (isEnemy ? -50 : 50), 20, 0, Math.PI*2); ctx.stroke();
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(pos.rot || 0);
        ctx.fillStyle = color; ctx.beginPath();
        if (isEnemy) { ctx.moveTo(0, 30); ctx.lineTo(-15, -10); ctx.lineTo(15, -10); }
        else { ctx.moveTo(0, -30); ctx.lineTo(-15, 10); ctx.lineTo(15, 10); }
        ctx.fill(); ctx.restore();
      };
      drawShooterComp(myShooter.current, "#00f2ff", false);
      drawShooterComp(enemyShooter.current, "#ff3e3e", true);

      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy; ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        if (b.y < -50 || b.y > H + 50) { myBullets.current.splice(i, 1); return; }
        if (Math.hypot(b.x - enemyShooter.current.x, b.y - enemyShooter.current.y) < 30) {
            createBurst(b.x, b.y, "#ff3e3e");
            socket.current.emit("take_damage", { roomId, target: 'player', victimRole: opp });
            myBullets.current.splice(i, 1);
        }
      });
      enemyBullets.current.forEach(b => {
        b.x += b.vx; b.y += b.vy; ctx.fillStyle = "#ff3e3e"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
      });

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth, roomId]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">ENEMY [G: {grenades[opp]}]</span>
          <div className="mini-hp">
            <div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/>
            <div className="fill over-gold" style={{width: `${(overHealth[opp]/200)*100}%`}}/>
            <span className="hp-label">{health[opp]} HP</span>
            {showHealGuest && <div className="heal-popup">+5 HP</div>}
          </div>
        </div>
        <div className="stat-box">
          <span className="name">YOU [G: {grenades[role]}]</span>
          <div className="mini-hp">
            <div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/>
            <div className="fill over-gold" style={{width: `${(overHealth[role]/200)*100}%`}}/>
            <span className="hp-label">{health[role]} HP</span>
            {showHealHost && <div className="heal-popup">+5 HP</div>}
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && (
        <div className="overlay">
          <h1 className={gameOver}>{gameOver.toUpperCase()}</h1>
          {gameOver === 'win' && (
            <div className="score-summary">
              <p>Total Assets: {finalScore}</p>
              {finalScore >= 1000 && <h2 className="grade">A+</h2>}
            </div>
          )}
          <button onClick={() => navigate("/second-page")}>EXIT</button>
        </div>
      )}
    </div>
  );
}