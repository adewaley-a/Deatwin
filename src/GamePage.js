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
  
  const [role, setRole] = useState(null); 
  const [health, setHealth] = useState({ host: 650, guest: 650 }); 
  const [overHealth, setOverHealth] = useState({ host: 0, guest: 0 });
  const [boxHealth, setBoxHealth] = useState({ host: 300, guest: 300 }); 
  const [shieldHealth, setShieldHealth] = useState({ host: 350, guest: 350 }); 
  const [grenades, setGrenades] = useState({ host: 2, guest: 2 });
  const [gameOver, setGameOver] = useState(null);
  const [finalScore, setFinalScore] = useState(0);
  const [countdown, setCountdown] = useState(null);
  
  const [showHealHost, setShowHealHost] = useState(false);
  const [showHealGuest, setShowHealGuest] = useState(false);

  const W = 400, H = 700; 
  const myBox = useRef({ x: 60, y: 650 });
  const myShield = useRef({ x: 60, y: 580 });
  const myShooter = useRef({ x: 130, y: 630, rot: 0 });
  const enemyBox = useRef({ x: 340, y: 50 });
  const enemyShield = useRef({ x: 340, y: 120 });
  const enemyShooter = useRef({ x: 270, y: 70, rot: 0 });

  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]);
  const flash = useRef(0);
  const grenadesArr = useRef([]);
  const explosions = useRef([]); 
  const screenShake = useRef(0);
  const activeTouches = useRef(new Map());
  const lastTap = useRef(0);
  const isCharging = useRef(false);
  const chargeProgress = useRef(0);

  const opp = role === 'host' ? 'guest' : 'host';

  // Memoized launch function to be used in handleTouch
  const launchGrenade = useCallback((holdTime) => {
    const range = holdTime * H * 0.8;
    const targetX = myShooter.current.x + Math.sin(myShooter.current.rot) * range;
    const targetY = myShooter.current.y - Math.cos(myShooter.current.rot) * range;
    const g = { x: myShooter.current.x, y: myShooter.current.y, tx: targetX, ty: targetY, t: 0 };
    grenadesArr.current.push(g);
    if (socket.current) {
      socket.current.emit("launch_grenade", { roomId, x: W - g.x, y: H - g.y, tx: W - g.tx, ty: H - g.ty });
    }
  }, [roomId, H, W]);

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

    socket.current.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    socket.current.on("incoming_grenade", (g) => grenadesArr.current.push(g));
    
    socket.current.on("update_game_state", (data) => {
      if (data.targetHit === 'box') {
        if (data.attackerRole === 'host') {
          setShowHealHost(true);
          setTimeout(() => setShowHealHost(false), 800);
        } else {
          setShowHealGuest(true);
          setTimeout(() => setShowHealGuest(false), 800);
        }
      }

      setHealth(data.health);
      setOverHealth(data.overHealth);
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      setGrenades(data.grenades);

      if (data.health.host <= 0 || data.health.guest <= 0) {
        const winnerRole = data.health.host <= 0 ? 'guest' : 'host';
        const winnerId = winnerRole === 'host' ? data.hostId : data.guestId;
        setFinalScore(data.health[winnerRole] + data.shieldHealth[winnerRole] + data.boxHealth[winnerRole]);
        setGameOver(socket.current.id === winnerId ? "win" : "lose");
      }
    });

    return () => {
      if (socket.current) socket.current.disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      if (isCharging.current) return;
      const vx = Math.sin(myShooter.current.rot) * 18;
      const vy = -Math.cos(myShooter.current.rot) * 18;
      const tipX = myShooter.current.x + Math.sin(myShooter.current.rot) * 30;
      const tipY = myShooter.current.y - Math.cos(myShooter.current.rot) * 30;
      myBullets.current.push({ x: tipX, y: tipY, vx, vy });
      flash.current = 5; 
      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy });
    }, 120); 
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId, W, H]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const now = Date.now();

    Array.from(e.changedTouches).forEach(t => {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);

      if (e.type === "touchstart") {
        let id = null;
        if (Math.hypot(tx - myShooter.current.x, ty - (myShooter.current.y + 50)) < 45) id = "wheel";
        else if (Math.hypot(tx - myShooter.current.x, ty - myShooter.current.y) < 45) {
          id = "shooter";
          if (now - lastTap.current < 300 && grenades[role] > 0) {
            isCharging.current = true;
            chargeProgress.current = 0;
          }
          lastTap.current = now;
        }
        else if (Math.hypot(tx - myShield.current.x, ty - (myShield.current.y + 15)) < 40) id = "shield";
        else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 45) id = "box";
        if (id) activeTouches.current.set(t.identifier, id);
      }

      if (e.type === "touchmove") {
        const draggingId = activeTouches.current.get(t.identifier);
        if (draggingId === "wheel") {
          myShooter.current.rot = Math.max(-1.22, Math.min(1.22, (tx - myShooter.current.x) / 45)); 
        } else if (draggingId && !isCharging.current) {
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
        const draggingId = activeTouches.current.get(t.identifier);
        if (draggingId === "shooter" && isCharging.current) {
          launchGrenade(chargeProgress.current);
          isCharging.current = false;
          chargeProgress.current = 0;
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
      if (screenShake.current > 0) {
          ctx.translate((Math.random()-0.5)*screenShake.current, (Math.random()-0.5)*screenShake.current);
          screenShake.current *= 0.9;
      }
      ctx.clearRect(0, 0, W, H);

      // Sparks and Explosions
      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.alpha -= 0.03;
        ctx.fillStyle = s.color; ctx.globalAlpha = Math.max(0, s.alpha);
        ctx.fillRect(s.x, s.y, 2, 2);
        if (s.alpha <= 0) sparks.current.splice(i, 1);
      });
      ctx.globalAlpha = 1;

      explosions.current.forEach((ex, i) => {
        ex.r += 6; ex.alpha -= 0.02;
        ctx.strokeStyle = `rgba(255, 140, 0, ${ex.alpha})`;
        ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI*2); ctx.stroke();
        if (ex.alpha <= 0) explosions.current.splice(i, 1);
      });

      const drawBar = (x, y, val, max, color) => {
        ctx.fillStyle = "#111"; ctx.fillRect(x - 20, y - 40, 40, 4);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y - 40, Math.max(0, (val/max)*40), 4);
      };

      // Boxes and Shields
      if (boxHealth[role] > 0) {
        ctx.fillStyle = "#00f2ff"; ctx.fillRect(myBox.current.x - 25, myBox.current.y - 25, 50, 50);
        drawBar(myBox.current.x, myBox.current.y, boxHealth[role], 300, "#00f2ff");
      }
      if (boxHealth[opp] > 0) {
        ctx.fillStyle = "#ff3e3e"; ctx.fillRect(enemyBox.current.x - 25, enemyBox.current.y - 25, 50, 50);
        drawBar(enemyBox.current.x, enemyBox.current.y, boxHealth[opp], 300, "#ff3e3e");
      }

      const drawShield = (pos, color, hp, isEnemy) => {
        if (hp <= 0) return;
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath();
        const s = isEnemy ? 0.25 : -0.75; const e = isEnemy ? 0.75 : -0.25;
        ctx.arc(pos.x, pos.y, 60, Math.PI * s, Math.PI * e); ctx.stroke();
        const barY = isEnemy ? pos.y + 45 : pos.y - 45;
        drawBar(pos.x, barY, hp, 350, "#00ff88");
      };
      drawShield(myShield.current, "#00f2ff", shieldHealth[role], false);
      drawShield(enemyShield.current, "#ff3e3e", shieldHealth[opp], true);

      // Projectiles
      grenadesArr.current.forEach((g, i) => {
        g.t += 0.03;
        const cx = g.x + (g.tx - g.x) * g.t;
        const cy = g.y + (g.ty - g.y) * g.t - 100 * Math.sin(Math.PI * g.t);
        ctx.fillStyle = "#ffaa00"; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI*2); ctx.fill();
        if (g.t >= 1) {
          explosions.current.push({ x: g.tx, y: g.ty, r: 0, alpha: 1 });
          screenShake.current = 15;
          socket.current.emit("grenade_burst", { roomId, x: g.tx, y: g.ty });
          grenadesArr.current.splice(i, 1);
        }
      });

      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        const dS = Math.hypot(b.x - enemyShield.current.x, b.y - enemyShield.current.y);
        const a = Math.atan2(b.y - enemyShield.current.y, b.x - enemyShield.current.x);
        if (shieldHealth[opp] > 0 && dS > 55 && dS < 75 && Math.abs(a - Math.PI/2) < 0.9) {
          socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: opp });
          myBullets.current.splice(i, 1);
        } else if (boxHealth[opp] > 0 && Math.abs(b.x - enemyBox.current.x) < 28 && Math.abs(b.y - enemyBox.current.y) < 28) {
          socket.current.emit("take_damage", { roomId, target: 'box', victimRole: opp });
          myBullets.current.splice(i, 1);
        } else if (Math.abs(b.x - enemyShooter.current.x) < 22 && Math.abs(b.y - enemyShooter.current.y) < 35) {
          socket.current.emit("take_damage", { roomId, target: 'player', victimRole: opp });
          myBullets.current.splice(i, 1);
        }
        if (b.y < -50 || b.y > H + 50) myBullets.current.splice(i, 1);
      });

      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        const dS = Math.hypot(b.x - myShield.current.x, b.y - myShield.current.y);
        const a = Math.atan2(b.y - myShield.current.y, b.x - myShield.current.x);
        if (shieldHealth[role] > 0 && dS > 55 && dS < 75 && Math.abs(a + Math.PI/2) < 0.9) {
          enemyBullets.current.splice(i, 1);
        }
        if (b.y < -50 || b.y > H + 50) enemyBullets.current.splice(i, 1);
      });

      // Shooter
      const drawShooter = (pos, color, isEnemy) => {
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(pos.rot || 0);
        ctx.fillStyle = color; ctx.beginPath();
        if (isEnemy) { ctx.moveTo(0, 30); ctx.lineTo(-15, -10); ctx.lineTo(15, -10); }
        else { 
          ctx.moveTo(0, -30); ctx.lineTo(-15, 10); ctx.lineTo(15, 10); 
          if (isCharging.current) {
            chargeProgress.current = Math.min(1, chargeProgress.current + 0.015);
            ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 3; ctx.beginPath();
            ctx.arc(0, 0, 45, -Math.PI/2, -Math.PI/2 + (chargeProgress.current * Math.PI * 2));
            ctx.stroke();
          }
        }
        ctx.fill(); ctx.restore();
      };
      drawShooter(myShooter.current, "#00f2ff", false);
      drawShooter(enemyShooter.current, "#ff3e3e", true);

      ctx.restore();
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, roomId, boxHealth, shieldHealth, opp, W, H]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">ENEMY [G: {grenades[opp]}]</span>
          <div className="mini-hp">
            <div className="fill red" style={{width: `${(health[opp]/650)*100}%`}}/>
            <div className="fill over-gold" style={{width: `${(overHealth[opp]/200)*100}%`}}/>
            <span className="hp-label">{health[opp]} HP</span>
            {showHealGuest && <div className="heal-popup">+5 HP</div>}
          </div>
        </div>
        <div className="stat-box">
          <span className="name">YOU [G: {grenades[role]}]</span>
          <div className="mini-hp">
            <div className="fill blue" style={{width: `${(health[role]/650)*100}%`}}/>
            <div className="fill over-gold" style={{width: `${(overHealth[role]/200)*100}%`}}/>
            <span className="hp-label">{health[role]} HP</span>
            {showHealHost && <div className="heal-popup">+5 HP</div>}
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && (
        <div className="overlay">
          <h1 className={gameOver}>{gameOver.toUpperCase()}</h1>
          <div className="score-summary">
            <p>Total HP: {finalScore}</p>
            {gameOver === 'win' && finalScore >= 1000 && <h2 className="grade">A+</h2>}
          </div>
          <button onClick={() => navigate("/second-page")}>EXIT</button>
        </div>
      )}
    </div>
  );
}