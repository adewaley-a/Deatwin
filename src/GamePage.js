import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com";
const W = 400; const H = 700;
const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

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
  const [gameOver, setGameOver] = useState(null);
  const [finalScore, setFinalScore] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [screenShake, setScreenShake] = useState(0);
  const [lifestealPopups, setLifestealPopups] = useState([]);

  const myBox = useRef({ x: 60, y: 650 });
  const myShield = useRef({ x: 60, y: 580 });
  const myShooter = useRef({ x: 130, y: 630, rot: 0 });

  const enemyShooter = useRef({ x: 270, y: 70, rot: 0 });
  const enemyShield = useRef({ x: 340, y: 120 });
  const enemyBox = useRef({ x: 340, y: 50 });

  const enemyTarget = useRef({
    shooter: { x: 270, y: 70, rot: 0 },
    shield: { x: 340, y: 120 },
    box: { x: 340, y: 50 }
  });

  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]);
  const activeTouches = useRef(new Map());
  const opp = role === 'host' ? 'guest' : 'host';

  const playSound = useCallback((type) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.connect(gain); gain.connect(audioCtx.current.destination);
    osc.frequency.setValueAtTime(type === 'hit' ? 1200 : 800, audioCtx.current.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.1);
  }, []);

  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current = s;
    s.emit("join_game", { roomId });
    s.on("assign_role", (data) => setRole(data.role));
    s.on("start_countdown", () => setCountdown(3));
    
    s.on("opp_move_all", (data) => {
      enemyTarget.current = data;
    });

    s.on("incoming_bullet", (b) => enemyBullets.current.push(b));

    s.on("update_game_state", (data) => {
      setHealth(data.health);
      setOverHealth(data.overHealth);
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      
      if (data.lastHit?.target === 'box') {
        const id = Math.random();
        setLifestealPopups(p => [...p, { id, attacker: data.lastHit.attackerRole }]);
        setTimeout(() => setLifestealPopups(p => p.filter(x => x.id !== id)), 800);
      }

      if (data.health.host <= 0 || data.health.guest <= 0) {
        const winner = data.health.host <= 0 ? 'guest' : 'host';
        setFinalScore(Math.floor(data.health[winner] + data.overHealth[winner]));
        setGameOver(role === winner ? "win" : "lose");
      }
    });

    return () => s.disconnect();
  }, [roomId, role]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const tipX = myShooter.current.x + Math.sin(myShooter.current.rot) * 30;
      const tipY = myShooter.current.y - Math.cos(myShooter.current.rot) * 30;
      const vx = Math.sin(myShooter.current.rot) * 18;
      const vy = -Math.cos(myShooter.current.rot) * 18;
      myBullets.current.push({ x: tipX, y: tipY, vx, vy });
      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy });
    }, 200);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    Array.from(e.changedTouches).forEach(t => {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);
      if (e.type === "touchstart") {
        let id = null;
        if (Math.hypot(tx - myShooter.current.x, ty - myShooter.current.y) < 50) id = "shooter";
        else if (Math.hypot(tx - myShooter.current.x, ty - (myShooter.current.y + 45)) < 30) id = "wheel";
        else if (Math.hypot(tx - myShield.current.x, ty - myShield.current.y) < 60) id = "shield";
        else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 60) id = "box";
        if (id) activeTouches.current.set(t.identifier, id);
      }
      if (e.type === "touchmove") {
        const draggingId = activeTouches.current.get(t.identifier);
        if (draggingId === "wheel") {
          myShooter.current.rot = Math.max(-1.2, Math.min(1.2, (tx - myShooter.current.x) / 20));
        } else if (draggingId) {
          const target = draggingId === "shooter" ? myShooter : draggingId === "shield" ? myShield : myBox;
          target.current.x = Math.max(30, Math.min(W - 30, tx));
          target.current.y = Math.max(H/2 + 50, Math.min(H - 40, ty));
        }
        socket.current.emit("move_all", {
          roomId, 
          shooter: { x: W-myShooter.current.x, y: H-myShooter.current.y, rot: -myShooter.current.rot },
          shield: { x: W-myShield.current.x, y: H-myShield.current.y }, 
          box: { x: W-myBox.current.x, y: H-myBox.current.y }
        });
      }
      if (e.type === "touchend") activeTouches.current.delete(t.identifier);
    });
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      // Interpolation
      enemyShooter.current.x = lerp(enemyShooter.current.x, enemyTarget.current.shooter.x, 0.2);
      enemyShooter.current.y = lerp(enemyShooter.current.y, enemyTarget.current.shooter.y, 0.2);
      enemyShooter.current.rot = lerp(enemyShooter.current.rot, enemyTarget.current.shooter.rot, 0.2);
      enemyShield.current.x = lerp(enemyShield.current.x, enemyTarget.current.shield.x, 0.2);
      enemyShield.current.y = lerp(enemyShield.current.y, enemyTarget.current.shield.y, 0.2);
      enemyBox.current.x = lerp(enemyBox.current.x, enemyTarget.current.box.x, 0.2);
      enemyBox.current.y = lerp(enemyBox.current.y, enemyTarget.current.box.y, 0.2);

      // Sparks
      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.life--;
        ctx.fillStyle = `rgba(255, 255, 255, ${s.life/20})`;
        ctx.fillRect(s.x, s.y, 2, 2);
        if (s.life <= 0) sparks.current.splice(i, 1);
      });

      // Bullets & Tight Hitbox Collision
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();

        const distS = Math.hypot(b.x - enemyShield.current.x, b.y - enemyShield.current.y);
        const angle = Math.atan2(b.y - enemyShield.current.y, b.x - enemyShield.current.x);
        
        // Shield Hitbox: Distance check + Arc Angle Check (Approx 45 to 135 degrees for top shield)
        if (shieldHealth[opp] > 0 && distS < 65 && distS > 50 && angle > 0.6 && angle < 2.5) {
          playSound('hit'); sparks.current.push({x: b.x, y: b.y, vx: (Math.random()-0.5)*10, vy: -5, life: 20});
          socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: opp });
          myBullets.current.splice(i, 1);
        } else if (boxHealth[opp] > 0 && Math.abs(b.x - enemyBox.current.x) < 25 && Math.abs(b.y - enemyBox.current.y) < 25) {
          playSound('hit'); socket.current.emit("take_damage", { roomId, target: 'box', victimRole: opp });
          myBullets.current.splice(i, 1);
        } else if (Math.hypot(b.x - enemyShooter.current.x, b.y - enemyShooter.current.y) < 25) {
          socket.current.emit("take_damage", { roomId, target: 'player', victimRole: opp });
          myBullets.current.splice(i, 1);
        }
      });

      enemyBullets.current.forEach(b => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
      });

      // Rendering Elements (Mirrored via logic)
      if (boxHealth[role] > 0) { ctx.fillStyle = "#00f2ff"; ctx.fillRect(myBox.current.x-25, myBox.current.y-25, 50, 50); }
      if (boxHealth[opp] > 0) { ctx.fillStyle = "#ff3e3e"; ctx.fillRect(enemyBox.current.x-25, enemyBox.current.y-25, 50, 50); }

      const drawShield = (p, c, hp, isE) => {
        if (hp <= 0) return;
        ctx.strokeStyle = c; ctx.lineWidth = 5; ctx.beginPath();
        ctx.arc(p.x, p.y, 60, isE ? 0.25*Math.PI : -0.75*Math.PI, isE ? 0.75*Math.PI : -0.25*Math.PI);
        ctx.stroke();
      };
      drawShield(myShield.current, "#00f2ff", shieldHealth[role], false);
      drawShield(enemyShield.current, "#ff3e3e", shieldHealth[opp], true);

      const drawS = (p, c, isE) => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0,30); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); }
        else { ctx.moveTo(0,-30); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.restore();
      };
      drawS(myShooter.current, "#00f2ff", false);
      drawS(enemyShooter.current, "#ff3e3e", true);

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="label">ENEMY</span>
          <div className="mini-hp">
            <div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/>
            <div className="fill over-gold" style={{width: `${(overHealth[opp]/300)*100}%`}}/>
            <span className="hp-num">{Math.floor(health[opp] + overHealth[opp])}</span>
          </div>
          {lifestealPopups.find(p => p.attacker === opp) && <span className="lifesteal-text enemy">+5hp</span>}
        </div>
        <div className="stat-box">
          <span className="label">YOU</span>
          <div className="mini-hp">
            <div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/>
            <div className="fill over-gold" style={{width: `${(overHealth[role]/300)*100}%`}}/>
            <span className="hp-num">{Math.floor(health[role] + overHealth[role])}</span>
          </div>
          {lifestealPopups.find(p => p.attacker === role) && <span className="lifesteal-text player">+5hp</span>}
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {gameOver && (
        <div className={`overlay ${gameOver}`}>
          <h1 className="status-title">{gameOver === "win" ? "VICTORY" : "DEFEAT"}</h1>
          <button className="exit-btn" onClick={() => navigate("/second-page")}>REPLAY</button>
        </div>
      )}
    </div>
  );
}