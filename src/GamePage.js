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
  const [screenShake, setScreenShake] = useState(0);
  const [muzzleFlash, setMuzzleFlash] = useState(false);
  const [lifestealPopups, setLifestealPopups] = useState([]);

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
  const activeTouches = useRef(new Map());

  const lastTapTime = useRef(0);
  const isCooking = useRef(false);
  const cookPower = useRef(0);

  const opp = role === 'host' ? 'guest' : 'host';

  const playSound = (type) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.connect(gain); gain.connect(audioCtx.current.destination);
    
    if (type === 'explosion') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(40, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.4, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.6);
      setScreenShake(15);
    } else {
      osc.frequency.setValueAtTime(type === 'shield' ? 180 : 120, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    }
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.6);
  };

  // EFFECT 1: Socket Setup (Fixed roomId dependency)
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

    socket.current.on("incoming_bullet", (b) => {
      enemyBullets.current.push(b);
      setMuzzleFlash(true);
      setTimeout(() => setMuzzleFlash(false), 50);
    });

    socket.current.on("incoming_grenade", (g) => activeGrenades.current.push({ ...g, isEnemy: true }));
    
    socket.current.on("update_game_state", (data) => {
      if (data.targetHit) playSound(data.targetHit === 'box' || data.targetHit === 'shield' ? 'shield' : 'impact');
      
      if (data.targetHit === 'box' && data.attackerRole === role) {
        const id = Date.now();
        setLifestealPopups(prev => [...prev, { id }]);
        setTimeout(() => setLifestealPopups(prev => prev.filter(p => p.id !== id)), 800);
      }

      setHealth(data.health);
      setOverHealth(data.overHealth);
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      setGrenades(data.grenades);

      if (data.health.host <= 0 || data.health.guest <= 0) {
        const winnerRole = data.health.host <= 0 ? 'guest' : 'host';
        const total = data.health[winnerRole] + data.shieldHealth[winnerRole] + data.boxHealth[winnerRole] + data.overHealth[winnerRole];
        setFinalScore(total);
        setGameOver(role === winnerRole ? "win" : "lose");
      }
    });

    return () => { if (socket.current) socket.current.disconnect(); };
  }, [roomId, role]); 

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timerId = setInterval(() => { setCountdown(c => c - 1); }, 1000);
    return () => clearInterval(timerId);
  }, [countdown]);

  // EFFECT 2: Firing Loop (Fixed missing roomId dependency)
  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      if (isCooking.current) return; 
      const vx = Math.sin(myShooter.current.rot) * 18;
      const vy = -Math.cos(myShooter.current.rot) * 18;
      const tipX = myShooter.current.x + Math.sin(myShooter.current.rot) * 30;
      const tipY = myShooter.current.y - Math.cos(myShooter.current.rot) * 30;
      myBullets.current.push({ x: tipX, y: tipY, vx, vy });
      
      // The roomId use below is what was triggering the error
      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy });
    }, 180); 
    
    return () => clearInterval(fireInt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, gameOver, role, roomId]); 

  const handleTouch = (e) => {
    if (!role || gameOver || (countdown !== null && countdown > 0)) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const now = Date.now();

    Array.from(e.changedTouches).forEach(t => {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);

      if (e.type === "touchstart") {
        if (now - lastTapTime.current < 300 && grenades[role] > 0) {
          isCooking.current = true;
          cookPower.current = 0;
        }
        lastTapTime.current = now;

        let id = null;
        if (Math.hypot(tx - myShooter.current.x, ty - (myShooter.current.y + 60)) < 30) id = "wheel";
        else if (Math.hypot(tx - myShooter.current.x, ty - myShooter.current.y) < 45) id = "shooter";
        else if (Math.hypot(tx - myShield.current.x, ty - myShield.current.y) < 50) id = "shield";
        else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 50) id = "box";
        if (id) activeTouches.current.set(t.identifier, id);
      }

      if (e.type === "touchmove") {
        const draggingId = activeTouches.current.get(t.identifier);
        if (draggingId === "wheel") {
          myShooter.current.rot = Math.max(-1.2, Math.min(1.2, (tx - myShooter.current.x) / 30)); 
        } else if (draggingId && !isCooking.current) {
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
          const force = 4 + cookPower.current * 22;
          const vx = Math.sin(myShooter.current.rot) * force;
          const vy = -Math.cos(myShooter.current.rot) * force;
          activeGrenades.current.push({ x: myShooter.current.x, y: myShooter.current.y, vx, vy, timer: 85 });
          socket.current.emit("throw_grenade", { roomId, x: W - myShooter.current.x, y: H - myShooter.current.y, vx: -vx, vy: -vy });
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
      ctx.save();
      if (screenShake > 0) {
        ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake);
        setScreenShake(s => Math.max(0, s - 1));
      }
      ctx.clearRect(-50, -50, W+100, H+100);

      const drawBar = (x, y, val, max, color) => {
        ctx.fillStyle = "#111"; ctx.fillRect(x - 20, y - 40, 40, 4);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y - 40, Math.max(0, (val/max)*40), 4);
      };

      activeGrenades.current.forEach((g, i) => {
        g.x += g.vx; g.y += g.vy; g.timer--;
        ctx.fillStyle = "#ffaa00"; ctx.beginPath(); ctx.arc(g.x, g.y, 10, 0, Math.PI*2); ctx.fill();
        if (g.timer <= 0) { playSound('explosion'); activeGrenades.current.splice(i, 1); }
      });

      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        const distS = Math.hypot(b.x - enemyShield.current.x, b.y - enemyShield.current.y);
        const angleToBullet = Math.atan2(b.y - enemyShield.current.y, b.x - enemyShield.current.x);
        const inArc = angleToBullet > Math.PI * 0.25 && angleToBullet < Math.PI * 0.75;

        if (shieldHealth[opp] > 0 && distS < 65 && inArc) {
           socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: opp });
           myBullets.current.splice(i, 1);
        } else if (boxHealth[opp] > 0 && Math.abs(b.x - enemyBox.current.x) < 25 && Math.abs(b.y - enemyBox.current.y) < 25) {
           socket.current.emit("take_damage", { roomId, target: 'box', victimRole: opp });
           myBullets.current.splice(i, 1);
        } else if (Math.hypot(b.x - enemyShooter.current.x, b.y - enemyShooter.current.y) < 25) {
           socket.current.emit("take_damage", { roomId, target: 'player', victimRole: opp });
           myBullets.current.splice(i, 1);
        }
        if (b.y < -50 || b.y > H + 50) myBullets.current.splice(i, 1);
      });

      if (isCooking.current) {
        cookPower.current = Math.min(1, cookPower.current + 0.015);
        ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 4; ctx.beginPath();
        ctx.arc(myShooter.current.x, myShooter.current.y, 45, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*cookPower.current));
        ctx.stroke();
      }

      ctx.globalAlpha = 0.15;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(myShield.current.x, myShield.current.y, 25, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1.0;

      ctx.strokeStyle = "rgba(0, 242, 255, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(myShooter.current.x, myShooter.current.y + 60, 30, 0, Math.PI*2); ctx.stroke();

      if (muzzleFlash) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        const tipX = myShooter.current.x + Math.sin(myShooter.current.rot) * 35;
        const tipY = myShooter.current.y - Math.cos(myShooter.current.rot) * 35;
        ctx.beginPath(); ctx.arc(tipX, tipY, 12, 0, Math.PI*2); ctx.fill();
      }

      if (boxHealth[role] > 0) {
        ctx.fillStyle = "#00f2ff"; ctx.fillRect(myBox.current.x-25, myBox.current.y-25, 50, 50);
        drawBar(myBox.current.x, myBox.current.y, boxHealth[role], 300, "#00f2ff");
      }
      if (boxHealth[opp] > 0) {
        ctx.fillStyle = "#ff3e3e"; ctx.fillRect(enemyBox.current.x-25, enemyBox.current.y-25, 50, 50);
        drawBar(enemyBox.current.x, enemyBox.current.y, boxHealth[opp], 300, "#ff3e3e");
      }

      const drawShield = (pos, color, hp, isEnemy) => {
        if (hp <= 0) return;
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath();
        const s = isEnemy ? 0.25 : -0.75; const e = isEnemy ? 0.75 : -0.25;
        ctx.arc(pos.x, pos.y, 60, Math.PI * s, Math.PI * e); ctx.stroke();
        drawBar(pos.x, pos.y, hp, 350, "#00ff88");
      };
      drawShield(myShield.current, "#00f2ff", shieldHealth[role], false);
      drawShield(enemyShield.current, "#ff3e3e", shieldHealth[opp], true);
      
      const drawS = (p, c, isE) => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0); ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0,30); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); }
        else { ctx.moveTo(0,-30); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.restore();
      };
      drawS(myShooter.current, "#00f2ff", false);
      drawS(enemyShooter.current, "#ff3e3e", true);

      ctx.restore();
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth, screenShake, muzzleFlash]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <div className="mini-hp"><div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/></div>
          <span className="grenade-count">G: {grenades[opp]}</span>
        </div>
        <div className="stat-box">
          <div className="hp-wrapper">
             <div className="mini-hp">
               <div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/>
               <div className="fill over-gold" style={{width: `${(overHealth[role]/200)*100}%`}}/>
             </div>
             {lifestealPopups.map(p => (<span key={p.id} className="lifesteal-text">+5hp</span>))}
          </div>
          <span className="grenade-count">G: {grenades[role]}</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      
      {countdown !== null && countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}

      {gameOver && (
        <div className="overlay">
          <h1 className={gameOver}>{gameOver.toUpperCase()}</h1>
          {gameOver === 'win' && (
            <div className="score-summary">
              <p className="score-label">Total Assets Remaining</p>
              <p className="score-value">{finalScore}</p>
              {finalScore >= 1000 && <h2 className="grade">A+</h2>}
            </div>
          )}
          {gameOver === 'lose' && <p className="lose-subtext">ELIMINATED</p>}
          <button className="exit-btn" onClick={() => navigate("/second-page")}>EXIT</button>
        </div>
      )}
    </div>
  );
}