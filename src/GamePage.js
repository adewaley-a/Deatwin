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
  const [lifestealPopups, setLifestealPopups] = useState([]);
  const [flashOpacity, setFlashOpacity] = useState(0);
  const [isCooking, setIsCooking] = useState(false);
  const [cookProgress, setCookProgress] = useState(0);

  const W = 400; const H = 700; 
  const myBox = useRef({ x: 60, y: 650 });
  const myShield = useRef({ x: 60, y: 580 });
  const myShooter = useRef({ x: 130, y: 630, rot: 0 });
  const enemyBox = useRef({ x: 340, y: 50 });
  const enemyShield = useRef({ x: 340, y: 120 });
  const enemyShooter = useRef({ x: 270, y: 70, rot: 0 });

  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]);
  const recoilY = useRef(0);
  const activeGrenades = useRef([]);
  const activeTouches = useRef(new Map());
  const lastTapTime = useRef(0);
  const cookTimer = useRef(null);

  const opp = role === 'host' ? 'guest' : 'host';

  // WRAPPED IN USECALLBACK TO SATISFY ESLINT
  const playSound = useCallback((type) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.connect(gain); gain.connect(audioCtx.current.destination);
    
    if (type === 'explosion') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(40, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.5, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.6);
      setScreenShake(15);
    } else if (type === 'metallic') {
      osc.type = 'sine'; osc.frequency.setValueAtTime(1200, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.1, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    } else if (type === 'vibrate') {
      osc.type = 'square'; osc.frequency.setValueAtTime(30, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.4, audioCtx.current.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.4);
    }
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.6);
  }, []);

  // SOCKET CONNECTION USEEFFECT
  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current = s;
    s.emit("join_game", { roomId });
    
    s.on("assign_role", (data) => setRole(data.role));
    s.on("start_countdown", () => setCountdown(3));
    s.on("opp_move_all", (d) => { enemyShooter.current = d.shooter; enemyShield.current = d.shield; enemyBox.current = d.box; });
    s.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    s.on("incoming_grenade", (g) => activeGrenades.current.push({ ...g, isEnemy: true }));
    
    s.on("update_game_state", (data) => {
      if (data.targetHit) {
        playSound('metallic');
        const targetObj = data.targetHit === 'box' ? enemyBox.current : data.targetHit === 'shield' ? enemyShield.current : enemyShooter.current;
        for (let i = 0; i < 6; i++) {
          sparks.current.push({ x: targetObj.x, y: targetObj.y, vx: (Math.random()-0.5)*8, vy: (Math.random()-0.5)*8, life: 1.0, color: data.targetHit === 'box' ? '#00f2ff' : '#ffae00' });
        }
      }
      if (data.targetHit === 'box' && data.attackerRole === role) {
        const id = Date.now(); setLifestealPopups(p => [...p, { id }]);
        setTimeout(() => setLifestealPopups(p => p.filter(x => x.id !== id)), 800);
      }
      setHealth(data.health); setOverHealth(data.overHealth); setBoxHealth(data.boxHealth); setShieldHealth(data.shieldHealth); setGrenades(data.grenades);
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const winner = data.health.host <= 0 ? 'guest' : 'host';
        setFinalScore(data.health[winner] + data.shieldHealth[winner] + data.boxHealth[winner] + data.overHealth[winner]);
        setGameOver(role === winner ? "win" : "lose");
      }
    });
    return () => s.disconnect();
  }, [roomId, role, playSound]); // DEPS FIXED

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      if (isCooking) return;
      const rot = myShooter.current.rot;
      const vx = Math.sin(rot) * 18; const vy = -Math.cos(rot) * 18;
      const tx = myShooter.current.x + Math.sin(rot) * 30; const ty = myShooter.current.y - Math.cos(rot) * 30;
      myBullets.current.push({ x: tx, y: ty, vx, vy });
      socket.current.emit("fire", { roomId, x: W - tx, y: H - ty, vx: -vx, vy: -vy });
      recoilY.current = 6; setFlashOpacity(1);
    }, 180);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, isCooking, roomId, W, H]); // DEPS FIXED

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const now = Date.now();
    Array.from(e.changedTouches).forEach(t => {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);

      if (e.type === "touchstart") {
        const distToS = Math.hypot(tx - myShooter.current.x, ty - myShooter.current.y);
        if (distToS < 50 && (now - lastTapTime.current < 300) && grenades[role] > 0) {
          setIsCooking(true); setCookProgress(0);
          cookTimer.current = setInterval(() => setCookProgress(p => Math.min(1, p + 0.01)), 20);
        }
        lastTapTime.current = now;
        let id = null;
        if (Math.hypot(tx - myShooter.current.x, ty - (myShooter.current.y + 60)) < 35) id = "wheel";
        else if (distToS < 45) id = "shooter";
        else if (Math.hypot(tx - myShield.current.x, ty - myShield.current.y) < 50) id = "shield";
        else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 50) id = "box";
        if (id) activeTouches.current.set(t.identifier, id);
      }

      if (e.type === "touchmove") {
        const dragId = activeTouches.current.get(t.identifier);
        if (dragId === "wheel") myShooter.current.rot = Math.max(-1.2, Math.min(1.2, (tx - myShooter.current.x) / 30));
        else if (dragId && !isCooking) {
          const target = dragId === "shooter" ? myShooter : dragId === "shield" ? myShield : myBox;
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
        if (isCooking) {
          if (cookProgress >= 1) {
            const range = H * 0.55;
            const vx = Math.sin(myShooter.current.rot) * (range / 60);
            const vy = -Math.cos(myShooter.current.rot) * (range / 60);
            activeGrenades.current.push({ x: myShooter.current.x, y: myShooter.current.y, vx, vy, timer: 60 });
            socket.current.emit("throw_grenade", { roomId, x: W - myShooter.current.x, y: H - myShooter.current.y, vx: -vx, vy: -vy });
            socket.current.emit("use_grenade", { roomId, role });
          }
          setIsCooking(false); setCookProgress(0); clearInterval(cookTimer.current);
        }
        activeTouches.current.delete(t.identifier);
      }
    });
  };

  // MAIN RENDER LOOP USEEFFECT
  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.save();
      if (screenShake > 0) { ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake); setScreenShake(s => Math.max(0, s-1)); }
      ctx.clearRect(-50, -50, W+100, H+100);
      if (recoilY.current > 0) recoilY.current *= 0.8;
      if (flashOpacity > 0) setFlashOpacity(f => Math.max(0, f-0.2));

      // Demarcation Line
      ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.setLineDash([5,5]); ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke(); ctx.setLineDash([]);

      const drawBar = (x, y, val, max, color) => {
        ctx.fillStyle = "#111"; ctx.fillRect(x - 20, y - 40, 40, 4);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y - 40, Math.max(0, (val/max)*40), 4);
        ctx.fillStyle = "#fff"; ctx.font = "bold 10px Inter"; ctx.textAlign="center"; ctx.fillText(Math.ceil(val), x, y-45);
      };

      activeGrenades.current.forEach((g, i) => {
        g.x += g.vx; g.y += g.vy; g.timer--;
        ctx.fillStyle = "#ffaa00"; ctx.beginPath(); ctx.arc(g.x, g.y, 10, 0, Math.PI*2); ctx.fill();
        if (g.timer <= 0) {
          playSound('explosion'); playSound('vibrate');
          if (!g.isEnemy) {
            [{t:'player',p:enemyShooter.current},{t:'shield',p:enemyShield.current},{t:'box',p:enemyBox.current}].forEach(tgt => {
              const d = Math.hypot(g.x-tgt.p.x, g.y-tgt.p.y);
              if (d < 120) socket.current.emit("take_damage", { roomId, target: tgt.t, victimRole: opp, damageType: 'grenade', customDamage: Math.floor(70*(1-(d/120))) });
            });
          }
          activeGrenades.current.splice(i,1);
        }
      });

      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
        const checkHit = (tgt, type, rad) => {
          if (Math.hypot(b.x-tgt.x, b.y-tgt.y) < rad) {
            socket.current.emit("take_damage", { roomId, target: type, victimRole: opp });
            myBullets.current.splice(i,1);
          }
        };
        if (shieldHealth[opp] > 0) {
          const dS = Math.hypot(b.x-enemyShield.current.x, b.y-enemyShield.current.y);
          const ang = Math.atan2(b.y-enemyShield.current.y, b.x-enemyShield.current.x);
          if (dS < 65 && ang > Math.PI*0.25 && ang < Math.PI*0.75) { socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: opp }); myBullets.current.splice(i,1); }
        }
        checkHit(enemyBox.current, 'box', 30);
        checkHit(enemyShooter.current, 'player', 25);
        if (b.y < -50 || b.y > H + 50) myBullets.current.splice(i, 1);
      });

      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        if (b.y < -50 || b.y > H + 50) enemyBullets.current.splice(i, 1);
      });

      if (isCooking) {
        ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 4; ctx.beginPath();
        ctx.arc(myShooter.current.x, myShooter.current.y, 45, -Math.PI/2, (-Math.PI/2) + (Math.PI*2*cookProgress)); ctx.stroke();
      }

      const drawH = (x,y) => { ctx.beginPath(); ctx.arc(x,y,35,0,Math.PI*2); ctx.fillStyle="rgba(0,242,255,0.15)"; ctx.fill(); ctx.strokeStyle="rgba(0,242,255,0.4)"; ctx.stroke(); };
      drawH(myShield.current.x, myShield.current.y); drawH(myShooter.current.x, myShooter.current.y+60);

      if (flashOpacity > 0) {
        const tx = myShooter.current.x + Math.sin(myShooter.current.rot)*30; const ty = myShooter.current.y - Math.cos(myShooter.current.rot)*30;
        ctx.fillStyle = `rgba(0,242,255,${flashOpacity})`; ctx.beginPath(); ctx.arc(tx,ty,20*(2-flashOpacity),0,Math.PI*2); ctx.fill();
      }

      if (boxHealth[role] > 0) { ctx.fillStyle = "#00f2ff"; ctx.fillRect(myBox.current.x-25, myBox.current.y-25, 50, 50); drawBar(myBox.current.x, myBox.current.y, boxHealth[role], 300, "#00f2ff"); }
      if (boxHealth[opp] > 0) { ctx.fillStyle = "#ff3e3e"; ctx.fillRect(enemyBox.current.x-25, enemyBox.current.y-25, 50, 50); drawBar(enemyBox.current.x, enemyBox.current.y, boxHealth[opp], 300, "#ff3e3e"); }

      const drawS = (p, c, isE) => {
        ctx.save(); ctx.translate(p.x, isE?p.y:p.y+recoilY.current); ctx.rotate(p.rot || 0); ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0,30); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); } else { ctx.moveTo(0,-30); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.restore(); ctx.fillStyle="#fff"; ctx.font="bold 12px Inter"; ctx.textAlign="center"; ctx.fillText(isE?"OPP":"YOU", p.x, isE?p.y-20:p.y+45);
      };
      drawS(myShooter.current, "#00f2ff", false); drawS(enemyShooter.current, "#ff3e3e", true);
      
      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.life -= 0.04; ctx.globalAlpha = Math.max(0, s.life); ctx.fillStyle = s.color; ctx.fillRect(s.x, s.y, 2, 2);
        if (s.life <= 0) sparks.current.splice(i, 1);
      });

      ctx.restore(); frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth, screenShake, flashOpacity, isCooking, cookProgress, playSound, roomId, W, H]); // DEPS FIXED

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <div className="mini-hp"><div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/><span className="hp-val">{Math.ceil(health[opp])}</span></div>
          <span className="grenade-count">G: {grenades[opp]}</span>
        </div>
        <div className="stat-box">
          <div className="hp-wrapper">
             <div className="mini-hp">
               <div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/><div className="fill over-gold" style={{width: `${(overHealth[role]/200)*100}%`}}/>
               <span className="hp-val">{Math.ceil(health[role] + overHealth[role])}</span>
             </div>
             {lifestealPopups.map(p => (<span key={p.id} className="lifesteal-popup">+5HP</span>))}
          </div>
          <span className="grenade-count">G: {grenades[role]}</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && <div className={`overlay ${gameOver}-screen`}><h1 className="result-title">{gameOver === 'win' ? "VICTORY" : "DEFEATED"}</h1><div className="score-box"><p>ASSETS REMAINING</p><h2 className="final-num">{finalScore}</h2></div><button className="exit-btn" onClick={() => navigate("/second-page")}>RETURN TO MENU</button></div>}
    </div>
  );
}