import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com"; 

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
  const [, setGrenades] = useState({ host: 2, guest: 2 }); 
  const [gameOver, setGameOver] = useState(null);
  const [, setFinalScore] = useState(0); 
  const [countdown, setCountdown] = useState(null);
  const [screenShake, setScreenShake] = useState(0);
  const [lifestealPopups, setLifestealPopups] = useState([]);
  const [isCooking] = useState(false); 
  const [, setCookProgress] = useState(0); 

  const W = 400; const H = 700; 
  const myBox = useRef({ x: 60, y: 650 });
  const myShield = useRef({ x: 60, y: 580 });
  const myShooter = useRef({ x: 130, y: 630, rot: 0 });
  const enemyBox = useRef({ x: 340, y: 50 });
  const enemyShield = useRef({ x: 340, y: 120 });
  const enemyShooter = useRef({ x: 270, y: 70, rot: 0 });

  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const activeGrenades = useRef([]);
  const activeExplosions = useRef([]); 
  const sparks = useRef([]);
  const recoilY = useRef(0);
  
  const opp = role === 'host' ? 'guest' : 'host';

  const playSound = useCallback((type) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.connect(gain); gain.connect(audioCtx.current.destination);
    
    if (type === 'explosion') {
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(40, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.5, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.6);
      setScreenShake(15);
    } else if (type === 'metallic') {
      osc.type = 'sine'; osc.frequency.setValueAtTime(1200, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.1, audioCtx.current.currentTime);
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
    s.on("opp_move_all", (d) => { enemyShooter.current = d.shooter; enemyShield.current = d.shield; enemyBox.current = d.box; });
    s.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    s.on("incoming_grenade", (g) => activeGrenades.current.push({ ...g, isEnemy: true }));
    
    s.on("update_game_state", (data) => {
      setHealth(data.health);
      setOverHealth(data.overHealth);
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      setGrenades(data.grenades);

      if (data.targetHit) {
        playSound('metallic');
        const tgtPos = data.targetHit === 'box' ? (data.victimRole === role ? myBox.current : enemyBox.current) : (data.victimRole === role ? myShield.current : enemyShield.current);
        if (tgtPos) {
          for (let i = 0; i < 6; i++) sparks.current.push({ x: tgtPos.x, y: tgtPos.y, vx: (Math.random()-0.5)*8, vy: (Math.random()-0.5)*8, life: 1.0, color: '#00f2ff' });
        }
      }
      
      if (data.targetHit === 'box' && data.attackerRole === role) {
        const id = Date.now(); setLifestealPopups(p => [...p, { id }]);
        setTimeout(() => setLifestealPopups(p => p.filter(x => x.id !== id)), 800);
      }

      if (data.health.host <= 0 || data.health.guest <= 0) {
        const winner = data.health.host <= 0 ? 'guest' : 'host';
        setFinalScore(data.health[winner] + data.shieldHealth[winner] + data.boxHealth[winner] + data.overHealth[winner]);
        setGameOver(role === winner ? "win" : "lose");
      }
    });
    return () => s.disconnect();
  }, [roomId, role, playSound, setFinalScore, setGrenades]);

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
      const tx = myShooter.current.x + Math.sin(rot) * 30; const ty = myShooter.current.y - Math.cos(rot) * 30;
      const vx = Math.sin(rot) * 18; const vy = -Math.cos(rot) * 18;
      myBullets.current.push({ x: tx, y: ty, vx, vy });
      socket.current.emit("fire", { roomId, x: W - tx, y: H - ty, vx: -vx, vy: -vy });
      recoilY.current = 6;
    }, 180);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, isCooking, roomId, W, H]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.save();
      if (screenShake > 0) { ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake); setScreenShake(s => Math.max(0, s-1)); }
      ctx.clearRect(-50, -50, W+100, H+100);

      const drawSh = (p, hp, isE) => {
        if (hp <= 0) return;
        ctx.save(); ctx.translate(p.x, p.y); ctx.beginPath();
        const sA = isE ? 0.2*Math.PI : 1.2*Math.PI; const eA = isE ? 0.8*Math.PI : 1.8*Math.PI;
        ctx.arc(0,0,60,sA,eA); ctx.strokeStyle = isE?"#ff3e3e":"#00f2ff"; ctx.lineWidth=5; ctx.stroke(); ctx.restore();
      };
      drawSh(myShield.current, shieldHealth[role], false);
      drawSh(enemyShield.current, shieldHealth[opp], true);

      if (boxHealth[role] > 0) { ctx.fillStyle="#00f2ff"; ctx.fillRect(myBox.current.x-25, myBox.current.y-25, 50, 50); }
      if (boxHealth[opp] > 0) { ctx.fillStyle="#ff3e3e"; ctx.fillRect(enemyBox.current.x-25, enemyBox.current.y-25, 50, 50); }

      const handleBullets = (bullets, isEGroup) => {
        bullets.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = isEGroup ? "#ff3e3e" : "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
          
          const tgtRole = isEGroup ? role : opp;
          const tgtB = isEGroup ? myBox.current : enemyBox.current;
          const tgtS = isEGroup ? myShooter.current : enemyShooter.current;
          const tgtSh = isEGroup ? myShield.current : enemyShield.current;

          let hit = false;
          if (boxHealth[tgtRole] > 0 && b.x > tgtB.x-25 && b.x < tgtB.x+25 && b.y > tgtB.y-25 && b.y < tgtB.y+25) {
             hit = true; if(!isEGroup) socket.current.emit("take_damage", { roomId, target: 'box', victimRole: tgtRole });
          } else if (shieldHealth[tgtRole] > 0) {
             const d = Math.hypot(b.x-tgtSh.x, b.y-tgtSh.y);
             if (d < 65 && d > 55) { hit = true; if(!isEGroup) socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: tgtRole }); }
          } else if (Math.hypot(b.x-tgtS.x, b.y-tgtS.y) < 25) {
             hit = true; if(!isEGroup) socket.current.emit("take_damage", { roomId, target: 'player', victimRole: tgtRole });
          }

          if (hit) bullets.splice(i, 1);
          else if (b.y < -50 || b.y > H+50) bullets.splice(i, 1);
        });
      };
      handleBullets(myBullets.current, false);
      handleBullets(enemyBullets.current, true);

      activeExplosions.current.forEach((ex, i) => {
        ex.alpha -= 0.05; ctx.beginPath(); ctx.arc(ex.x, ex.y, 120, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255, 170, 0, ${ex.alpha})`; ctx.fill();
        if (ex.alpha <= 0) activeExplosions.current.splice(i, 1);
      });

      activeGrenades.current.forEach((g, i) => {
        g.x += g.vx; g.y += g.vy; g.timer--;
        ctx.fillStyle = "#ffaa00"; ctx.beginPath(); ctx.arc(g.x, g.y, 10, 0, Math.PI*2); ctx.fill();
        if (g.timer <= 0) {
          playSound('explosion');
          activeExplosions.current.push({ x: g.x, y: g.y, alpha: 0.6 });
          if (!g.isEnemy) {
            const tgts = [{t:'player',p:enemyShooter.current},{t:'shield',p:enemyShield.current},{t:'box',p:enemyBox.current}];
            tgts.forEach(tgt => {
              const dist = Math.hypot(g.x-tgt.p.x, g.y-tgt.p.y);
              if (dist < 120) socket.current.emit("take_damage", { roomId, target: tgt.t, victimRole: opp, damageType: 'grenade', customDamage: Math.floor(70*(1-(dist/120))) });
            });
          }
          activeGrenades.current.splice(i,1);
        }
      });

      const drawS = (p, c, isE) => {
        ctx.save(); ctx.translate(p.x, isE?p.y:p.y+recoilY.current); ctx.rotate(p.rot || 0);
        ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0,25); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); } 
        else { ctx.moveTo(0,-25); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.restore();
      };
      drawS(myShooter.current, "#00f2ff", false);
      drawS(enemyShooter.current, "#ff3e3e", true);

      ctx.restore(); frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth, screenShake, playSound, roomId, W, H]);

  return (
    <div className="game-container">
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="label-top">OPP</span>
          <div className="mini-hp"><div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/><span className="hp-val">{Math.ceil(health[opp])}</span></div>
        </div>
        <div className="stat-box">
          <span className="label-top you-label">YOU</span>
          <div className="hp-wrapper">
             <div className="mini-hp">
               <div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/><div className="fill over-gold" style={{width: `${(overHealth[role]/200)*100}%`}}/>
               <span className="hp-val">{Math.ceil(health[role] + overHealth[role])}</span>
             </div>
             {lifestealPopups.map(p => (<span key={p.id} className="lifesteal-popup">+5HP</span>))}
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && <div className={`overlay ${gameOver}-screen`}><h1 className="result-title">{gameOver === 'win' ? "VICTORY" : "DEFEATED"}</h1></div>}
    </div>
  );
}