import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com";
const W = 400, H = 700;
const TICK_RATE = 1000 / 30; 

const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  const audioCtx = useRef(null);
  const lastEmit = useRef(0);

  const [role, setRole] = useState(null);
  const [gameState, setGameState] = useState({
    health: { host: 650, guest: 650 }, overHealth: { host: 0, guest: 0 },
    boxHealth: { host: 300, guest: 300 }, shieldHealth: { host: 350, guest: 350 },
    grenades: { host: 2, guest: 2 }
  });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [lifestealPopups, setLifestealPopups] = useState([]);
  const [muzzleFlash, setMuzzleFlash] = useState(false);

  const screenShake = useRef(0);
  const myObj = useRef({
    shooter: { x: 200, y: 630, rot: 0 },
    shield: { x: 200, y: 560 },
    box: { x: 200, y: 670 }
  });
  const enemyTarget = useRef({
    shooter: { x: 200, y: 70, rot: 0 },
    shield: { x: 200, y: 140 },
    box: { x: 200, y: 30 }
  });
  const enemyVis = useRef({
    shooter: { x: 200, y: 70, rot: 0 },
    shield: { x: 200, y: 140 },
    box: { x: 200, y: 30 }
  });

  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const sparks = useRef([]);
  const activeGrenades = useRef([]);
  const activeTouches = useRef(new Map());
  const isCooking = useRef(false);
  const cookPower = useRef(0);

  const opp = role === 'host' ? 'guest' : 'host';

  const syncPosition = useCallback(() => {
    const now = Date.now();
    if (now - lastEmit.current < TICK_RATE) return;
    lastEmit.current = now;
    socket.current.emit("move_all", {
      roomId,
      shooter: { x: W - myObj.current.shooter.x, y: H - myObj.current.shooter.y, rot: -myObj.current.shooter.rot },
      shield: { x: W - myObj.current.shield.x, y: H - myObj.current.shield.y },
      box: { x: W - myObj.current.box.x, y: H - myObj.current.box.y }
    });
  }, [roomId]);

  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current = s;
    s.emit("join_game", { roomId });
    s.on("assign_role", (d) => setRole(d.role));
    s.on("start_countdown", () => setCountdown(3));
    s.on("opp_move_all", (d) => { enemyTarget.current = d; });
    s.on("incoming_bullet", (b) => { enemyBullets.current.push(b); setMuzzleFlash(true); setTimeout(() => setMuzzleFlash(false), 50); });
    
    s.on("update_game_state", (data) => {
      setGameState(data);
      if (data.lastHit?.target === 'box') {
        const id = Math.random();
        setLifestealPopups(p => [...p, { id, attacker: data.lastHit.attackerRole }]);
        setTimeout(() => setLifestealPopups(p => p.filter(x => x.id !== id)), 800);
      }
      if (data.health.host <= 0 || data.health.guest <= 0) {
        setGameOver(data.health[role] <= 0 ? "lose" : "win");
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
    const fireInt = setInterval(() => {
      if (isCooking.current) return;
      const { x, y, rot } = myObj.current.shooter;
      const vx = Math.sin(rot) * 18, vy = -Math.cos(rot) * 18;
      const bId = Math.random().toString(36).substr(2, 9);
      myBullets.current.push({ x, y, vx, vy, id: bId });
      socket.current.emit("fire", { roomId, x: W - x, y: H - y, vx: -vx, vy: -vy, id: bId });
      setMuzzleFlash(true); setTimeout(() => setMuzzleFlash(false), 50);
    }, 180);
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
        if (Math.hypot(tx - myObj.current.shooter.x, ty - myObj.current.shooter.y) < 60) id = "shooter";
        else if (Math.hypot(tx - myObj.current.shield.x, ty - myObj.current.shield.y) < 60) id = "shield";
        else if (Math.hypot(tx - myObj.current.box.x, ty - myObj.current.box.y) < 60) id = "box";
        if (id) activeTouches.current.set(t.identifier, id);
      }
      if (e.type === "touchmove") {
        const dId = activeTouches.current.get(t.identifier);
        if (dId) {
          if (dId === "shooter") myObj.current.shooter.rot = Math.max(-1.2, Math.min(1.2, (tx - myObj.current.shooter.x) / 40));
          else { 
            myObj.current[dId].x = Math.max(30, Math.min(W - 30, tx));
            myObj.current[dId].y = Math.max(H/2 + 50, Math.min(H - 40, ty));
          }
          syncPosition();
        }
      }
      if (e.type === "touchend") activeTouches.current.delete(t.identifier);
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

      // Smooth Enemy Interpolation
      ["shooter", "shield", "box"].forEach(k => {
        enemyVis.current[k].x = lerp(enemyVis.current[k].x, enemyTarget.current[k].x, 0.2);
        enemyVis.current[k].y = lerp(enemyVis.current[k].y, enemyTarget.current[k].y, 0.2);
        if (k === "shooter") enemyVis.current.shooter.rot = lerp(enemyVis.current.shooter.rot, enemyTarget.current.shooter.rot, 0.2);
      });

      // Bullets & Collision
      [myBullets.current, enemyBullets.current].forEach((list, isEnemy) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const b = list[i]; b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = isEnemy ? "#ff3e3e" : "#00f2ff";
          ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();

          if (!isEnemy) {
            const hitShield = gameState.shieldHealth[opp] > 0 && Math.hypot(b.x - enemyVis.current.shield.x, b.y - enemyVis.current.shield.y) < 60;
            const hitBox = gameState.boxHealth[opp] > 0 && Math.abs(b.x - enemyVis.current.box.x) < 25 && Math.abs(b.y - enemyVis.current.box.y) < 25;
            const hitPlayer = Math.hypot(b.x - enemyVis.current.shooter.x, b.y - enemyVis.current.shooter.y) < 30;

            if (hitShield || hitBox || hitPlayer) {
              const target = hitShield ? 'shield' : hitBox ? 'box' : 'player';
              socket.current.emit("take_damage", { roomId, target, victimRole: opp, damageType: 'bullet', bulletId: b.id });
              list.splice(i, 1);
            }
          }
          if (b.y < -50 || b.y > H+50) list.splice(i, 1);
        }
      });

      // Rendering Objects
      const drawPlayer = (obj, color, isE, flash) => {
        ctx.save(); ctx.translate(obj.shooter.x, obj.shooter.y); ctx.rotate(obj.shooter.rot);
        ctx.fillStyle = flash ? "#fff" : color; ctx.beginPath();
        if(isE) { ctx.moveTo(0,30); ctx.lineTo(-15,-10); ctx.lineTo(15,-10); }
        else { ctx.moveTo(0,-30); ctx.lineTo(-15,10); ctx.lineTo(15,10); }
        ctx.fill(); ctx.restore();
        
        if (gameState.shieldHealth[isE ? opp : role] > 0) {
          ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath();
          ctx.arc(obj.shield.x, obj.shield.y, 60, isE ? 0 : Math.PI, isE ? Math.PI : Math.PI*2); ctx.stroke();
        }
        ctx.fillStyle = color; ctx.globalAlpha = 0.8;
        ctx.fillRect(obj.box.x-20, obj.box.y-20, 40, 40); ctx.globalAlpha = 1;
      };

      drawPlayer(myObj.current, "#00f2ff", false, muzzleFlash);
      drawPlayer(enemyVis.current, "#ff3e3e", true, false);

      ctx.restore();
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, gameState, opp, roomId, muzzleFlash]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <StatBox label="ENEMY" hp={gameState.health[opp]} ohp={gameState.overHealth[opp]} color="red" popups={lifestealPopups} role={opp} />
        <StatBox label="YOU" hp={gameState.health[role]} ohp={gameState.overHealth[role]} color="blue" popups={lifestealPopups} role={role} />
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && <div className={`overlay ${gameOver}`}><h1>{gameOver === "win" ? "VICTORY" : "DEFEAT"}</h1><button className="exit-btn" onClick={() => navigate("/")}>REPLAY</button></div>}
    </div>
  );
}

function StatBox({ label, hp, ohp, color, popups, role }) {
  return (
    <div className="stat-box">
      <span className="label">{label}</span>
      <div className="mini-hp">
        <div className={`fill ${color}`} style={{width: `${(hp/650)*100}%`}}/>
        <div className="fill over-gold" style={{width: `${(ohp/300)*100}%`}}/>
        <span className="hp-num">{Math.floor(hp + ohp)}</span>
      </div>
      {popups.some(p => p.attacker === role) && <span className={`lifesteal-text ${label === 'YOU' ? 'player' : 'enemy'}`}>+5</span>}
    </div>
  );
}