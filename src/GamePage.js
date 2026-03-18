import React, { useEffect, useRef, useState, useCallback } from "react";
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

  const W = 400; const H = 700; 

  // Refs for positions
  const myBox = useRef({ x: 60, y: 650 });
  const myShield = useRef({ x: 60, y: 580 });
  const myShooter = useRef({ x: 130, y: 630, rot: 0 });
  const enemyBox = useRef({ x: 340, y: 50 });
  const enemyShield = useRef({ x: 340, y: 120 });
  const enemyShooter = useRef({ x: 270, y: 70, rot: 0 });

  // Ref for animations & projectiles
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]);
  const recoilY = useRef(0);
  const activeGrenades = useRef([]);
  const activeTouches = useRef(new Map());

  const lastTapTime = useRef(0);
  const isCooking = useRef(false);
  const cookPower = useRef(0);

  const opp = role === 'host' ? 'guest' : 'host';

  const playSound = useCallback((type) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();

    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.connect(gain); gain.connect(audioCtx.current.destination);
    
    if (type === 'explosion') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(40, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.4, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.6);
      setScreenShake(15);
    } else if (type === 'metallic') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.1, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    } else {
      osc.frequency.setValueAtTime(type === 'shield' ? 180 : 120, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    }
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.6);
  }, []);

  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current = s;
    s.emit("join_game", { roomId });
    
    s.on("assign_role", (data) => setRole(data.role));
    s.on("start_countdown", () => setCountdown(3));
    s.on("opp_move_all", (data) => {
      enemyShooter.current = data.shooter;
      enemyShield.current = data.shield;
      enemyBox.current = data.box;
    });

    s.on("incoming_bullet", (b) => {
      enemyBullets.current.push(b);
      setMuzzleFlash(true);
      setTimeout(() => setMuzzleFlash(false), 50);
    });

    s.on("incoming_grenade", (g) => activeGrenades.current.push({ ...g, isEnemy: true }));
    
    s.on("update_game_state", (data) => {
      if (data.targetHit) {
        playSound('metallic');
        // Spark effect logic
        const targetObj = data.targetHit === 'box' ? enemyBox.current : 
                         data.targetHit === 'shield' ? enemyShield.current : enemyShooter.current;
        for (let i = 0; i < 6; i++) {
          sparks.current.push({
            x: targetObj.x, y: targetObj.y,
            vx: (Math.random()-0.5)*8, vy: (Math.random()-0.5)*8,
            life: 1.0, color: data.targetHit === 'box' ? '#00f2ff' : '#ffae00'
          });
        }
      }
      
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

    return () => { s.disconnect(); };
  }, [roomId, role, playSound]); 

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timerId = setInterval(() => { setCountdown(c => c - 1); }, 1000);
    return () => clearInterval(timerId);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role || !socket.current) return;
    
    const fireInt = setInterval(() => {
      if (isCooking.current) return; 
      const vx = Math.sin(myShooter.current.rot) * 18;
      const vy = -Math.cos(myShooter.current.rot) * 18;
      const tipX = myShooter.current.x + Math.sin(myShooter.current.rot) * 30;
      const tipY = myShooter.current.y - Math.cos(myShooter.current.rot) * 30;
      
      myBullets.current.push({ x: tipX, y: tipY, vx, vy });
      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy });
      recoilY.current = 6; // Trigger Recoil
    }, 180); 
    
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]); 

  const handleTouch = (e) => {
    if (!role || gameOver || (countdown !== null && countdown > 0) || !socket.current) return;
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
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    
    const render = () => {
      ctx.save();
      if (screenShake > 0) {
        ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake);
        setScreenShake(s => Math.max(0, s - 1));
      }
      ctx.clearRect(-50, -50, W+100, H+100);

      // Handle Recoil Decay
      if (recoilY.current > 0) recoilY.current *= 0.8;

      const drawBar = (x, y, val, max, color) => {
        ctx.fillStyle = "#111"; ctx.fillRect(x - 20, y - 40, 40, 4);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y - 40, Math.max(0, (val/max)*40), 4);
        ctx.fillStyle = "#fff"; ctx.font = "bold 10px Inter"; ctx.textAlign="center";
        ctx.fillText(Math.ceil(val), x, y - 45);
      };

      // Sparks rendering
      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.life -= 0.04;
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = s.color; ctx.fillRect(s.x, s.y, 2, 2);
        if (s.life <= 0) sparks.current.splice(i, 1);
      });
      ctx.globalAlpha = 1.0;

      activeGrenades.current.forEach((g, i) => {
        g.x += g.vx; g.y += g.vy; g.timer--;
        ctx.fillStyle = "#ffaa00"; ctx.beginPath(); ctx.arc(g.x, g.y, 10, 0, Math.PI*2); ctx.fill();
        if (g.timer <= 0) { playSound('explosion'); activeGrenades.current.splice(i, 1); }
      });

      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        if (b.y < -50 || b.y > H + 50) myBullets.current.splice(i, 1);
      });

      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        if (b.y < -50 || b.y > H + 50) enemyBullets.current.splice(i, 1);
      });

      if (isCooking.current) {
        cookPower.current = Math.min(1, cookPower.current + 0.015);
        ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 4; ctx.beginPath();
        ctx.arc(myShooter.current.x, myShooter.current.y, 45, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*cookPower.current));
        ctx.stroke();
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
        ctx.save(); 
        const yPos = isE ? p.y : p.y + recoilY.current;
        ctx.translate(p.x, yPos); ctx.rotate(p.rot || 0); ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0,30); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); }
        else { ctx.moveTo(0,-30); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.restore();
        ctx.fillStyle="#fff"; ctx.font="bold 12px Inter"; ctx.textAlign="center";
        ctx.fillText(isE ? "OPP" : "YOU", p.x, isE ? p.y - 20 : p.y + 45);
      };
      drawS(myShooter.current, "#00f2ff", false);
      drawS(enemyShooter.current, "#ff3e3e", true);

      ctx.restore();
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth, screenShake, muzzleFlash, playSound, W, H]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <div className="mini-hp">
            <div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/>
            <span className="hp-val">{Math.ceil(health[opp])}</span>
          </div>
          <span className="grenade-count">G: {grenades[opp]}</span>
        </div>
        <div className="stat-box">
          <div className="hp-wrapper">
             <div className="mini-hp">
               <div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/>
               <div className="fill over-gold" style={{width: `${(overHealth[role]/200)*100}%`}}/>
               <span className="hp-val">{Math.ceil(health[role] + overHealth[role])}</span>
             </div>
             {lifestealPopups.map(p => (<span key={p.id} className="lifesteal-popup">+5HP</span>))}
          </div>
          <span className="grenade-count">G: {grenades[role]}</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      
      {countdown !== null && countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}

      {gameOver && (
        <div className={`overlay ${gameOver}-screen`}>
          <h1 className="result-title">{gameOver === 'win' ? "VICTORY" : "DEFEATED"}</h1>
          <div className="score-box">
            <p>ASSETS REMAINING</p>
            <h2 className="final-num">{finalScore}</h2>
          </div>
          <button className="exit-btn" onClick={() => navigate("/second-page")}>RETURN TO MENU</button>
        </div>
      )}
    </div>
  );
}