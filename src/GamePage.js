import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com";
const W = 400; const H = 700;

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
  const explosionAnims = useRef([]);
  const activeTouches = useRef(new Map());

  const lastTapTime = useRef(0);
  const isCooking = useRef(false);
  const cookPower = useRef(0);
  const opp = role === 'host' ? 'guest' : 'host';

  const playHitSound = useCallback(() => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
    const osc = audioCtx.current.createOscillator();
    const g = audioCtx.current.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, audioCtx.current.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, audioCtx.current.currentTime + 0.1);
    g.gain.setValueAtTime(0.1, audioCtx.current.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    osc.connect(g); g.connect(audioCtx.current.destination);
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.1);
  }, []);

  const createSparks = useCallback((x, y) => {
    playHitSound();
    for (let i = 0; i < 8; i++) {
      sparks.current.push({ x, y, vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10, life: 20 });
    }
  }, [playHitSound]);

  const handleExplosion = useCallback((x, y) => {
    explosionAnims.current.push({ x, y, r: 0, life: 30 });
    setScreenShake(15);
    const targets = [
      { id: 'player', pos: myShooter.current, r: role },
      { id: 'shield', pos: myShield.current, r: role },
      { id: 'box', pos: myBox.current, r: role }
    ];
    targets.forEach(t => {
      const d = Math.hypot(x - t.pos.x, y - t.pos.y);
      if (d < 150) {
        socket.current.emit("take_damage", { roomId, target: t.id, victimRole: t.r, damageType: 'grenade', dist: d });
      }
    });
  }, [roomId, role]);

  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current = s;
    s.emit("join_game", { roomId });
    s.on("assign_role", (d) => setRole(d.role));
    s.on("start_countdown", () => setCountdown(3));
    s.on("opp_move_all", (d) => {
      enemyShooter.current = d.shooter;
      enemyShield.current = d.shield;
      enemyBox.current = d.box;
    });
    s.on("incoming_bullet", (b) => {
        enemyBullets.current.push(b);
        setMuzzleFlash(true); setTimeout(() => setMuzzleFlash(false), 50);
    });
    s.on("incoming_grenade", (g) => activeGrenades.current.push({ ...g, isEnemy: true }));
    s.on("update_game_state", (d) => {
      setHealth(d.health); setOverHealth(d.overHealth);
      setBoxHealth(d.boxHealth); setShieldHealth(d.shieldHealth);
      setGrenades(d.grenades);
      if (d.lastHit?.target === 'box') {
        const id = Math.random();
        setLifestealPopups(p => [...p, { id, attacker: d.lastHit.attacker }]);
        setTimeout(() => setLifestealPopups(p => p.filter(x => x.id !== id)), 800);
      }
      if (d.health.host <= 0 || d.health.guest <= 0) {
        const winner = d.health.host <= 0 ? 'guest' : 'host';
        setFinalScore(Math.floor(d.health[winner] + d.overHealth[winner] + d.shieldHealth[winner]));
        setGameOver(role === winner ? "win" : "lose");
      }
    });
    return () => s.disconnect();
  }, [roomId, role]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const i = setInterval(() => {
      if (isCooking.current) return;
      const vx = Math.sin(myShooter.current.rot) * 18;
      const vy = -Math.cos(myShooter.current.rot) * 18;
      const tx = myShooter.current.x + Math.sin(myShooter.current.rot) * 30;
      const ty = myShooter.current.y - Math.cos(myShooter.current.rot) * 30;
      myBullets.current.push({ x: tx, y: ty, vx, vy });
      socket.current.emit("fire", { roomId, x: W-tx, y: H-ty, vx: -vx, vy: -vy });
      setMuzzleFlash(true); setTimeout(() => setMuzzleFlash(false), 50);
    }, 180);
    return () => clearInterval(i);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || (countdown !== null && countdown > 0)) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const now = Date.now();
    Array.from(e.changedTouches).forEach(t => {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);
      if (e.type === "touchstart") {
        let id = null;
        if (Math.hypot(tx - myShooter.current.x, ty - myShooter.current.y) < 50) {
          if (now - lastTapTime.current < 300 && grenades[role] > 0) { isCooking.current = true; cookPower.current = 0; }
          lastTapTime.current = now; id = "shooter";
        }
        else if (Math.hypot(tx - myShooter.current.x, ty - (myShooter.current.y + 45)) < 30) id = "wheel";
        else if (Math.hypot(tx - myShield.current.x, ty - myShield.current.y) < 60) id = "shield";
        else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 60) id = "box";
        if (id) activeTouches.current.set(t.identifier, id);
      }
      if (e.type === "touchmove") {
        const id = activeTouches.current.get(t.identifier);
        if (id === "wheel") myShooter.current.rot = Math.max(-1.2, Math.min(1.2, (tx - myShooter.current.x) / 20));
        else if (id && !isCooking.current) {
          const target = id === "shooter" ? myShooter : id === "shield" ? myShield : myBox;
          target.current.x = Math.max(30, Math.min(W - 30, tx));
          target.current.y = Math.max(H/2 + 50, Math.min(H - 40, ty));
        }
        socket.current.emit("move_all", {
          roomId, shooter: { x: W-myShooter.current.x, y: H-myShooter.current.y, rot: -myShooter.current.rot },
          shield: { x: W-myShield.current.x, y: H-myShield.current.y }, box: { x: W-myBox.current.x, y: H-myBox.current.y }
        });
      }
      if (e.type === "touchend") {
        const id = activeTouches.current.get(t.identifier);
        if (id === "shooter" && isCooking.current) {
          const force = 1 + cookPower.current * 18;
          const vx = Math.sin(myShooter.current.rot) * force;
          const vy = -Math.cos(myShooter.current.rot) * force;
          activeGrenades.current.push({ x: myShooter.current.x, y: myShooter.current.y, vx, vy, timer: 90 });
          socket.current.emit("throw_grenade", { roomId, role, x: W-myShooter.current.x, y: H-myShooter.current.y, vx: -vx, vy: -vy });
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
      if (screenShake > 0) { ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake); setScreenShake(s => Math.max(0, s-1)); }
      ctx.clearRect(-50,-50,W+100,H+100);

      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.life--;
        ctx.fillStyle = "#fff"; ctx.fillRect(s.x, s.y, 2, 2);
        if (s.life <= 0) sparks.current.splice(i, 1);
      });

      explosionAnims.current.forEach((a, i) => {
        a.r += 6; a.life--;
        ctx.strokeStyle = `rgba(255,100,0,${a.life/30})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI*2); ctx.stroke();
        if (a.life <= 0) explosionAnims.current.splice(i, 1);
      });

      const processBullets = (bullets, isEnemy) => {
        bullets.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = isEnemy ? "#ff3e3e" : "#00f2ff";
          ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
          if (!isEnemy) {
            const distS = Math.hypot(b.x - enemyShield.current.x, b.y - enemyShield.current.y);
            const ang = Math.atan2(b.y - enemyShield.current.y, b.x - enemyShield.current.x);
            // Shield blocks first
            if (shieldHealth[opp] > 0 && distS < 65 && distS > 55 && ang > 0.7 && ang < 2.4) {
              createSparks(b.x, b.y); bullets.splice(i, 1);
              socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: opp });
            } else if (boxHealth[opp] > 0 && Math.abs(b.x - enemyBox.current.x) < 25 && Math.abs(b.y - enemyBox.current.y) < 25) {
              createSparks(b.x, b.y); bullets.splice(i, 1);
              socket.current.emit("take_damage", { roomId, target: 'box', victimRole: opp });
            } else if (Math.hypot(b.x - enemyShooter.current.x, b.y - enemyShooter.current.y) < 25) {
              createSparks(b.x, b.y); bullets.splice(i, 1);
              socket.current.emit("take_damage", { roomId, target: 'player', victimRole: opp });
            }
          }
          if (b.y < -50 || b.y > H + 50) bullets.splice(i, 1);
        });
      };
      processBullets(myBullets.current, false); processBullets(enemyBullets.current, true);

      activeGrenades.current.forEach((g, i) => {
        g.x += g.vx; g.y += g.vy; g.timer--;
        ctx.fillStyle = "#ffa500"; ctx.beginPath(); ctx.arc(g.x, g.y, 10, 0, Math.PI*2); ctx.fill();
        if (g.timer <= 0) { handleExplosion(g.x, g.y); activeGrenades.current.splice(i, 1); }
      });

      if (boxHealth[role] > 0) { ctx.fillStyle = "#00f2ff"; ctx.fillRect(myBox.current.x-25, myBox.current.y-25, 50, 50); }
      if (boxHealth[opp] > 0) { ctx.fillStyle = "#ff3e3e"; ctx.fillRect(enemyBox.current.x-25, enemyBox.current.y-25, 50, 50); }

      const drawShield = (p, c, hp, isE) => {
        if (hp <= 0) return;
        ctx.strokeStyle = c; ctx.lineWidth = 5; ctx.beginPath();
        ctx.arc(p.x, p.y, 60, isE ? 0.25*Math.PI : -0.75*Math.PI, isE ? 0.75*Math.PI : -0.25*Math.PI); ctx.stroke();
      };
      drawShield(myShield.current, "#00f2ff", shieldHealth[role], false);
      drawShield(enemyShield.current, "#ff3e3e", shieldHealth[opp], true);

      const drawS = (p, c, isE, flash) => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        ctx.fillStyle = flash ? "#fff" : c;
        ctx.beginPath(); if (isE) { ctx.moveTo(0,30); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); }
        else { ctx.moveTo(0,-30); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.restore();
      };
      drawS(myShooter.current, "#00f2ff", false, muzzleFlash);
      drawS(enemyShooter.current, "#ff3e3e", true, false);

      ctx.restore();
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth, muzzleFlash, createSparks, handleExplosion, screenShake, roomId]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="label">ENEMY</span>
          <div className="mini-hp">
            <div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/>
            <div className="fill over-gold" style={{width: `${(overHealth[opp]/300)*100}%`}}/>
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
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && (
        <div className={`overlay ${gameOver}`}>
          <h1 className="status-title">{gameOver === "win" ? "VICTORY" : "DEFEAT"}</h1>
          {gameOver === "win" && <div className="final-points">Survivor Score: {finalScore}</div>}
          <button className="exit-btn" onClick={() => navigate("/second-page")}>REPLAY</button>
        </div>
      )}
    </div>
  );
}