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
  const [sparks, setSparks] = useState([]);

  const W = 400, H = 700; 
  const myBox = useRef({ x: 60, y: 650 });
  const myShield = useRef({ x: 60, y: 580 });
  const myShooter = useRef({ x: 130, y: 630, rot: 0 });
  const enemyBox = useRef({ x: 340, y: 50 });
  const enemyShield = useRef({ x: 340, y: 120 });
  const enemyShooter = useRef({ x: 270, y: 70, rot: 0 });

  const myBullets = useRef([]);
  const activeGrenades = useRef([]);
  const lastTapTime = useRef(0);
  const isCooking = useRef(false);
  const cookStartTime = useRef(0);

  const opp = role === 'host' ? 'guest' : 'host';

  const createSparks = useCallback((x, y, color) => {
    const newSparks = Array.from({ length: 8 }).map(() => ({
      x, y, 
      vx: (Math.random() - 0.5) * 8, 
      vy: (Math.random() - 0.5) * 8, 
      life: 1.0, 
      color 
    }));
    setSparks(prev => [...prev, ...newSparks]);
  }, []);

  const playSound = useCallback((type) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.connect(gain); gain.connect(audioCtx.current.destination);
    if (type === 'explosion') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(40, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.6);
      setScreenShake(20);
    } else {
      osc.frequency.setValueAtTime(type === 'shield' ? 180 : 120, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    }
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.6);
  }, []);

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
    socket.current.on("incoming_bullet", () => {
      setMuzzleFlash(true); setTimeout(() => setMuzzleFlash(false), 50);
    });
    socket.current.on("incoming_grenade", (g) => {
      activeGrenades.current.push({ ...g, isEnemy: true, timer: 120 });
    });
    socket.current.on("spawn_sparks", (d) => createSparks(d.x, d.y, d.color));
    
    socket.current.on("update_game_state", (data) => {
      setHealth(data.health); setOverHealth(data.overHealth);
      setBoxHealth(data.boxHealth); setShieldHealth(data.shieldHealth);
      setGrenades(data.grenades);
      if (data.targetHit) playSound(data.targetHit === 'explosion' ? 'explosion' : 'impact');
      
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const winner = data.health.host <= 0 ? 'guest' : 'host';
        setGameOver(role === winner ? "win" : "lose");
        setFinalScore(data.health[winner] + data.shieldHealth[winner] + data.boxHealth[winner]);
      }
    });

    return () => socket.current.disconnect();
  }, [roomId, role, playSound, createSparks]);

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [countdown]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const now = Date.now();
    const t = e.changedTouches[0];
    const tx = (t.clientX - rect.left) * (W / rect.width);
    const ty = (t.clientY - rect.top) * (H / rect.height);

    if (e.type === "touchstart") {
      if (now - lastTapTime.current < 300 && grenades[role] > 0) {
        isCooking.current = true;
        cookStartTime.current = now;
      }
      lastTapTime.current = now;
    }

    if (e.type === "touchmove") {
      if (!isCooking.current) {
        myShooter.current.rot = Math.max(-1.2, Math.min(1.2, (tx - myShooter.current.x) / 30));
        myShooter.current.x = Math.max(30, Math.min(W - 30, tx));
        socket.current.emit("move_all", { 
          roomId, 
          shooter: { x: W - myShooter.current.x, y: H - myShooter.current.y, rot: -myShooter.current.rot },
          shield: { x: W - myShield.current.x, y: H - myShield.current.y },
          box: { x: W - myBox.current.x, y: H - myBox.current.y }
        });
      }
    }

    if (e.type === "touchend") {
      if (isCooking.current) {
        const held = Date.now() - cookStartTime.current;
        if (held >= 2000) {
          const dist = (H / 2) * 0.55;
          const targetX = myShooter.current.x + Math.sin(myShooter.current.rot) * dist;
          const targetY = myShooter.current.y - Math.cos(myShooter.current.rot) * dist;
          activeGrenades.current.push({ x: targetX, y: targetY, timer: 60, isEnemy: false });
          socket.current.emit("throw_grenade", { roomId, x: W - targetX, y: H - targetY });
        }
        isCooking.current = false;
      }
    }
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.save();
      if (screenShake > 0) {
        ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake);
        setScreenShake(s => Math.max(0, s - 0.8));
      }
      ctx.clearRect(0, 0, W, H);

      setSparks(prev => prev.filter(s => s.life > 0).map(s => {
        ctx.fillStyle = s.color; ctx.globalAlpha = s.life;
        ctx.fillRect(s.x, s.y, 3, 3);
        return { ...s, x: s.x + s.vx, y: s.y + s.vy, life: s.life - 0.04 };
      }));
      ctx.globalAlpha = 1;

      activeGrenades.current.forEach((g, i) => {
        g.timer--;
        if (g.timer > 0) {
          ctx.fillStyle = "#ffaa00"; ctx.beginPath(); ctx.arc(g.x, g.y, 10, 0, Math.PI*2); ctx.fill();
        } else {
          const alpha = Math.max(0, (20 + g.timer) / 20);
          ctx.fillStyle = `rgba(255, 170, 0, ${alpha * 0.4})`;
          ctx.beginPath(); ctx.arc(g.x, g.y, 100, 0, Math.PI*2); ctx.fill();
          if (g.timer === 0 && !g.isEnemy) socket.current.emit("grenade_explosion", { roomId, x: W - g.x, y: H - g.y });
          if (g.timer < -20) activeGrenades.current.splice(i, 1);
        }
      });

      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        const checkHit = (target, type, color) => {
          if (Math.hypot(b.x - target.x, b.y - target.y) < 35) {
            socket.current.emit("take_damage", { roomId, target: type, victimRole: opp });
            socket.current.emit("request_sparks", { roomId, x: b.x, y: b.y, color });
            myBullets.current.splice(i, 1);
            return true;
          } return false;
        };
        if (shieldHealth[opp] > 0) checkHit(enemyShield.current, 'shield', '#00ff88');
        else if (boxHealth[opp] > 0) checkHit(enemyBox.current, 'box', '#00f2ff');
        else checkHit(enemyShooter.current, 'player', '#ff3e3e');
        if (b.y < -50 || b.y > H + 50) myBullets.current.splice(i, 1);
      });

      if (!isCooking.current && role && !gameOver && countdown === 0 && frame % 15 === 0) {
        const vx = Math.sin(myShooter.current.rot) * 16;
        const vy = -Math.cos(myShooter.current.rot) * 16;
        myBullets.current.push({ x: myShooter.current.x, y: myShooter.current.y, vx, vy });
        socket.current.emit("fire", { roomId });
      }

      ctx.fillStyle = "#ff3e3e"; ctx.fillRect(enemyShooter.current.x-20, enemyShooter.current.y-20, 40, 40);
      ctx.fillStyle = "#00f2ff"; ctx.fillRect(myShooter.current.x-20, myShooter.current.y-20, 40, 40);
      ctx.restore();
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth, screenShake, gameOver, countdown, roomId]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <div className="player-tag opp">OPP</div>
          <div className="mini-hp"><div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/></div>
          <div className="hp-label">{health[opp]} HP</div>
        </div>
        <div className="stat-box">
          <div className="player-tag you">YOU</div>
          <div className="hp-wrapper">
             <div className="mini-hp">
               <div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/>
               <div className="fill over-gold" style={{width: `${(overHealth[role]/200)*100}%`}}/>
             </div>
             <div className="hp-label">{health[role]} (+{overHealth[role]}) HP</div>
             {isCooking.current && <div className="hold-timer">COOKING...</div>}
          </div>
          <span className="grenade-count">GRENADES: {grenades[role]}</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && (
        <div className="overlay">
          <h1 className={gameOver}>{gameOver === 'win' ? 'VICTORY' : 'DEFEAT'}</h1>
          <p className="score-value">{gameOver === 'win' ? `FINAL SCORE: ${finalScore}` : 'YOU WERE ELIMINATED'}</p>
          <button className="exit-btn" onClick={() => navigate("/")}>EXIT GAME</button>
        </div>
      )}
    </div>
  );
}