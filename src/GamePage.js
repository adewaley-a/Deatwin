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

  const playSound = useCallback((type) => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.connect(gain); gain.connect(audioCtx.current.destination);
    if (type === 'explosion') {
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(40, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.5, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.8);
      setScreenShake(20);
    } else {
      osc.frequency.setValueAtTime(800, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    }
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.8);
  }, []);

  const createSparks = useCallback((x, y) => {
    for (let i = 0; i < 8; i++) {
      sparks.current.push({ x, y, vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10, life: 20 });
    }
  }, []);

  const handleExplosion = useCallback((x, y) => {
    playSound('explosion');
    explosionAnims.current.push({ x, y, r: 0, life: 30 });
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
  }, [roomId, role, playSound]);

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
      setHealth(data.health); setOverHealth(data.overHealth);
      setBoxHealth(data.boxHealth); setShieldHealth(data.shieldHealth);
      setGrenades(data.grenades);
      
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const winner = data.health.host <= 0 ? 'guest' : 'host';
        const total = data.health[winner] + data.shieldHealth[winner] + data.boxHealth[winner] + data.overHealth[winner];
        setFinalScore(Math.floor(total));
        setGameOver(role === winner ? "win" : "lose");
      }
    });
    return () => s.disconnect();
  }, [roomId, role, playSound]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timerId = setInterval(() => setCountdown(c => c - 1), 1000);
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
    }, 180);
    return () => clearInterval(fireInt);
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
        const draggingId = activeTouches.current.get(t.identifier);
        if (draggingId === "wheel") {
          myShooter.current.rot = Math.max(-1.2, Math.min(1.2, (tx - myShooter.current.x) / 20));
        } else if (draggingId && !isCooking.current) {
          const target = draggingId === "shooter" ? myShooter : draggingId === "shield" ? myShield : myBox;
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
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.save();
      if (screenShake > 0) { ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake); setScreenShake(s => Math.max(0, s-1.5)); }
      ctx.clearRect(-50, -50, W+100, H+100);

      explosionAnims.current.forEach((a, i) => {
        a.r += 6; a.life--;
        ctx.strokeStyle = `rgba(255, 100, 0, ${a.life / 30})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI*2); ctx.stroke();
        if (a.life <= 0) explosionAnims.current.splice(i, 1);
      });

      activeGrenades.current.forEach((g, i) => {
        g.x += g.vx; g.y += g.vy; g.timer--;
        ctx.fillStyle = "#ffaa00"; ctx.beginPath(); ctx.arc(g.x, g.y, 10, 0, Math.PI*2); ctx.fill();
        if (g.timer <= 0) { handleExplosion(g.x, g.y); activeGrenades.current.splice(i, 1); }
      });

      const processBullets = (bullets, isEnemy) => {
        bullets.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = isEnemy ? "#ff3e3e" : "#00f2ff";
          ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
          if (!isEnemy) {
            const distS = Math.hypot(b.x - enemyShield.current.x, b.y - enemyShield.current.y);
            const ang = Math.atan2(b.y - enemyShield.current.y, b.x - enemyShield.current.x);
            const inArc = ang > Math.PI * 0.25 && ang < Math.PI * 0.75;
            if (shieldHealth[opp] > 0 && distS > 55 && distS < 65 && inArc) {
              createSparks(b.x, b.y); socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: opp, damageType: 'bullet' });
              bullets.splice(i, 1);
            } else if (boxHealth[opp] > 0 && Math.abs(b.x - enemyBox.current.x) < 25 && Math.abs(b.y - enemyBox.current.y) < 25) {
              createSparks(b.x, b.y); socket.current.emit("take_damage", { roomId, target: 'box', victimRole: opp, damageType: 'bullet' });
              bullets.splice(i, 1);
            } else if (Math.hypot(b.x - enemyShooter.current.x, b.y - enemyShooter.current.y) < 25) {
              createSparks(b.x, b.y); socket.current.emit("take_damage", { roomId, target: 'player', victimRole: opp, damageType: 'bullet' });
              bullets.splice(i, 1);
            }
          }
          if (b.y < -50 || b.y > H + 50) bullets.splice(i, 1);
        });
      };
      processBullets(myBullets.current, false); processBullets(enemyBullets.current, true);

      if (isCooking.current) {
        cookPower.current = Math.min(1, cookPower.current + 0.006);
        ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 4; ctx.beginPath();
        ctx.arc(myShooter.current.x, myShooter.current.y, 45, -Math.PI/2, (-Math.PI/2)+(Math.PI*2*cookPower.current));
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(0, 242, 255, 0.2)"; ctx.beginPath(); 
      ctx.arc(myShield.current.x, myShield.current.y, 30, 0, Math.PI*2); ctx.fill();

      ctx.strokeStyle = "rgba(0, 242, 255, 0.4)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(myShooter.current.x, myShooter.current.y + 45, 20, 0, Math.PI*2); ctx.stroke();

      if (boxHealth[role] > 0) {
        ctx.fillStyle = "#00f2ff"; ctx.fillRect(myBox.current.x-25, myBox.current.y-25, 50, 50);
      }
      
      const drawShield = (p, c, hp, isE) => {
        if (hp <= 0) return;
        ctx.strokeStyle = c; ctx.lineWidth = 5; ctx.beginPath();
        ctx.arc(p.x, p.y, 60, isE ? Math.PI*0.25 : -Math.PI*0.75, isE ? Math.PI*0.75 : -Math.PI*0.25); ctx.stroke();
      };
      drawShield(myShield.current, "#00f2ff", shieldHealth[role], false);
      drawShield(enemyShield.current, "#ff3e3e", shieldHealth[opp], true);
      
      const drawS = (p, c, isE) => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0); ctx.fillStyle = c;
        ctx.beginPath(); if (isE) { ctx.moveTo(0,30); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); }
        else { ctx.moveTo(0,-30); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.restore();
      };
      drawS(myShooter.current, "#00f2ff", false); drawS(enemyShooter.current, "#ff3e3e", true);
      ctx.restore();
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, opp, boxHealth, shieldHealth, screenShake, muzzleFlash, handleExplosion]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="label">ENEMY</span>
          <div className="mini-hp"><div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/><span className="hp-num">{Math.floor(health[opp])}</span></div>
        </div>
        <div className="stat-box">
          <span className="label">YOU</span>
          <div className="mini-hp">
            <div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/>
            <div className="fill over-gold" style={{width: `${(overHealth[role]/300)*100}%`}}/>
            <span className="hp-num">{Math.floor(health[role] + overHealth[role])}</span>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown !== null && countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && (
        <div className={`overlay ${gameOver}`}>
          <h1 className="status-title">{gameOver === "win" ? "VICTORY" : "DEFEAT"}</h1>
          {gameOver === "win" && (
            <>
              <div className="final-points">Survivor Points: {finalScore}</div>
              <p className="sub-text">You dominated the arena.</p>
            </>
          )}
          {gameOver === "lose" && (
            <p className="sub-text">Better luck next time, warrior.</p>
          )}
          <button className="exit-btn" onClick={() => navigate("/second-page")}>REPLAY</button>
        </div>
      )}
    </div>
  );
}