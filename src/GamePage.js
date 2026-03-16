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

  const activeTouches = useRef(new Map());
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]);
  const flash = useRef(0);
  
  const chargeProgress = useRef(0);
  const lastTap = useRef(0);
  const isCharging = useRef(false);
  const grenadesArr = useRef([]);
  const explosions = useRef([]);
  const screenShake = useRef(0);

  const opp = role === 'host' ? 'guest' : 'host';

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

    socket.current.on("incoming_bullet", (b) => {
        // Correcting incoming bullet vector for mirrored screen
        enemyBullets.current.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy });
    });
    
    socket.current.on("incoming_grenade", (g) => grenadesArr.current.push(g));
    
    socket.current.on("update_game_state", (data) => {
      if (data.targetHit === 'box') {
        if (data.attackerRole === 'host') {
          setShowHealHost(true);
          setTimeout(() => setShowHealHost(false), 800);
        } else if (data.attackerRole === 'guest') {
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
        const total = data.health[winnerRole] + data.shieldHealth[winnerRole] + data.boxHealth[winnerRole];
        setFinalScore(total);
        setGameOver(role === winnerRole ? "win" : "lose");
      }
    });

    return () => socket.current.disconnect();
  }, [roomId, role]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const launchGrenade = useCallback((holdTime) => {
    const maxRange = H * 0.8; 
    const range = holdTime * maxRange;
    const targetX = myShooter.current.x + Math.sin(myShooter.current.rot) * range;
    const targetY = myShooter.current.y - Math.cos(myShooter.current.rot) * range;
    const g = { x: myShooter.current.x, y: myShooter.current.y, tx: targetX, ty: targetY, t: 0 };
    grenadesArr.current.push(g);
    socket.current.emit("launch_grenade", { roomId, x: W - g.x, y: H - g.y, tx: W - g.tx, ty: H - g.ty });
    isCharging.current = false;
    chargeProgress.current = 0;
  }, [roomId, H, W]);

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
        else if (Math.hypot(tx - myShield.current.x, ty - (myShield.current.y + 15)) < 40 && shieldHealth[role] > 0) id = "shield";
        else if (Math.hypot(tx - myBox.current.x, ty - myBox.current.y) < 45 && boxHealth[role] > 0) id = "box";
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
        if (activeTouches.current.get(t.identifier) === "shooter" && isCharging.current) launchGrenade(chargeProgress.current);
        activeTouches.current.delete(t.identifier);
        isCharging.current = false;
        chargeProgress.current = 0;
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

      // Middle line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
      ctx.setLineDash([]);

      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.alpha -= 0.03;
        ctx.fillStyle = s.color; ctx.globalAlpha = Math.max(0, s.alpha);
        ctx.fillRect(s.x, s.y, 2, 2);
        if (s.alpha <= 0) sparks.current.splice(i, 1);
      });
      ctx.globalAlpha = 1;

      const drawMiniBar = (x, y, val, max, color) => {
        ctx.fillStyle = "#111"; ctx.fillRect(x - 20, y - 40, 40, 4);
        ctx.fillStyle = color; ctx.fillRect(x - 20, y - 40, Math.max(0, (val/max)*40), 4);
      };

      if (boxHealth[role] > 0) {
          ctx.fillStyle = "#00f2ff"; ctx.fillRect(myBox.current.x - 25, myBox.current.y - 25, 50, 50);
          drawMiniBar(myBox.current.x, myBox.current.y, boxHealth[role], 300, "#00f2ff");
      }
      if (boxHealth[opp] > 0) {
          ctx.fillStyle = "#ff3e3e"; ctx.fillRect(enemyBox.current.x - 25, enemyBox.current.y - 25, 50, 50);
          drawMiniBar(enemyBox.current.x, enemyBox.current.y, boxHealth[opp], 300, "#ff3e3e");
      }

      const drawShield = (pos, color, hp, isEnemy) => {
        if (hp <= 0) return;
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath();
        const s = isEnemy ? 0.25 : -0.75; const e = isEnemy ? 0.75 : -0.25;
        ctx.arc(pos.x, pos.y, 60, Math.PI * s, Math.PI * e); ctx.stroke();
        
        // Shield HP Bar (Visible underneath)
        drawMiniBar(pos.x, pos.y + (isEnemy ? 10 : 30), hp, 350, "#00ff88");

        if (!isEnemy) {
          ctx.fillStyle = "rgba(0, 242, 255, 0.2)";
          ctx.beginPath(); ctx.arc(pos.x, pos.y + 15, 25, 0, Math.PI*2); ctx.fill();
        }
      };
      drawShield(myShield.current, "#00f2ff", shieldHealth[role], false);
      drawShield(enemyShield.current, "#ff3e3e", shieldHealth[opp], true);

      // Bullet Collision for My Bullets (Going up)
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        
        const dS = Math.hypot(b.x - enemyShield.current.x, b.y - enemyShield.current.y);
        const a = Math.atan2(b.y - enemyShield.current.y, b.x - enemyShield.current.x);
        
        if (shieldHealth[opp] > 0 && dS > 55 && dS < 75 && Math.abs(a - Math.PI/2) < 0.9) {
            sparks.current.push({ x: b.x, y: b.y, vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10, alpha: 1, color: "#fff" });
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

      // Collision for Enemy Bullets (Going down - fixing "Passing through")
      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();

        const dS = Math.hypot(b.x - myShield.current.x, b.y - myShield.current.y);
        const a = Math.atan2(b.y - myShield.current.y, b.x - myShield.current.x);

        // Blocking enemy bullets on my screen too
        if (shieldHealth[role] > 0 && dS > 55 && dS < 75 && Math.abs(a + Math.PI/2) < 0.9) {
            sparks.current.push({ x: b.x, y: b.y, vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10, alpha: 1, color: "#fff" });
            enemyBullets.current.splice(i, 1);
        } else if (Math.abs(b.x - myShooter.current.x) < 22 && Math.abs(b.y - myShooter.current.y) < 35) {
            enemyBullets.current.splice(i, 1);
        }

        if (b.y < -50 || b.y > H + 50) enemyBullets.current.splice(i, 1);
      });

      grenadesArr.current.forEach((g, i) => {
        g.t += 0.035;
        const cx = g.x + (g.tx - g.x) * g.t;
        const cy = g.y + (g.ty - g.y) * g.t - 80 * Math.sin(Math.PI * g.t);
        ctx.fillStyle = "#ffaa00"; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI*2); ctx.fill();
        if (g.t >= 1) {
            explosions.current.push({ x: g.tx, y: g.ty, r: 0, alpha: 1 });
            screenShake.current = 25;
            if (role) socket.current.emit("grenade_burst", { roomId, x: g.tx, y: g.ty });
            grenadesArr.current.splice(i, 1);
        }
      });

      explosions.current.forEach((ex, i) => {
        ex.r += 8; ex.alpha -= 0.02;
        ctx.strokeStyle = `rgba(255, 100, 0, ${ex.alpha})`;
        ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI*2); ctx.stroke();
        if (ex.alpha <= 0) explosions.current.splice(i, 1);
      });

      const drawShooter = (pos, color, isEnemy) => {
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(pos.rot || 0);
        ctx.fillStyle = color; ctx.beginPath();
        if (isEnemy) { 
            // Corrected facing direction for enemy
            ctx.moveTo(0, 30); ctx.lineTo(-15, -10); ctx.lineTo(15, -10); 
        }
        else { 
            ctx.moveTo(0, -30); ctx.lineTo(-15, 10); ctx.lineTo(15, 10); 
            if (flash.current > 0) {
                ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -35, flash.current * 3, 0, Math.PI*2); ctx.fill();
                flash.current--;
            }
            if (isCharging.current) {
                chargeProgress.current = Math.min(1, chargeProgress.current + 1/90);
                ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 4; ctx.beginPath();
                ctx.arc(0, 0, 50, -Math.PI/2, -Math.PI/2 + (chargeProgress.current * Math.PI * 2));
                ctx.stroke();
            }
        }
        ctx.fill(); ctx.restore();
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pos.x, pos.y + (isEnemy ? -50 : 50), 20, 0, Math.PI*2); ctx.stroke();
      };
      drawShooter(myShooter.current, "#00f2ff", false);
      drawShooter(enemyShooter.current, "#ff3e3e", true);

      ctx.restore();
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, roomId, boxHealth, shieldHealth, opp, launchGrenade, W, H]);

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