import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com"; 
const W = 400; 
const H = 700; 

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
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [screenShake, setScreenShake] = useState(0);
  const [lifestealPopups, setLifestealPopups] = useState([]);

  // Local State for Controls
  const myBox = useRef({ x: 60, y: 650 });
  const myShield = useRef({ x: 200, y: 550 }); // Shield Handle Center
  const myShooter = useRef({ x: 200, y: 630, rot: 0 });
  const steerWheel = useRef({ x: 320, y: 620, r: 45 }); // Steer Wheel Position
  
  const enemyBox = useRef({ x: 340, y: 50 });
  const enemyShield = useRef({ x: 200, y: 150 });
  const enemyShooter = useRef({ x: 200, y: 70, rot: 0 });

  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const activeExplosions = useRef([]); 
  const recoilY = useRef(0);
  const activeTouches = useRef(new Map());

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
    s.on("opp_move_all", (d) => { 
      enemyShooter.current = d.shooter; 
      enemyShield.current = d.shield; 
      enemyBox.current = d.box; 
    });
    s.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    
    s.on("update_game_state", (data) => {
      setHealth(data.health);
      setOverHealth(data.overHealth);
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      if (data.targetHit) playSound('metallic');
      if (data.targetHit === 'box' && data.attackerRole === role) {
        const id = Date.now(); setLifestealPopups(p => [...p, { id }]);
        setTimeout(() => setLifestealPopups(p => p.filter(x => x.id !== id)), 800);
      }
      if (data.health.host <= 0 || data.health.guest <= 0) {
        setGameOver(role === (data.health.host <= 0 ? 'guest' : 'host') ? "win" : "lose");
      }
    });
    return () => s.disconnect();
  }, [roomId, role, playSound]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Shooting loop
  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const rot = myShooter.current.rot;
      const tx = myShooter.current.x + Math.sin(rot) * 30;
      const ty = myShooter.current.y - Math.cos(rot) * 30;
      const vx = Math.sin(rot) * 18;
      const vy = -Math.cos(rot) * 18;
      myBullets.current.push({ x: tx, y: ty, vx, vy });
      socket.current.emit("fire", { roomId, x: W - tx, y: H - ty, vx: -vx, vy: -vy });
      recoilY.current = 6;
    }, 180);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const tx = ((t.clientX - rect.left) / rect.width) * W;
      const ty = ((t.clientY - rect.top) / rect.height) * H;

      if (e.type === "touchstart" || e.type === "touchmove") {
        // Determine what the user is touching
        const distToSteer = Math.hypot(tx - steerWheel.current.x, ty - steerWheel.current.y);
        const distToShield = Math.hypot(tx - myShield.current.x, ty - myShield.current.y);

        if (distToSteer < 60) {
          activeTouches.current.set(t.identifier, "steer");
        } else if (distToShield < 60) {
          activeTouches.current.set(t.identifier, "shield");
        } else if (ty > H / 2) {
          activeTouches.current.set(t.identifier, "move");
        }

        const mode = activeTouches.current.get(t.identifier);
        if (mode === "steer") {
          myShooter.current.rot = Math.atan2(tx - steerWheel.current.x, steerWheel.current.y - ty);
        } else if (mode === "shield") {
          myShield.current.x = tx;
          myShield.current.y = Math.max(H / 2 + 30, ty);
        } else if (mode === "move") {
          myShooter.current.x = tx;
          myShooter.current.y = Math.max(H / 2 + 50, ty);
        }

        socket.current.emit("move_all", {
          roomId,
          shooter: { x: W - myShooter.current.x, y: H - myShooter.current.y, rot: myShooter.current.rot + Math.PI },
          shield: { x: W - myShield.current.x, y: H - myShield.current.y },
          box: { x: W - myBox.current.x, y: H - myBox.current.y }
        });
      }

      if (e.type === "touchend" || e.type === "touchcancel") {
        activeTouches.current.delete(t.identifier);
      }
    }
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.save();
      if (screenShake > 0) { ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake); setScreenShake(s => Math.max(0, s-1)); }
      ctx.clearRect(-50, -50, W+100, H+100);

      // Draw My Shield & Handle
      if (shieldHealth[role] > 0) {
        ctx.beginPath();
        ctx.arc(myShield.current.x, myShield.current.y, 40, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 242, 255, 0.2)"; // Translucent Circle Handle
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(myShield.current.x, myShield.current.y - 40, 60, 1.2 * Math.PI, 1.8 * Math.PI);
        ctx.strokeStyle = "#00f2ff"; ctx.lineWidth = 5; ctx.stroke();
      }

      // Draw My Steer Wheel
      ctx.beginPath();
      ctx.arc(steerWheel.current.x, steerWheel.current.y, steerWheel.current.r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
      
      const knobX = steerWheel.current.x + Math.sin(myShooter.current.rot) * 30;
      const knobY = steerWheel.current.y - Math.cos(myShooter.current.rot) * 30;
      ctx.beginPath(); ctx.arc(knobX, knobY, 10, 0, Math.PI*2); ctx.fillStyle = "#00f2ff"; ctx.fill();

      // Enemy Elements
      if (shieldHealth[opp] > 0) {
        ctx.beginPath();
        ctx.arc(enemyShield.current.x, enemyShield.current.y + 40, 60, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.strokeStyle = "#ff3e3e"; ctx.lineWidth = 5; ctx.stroke();
      }

      // Draw Shooters
      const drawS = (p, c, isE) => {
        ctx.save(); ctx.translate(p.x, isE?p.y:p.y+recoilY.current); ctx.rotate(p.rot || 0);
        ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0,25); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); } 
        else { ctx.moveTo(0,-25); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.restore();
        if (recoilY.current > 0) recoilY.current -= 1;
      };
      drawS(myShooter.current, "#00f2ff", false);
      drawS(enemyShooter.current, "#ff3e3e", true);

      // Boxes
      if (boxHealth[role] > 0) { ctx.fillStyle="#00f2ff"; ctx.fillRect(myBox.current.x-25, myBox.current.y-25, 50, 50); }
      if (boxHealth[opp] > 0) { ctx.fillStyle="#ff3e3e"; ctx.fillRect(enemyBox.current.x-25, enemyBox.current.y-25, 50, 50); }

      // Bullet Physics (Simplified for build stability)
      [myBullets.current, enemyBullets.current].forEach((bullets, isEGroup) => {
        bullets.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = isEGroup ? "#ff3e3e" : "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
          if (b.y < -50 || b.y > H+50) bullets.splice(i, 1);
        });
      });

      ctx.restore(); frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth, screenShake, playSound]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
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