import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com"; 
const W = 400; const H = 700; 

export default function GamePage() {
  const { roomId } = useParams();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  const audioCtx = useRef(null);
  
  const [role, setRole] = useState(null); 
  const [health, setHealth] = useState({ host: 650, guest: 650 }); 
  const [overHealth, setOverHealth] = useState({ host: 0, guest: 0 });
  const [boxHealth, setBoxHealth] = useState({ host: 300, guest: 300 }); 
  const [shieldHealth, setShieldHealth] = useState({ host: 350, guest: 350 }); 
  const [grenadesLeft, setGrenadesLeft] = useState(2);
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [screenShake, setScreenShake] = useState(0);
  const [lifestealPopups, setLifestealPopups] = useState([]);

  // Local Refs
  const myBox = useRef({ x: 60, y: 650 });
  const myShield = useRef({ x: 200, y: 550 }); 
  const myShooter = useRef({ x: 200, y: 630, rot: 0 });
  const enemyBox = useRef({ x: 340, y: 50 });
  const enemyShield = useRef({ x: 200, y: 150 });
  const enemyShooter = useRef({ x: 200, y: 70, rot: 0 });

  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const activeExplosions = useRef([]); 
  const activeSparks = useRef([]);
  const activeTouches = useRef(new Map());

  const opp = role === 'host' ? 'guest' : 'host';

  const playSound = useCallback((type) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.current.createOscillator();
    const g = audioCtx.current.createGain();
    osc.connect(g); g.connect(audioCtx.current.destination);
    if (type === 'explosion') {
      osc.frequency.setValueAtTime(50, 0); g.gain.exponentialRampToValueAtTime(0.01, 0.5); setScreenShake(10);
    } else {
      osc.frequency.setValueAtTime(1000, 0); g.gain.exponentialRampToValueAtTime(0.01, 0.1);
    }
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.5);
  }, []);

  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ['websocket'], upgrade: false });
    socket.current = s;
    s.emit("join_game", { roomId });
    s.on("assign_role", (d) => setRole(d.role));
    s.on("start_countdown", () => setCountdown(3));
    s.on("opp_move_all", (d) => { enemyShooter.current = d.shooter; enemyShield.current = d.shield; enemyBox.current = d.box; });
    s.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    s.on("update_game_state", (d) => {
      setHealth(d.health); setOverHealth(d.overHealth); setBoxHealth(d.boxHealth); setShieldHealth(d.shieldHealth);
      if (d.targetHit) { playSound('metallic'); activeSparks.current.push({ x: d.hitX, y: d.hitY, life: 1 }); }
      if (d.damageType === 'grenade') { activeExplosions.current.push({ x: d.hitX, y: d.hitY, r: 0, alpha: 1 }); playSound('explosion'); }
      if (d.targetHit === 'box' && d.attackerRole === role) {
        const id = Date.now(); setLifestealPopups(p => [...p, { id }]);
        setTimeout(() => setLifestealPopups(p => p.filter(x => x.id !== id)), 800);
      }
      if (d.health.host <= 0 || d.health.guest <= 0) setGameOver(role === (d.health.host <= 0 ? 'guest' : 'host') ? "win" : "lose");
    });
    return () => s.disconnect();
  }, [roomId, role, playSound]);

  useEffect(() => {
    if (countdown > 0) { const t = setTimeout(() => setCountdown(countdown - 1), 1000); return () => clearTimeout(t); }
  }, [countdown]);

  const handleTouch = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    for (let t of e.changedTouches) {
      const tx = ((t.clientX - rect.left) / rect.width) * W;
      const ty = ((t.clientY - rect.top) / rect.height) * H;
      if (e.type === "touchstart") {
        if (Math.hypot(tx - myShooter.current.x, ty - (myShooter.current.y + 30)) < 40) activeTouches.current.set(t.identifier, "shooter");
        else if (Math.hypot(tx - myShield.current.x, ty - myShield.current.y) < 40) activeTouches.current.set(t.identifier, "shield");
        else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 30) activeTouches.current.set(t.identifier, "box");
      } else if (e.type === "touchmove" && ty > H/2 + 20) {
        const m = activeTouches.current.get(t.identifier);
        if (m === "shooter") { myShooter.current.x = tx; myShooter.current.y = ty - 30; myShooter.current.rot = (tx - W/2) / 200; }
        else if (m === "shield") { myShield.current.x = tx; myShield.current.y = ty; }
        else if (m === "box") { myBox.current.x = tx; myBox.current.y = ty; }
        socket.current.emit("move_all", { roomId, shooter: { x: W - myShooter.current.x, y: H - myShooter.current.y, rot: myShooter.current.rot + Math.PI }, shield: { x: W - myShield.current.x, y: H - myShield.current.y }, box: { x: W - myBox.current.x, y: H - myBox.current.y } });
      } else if (e.type === "touchend") activeTouches.current.delete(t.identifier);
    }
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.save(); if (screenShake > 0) { ctx.translate(Math.random()*screenShake, Math.random()*screenShake); setScreenShake(s => s*0.9); }
      ctx.clearRect(0,0,W,H);
      ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.setLineDash([10,5]); ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
      
      activeExplosions.current.forEach((ex, i) => {
        ex.r += 4; ex.alpha -= 0.02; ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, 7);
        ctx.fillStyle = `rgba(255,100,0,${ex.alpha})`; ctx.fill(); if (ex.alpha <= 0) activeExplosions.current.splice(i, 1);
      });

      const drawS = (p, c, isE) => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = c;
        ctx.beginPath(); if (isE) { ctx.moveTo(0,20); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); } else { ctx.moveTo(0,-20); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.beginPath(); ctx.arc(0, isE?-25:25, 10, 0, 7); ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.stroke(); ctx.restore();
      };
      drawS(myShooter.current, "#00f2ff", false); drawS(enemyShooter.current, "#ff3e3e", true);
      
      if (boxHealth[role] > 0) { ctx.fillStyle="#00f2ff"; ctx.fillRect(myBox.current.x-25, myBox.current.y-25, 50, 50); }
      if (boxHealth[opp] > 0) { ctx.fillStyle="#ff3e3e"; ctx.fillRect(enemyBox.current.x-25, enemyBox.current.y-25, 50, 50); }

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, screenShake]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box"><div className="mini-hp"><div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/></div></div>
        <div className="stat-box"><div className="mini-hp"><div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/><div className="fill over-gold" style={{width: `${(overHealth[role]/200)*100}%`}}/></div>
        {lifestealPopups.map(p => <span key={p.id} className="lifesteal-popup">+5HP</span>)}</div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {grenadesLeft > 0 && <button className="grenade-btn" onClick={() => { /* Grenade Logic */ }}>G ({grenadesLeft})</button>}
    </div>
  );
}