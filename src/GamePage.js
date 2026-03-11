import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com"; 
const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

export default function GamePage() {
  const { roomId } = useParams();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  
  const [role, setRole] = useState(null); 
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [bonusHp, setBonusHp] = useState({ host: 0, guest: 0 });
  const [boxHealth, setBoxHealth] = useState({ host: 200, guest: 200 });
  const [shieldHealth, setShieldHealth] = useState({ host: 150, guest: 150 });
  const [grenades, setGrenades] = useState({ host: 2, guest: 2 });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(3);
  
  const [isCharging, setIsCharging] = useState(false);
  const [chargeProgress, setChargeProgress] = useState(0);
  const lastTap = useRef(0);
  const chargeTimer = useRef(null);

  const W = 400, H = 700;
  const myPos = useRef({ x: 320, y: 620 });
  const myBoxPos = useRef({ x: 340, y: 550 });
  const myShieldPos = useRef({ x: 300, y: 500 });
  const myRot = useRef(0); 
  const activeTouches = useRef({}); 

  const enemyPos = useRef({ x: 80, y: 80 });
  const enemyRot = useRef(0);
  const enemyTarget = useRef({ x: 80, y: 80, rot: 0, boxX: 60, boxY: 150, sX: 100, sY: 200 }); 
  
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const activeGrenades = useRef([]); 
  const muzzleFlashes = useRef([]); 

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "rooms", roomId), () => {});

    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current.emit("join_game", { roomId });
    
    socket.current.on("assign_role", (data) => { 
      setRole(data.role); 
      socket.current.role = data.role; 
    });

    socket.current.on("opp_move", (d) => { enemyTarget.current = d; });
    socket.current.on("incoming_bullet", (b) => { enemyBullets.current.push(b); });
    socket.current.on("incoming_grenade", (g) => { activeGrenades.current.push(g); });
    
    socket.current.on("update_game_state", (data) => {
      setHealth(data.health);
      setBonusHp(data.bonusHp);
      setBoxHealth(data.boxHealth);
      setShieldHealth(data.shieldHealth);
      setGrenades(data.grenades);
      
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const lost = socket.current.role === 'host' ? data.health.host <= 0 : data.health.guest <= 0;
        setGameOver(lost ? "lose" : "win");
      }
    });

    return () => { unsub(); socket.current.disconnect(); };
  }, [roomId]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const angle = myRot.current;
      const vx = Math.sin(angle) * 16;
      const vy = -Math.cos(angle) * 16;
      const tipX = myPos.current.x + Math.sin(angle) * 40;
      const tipY = myPos.current.y - Math.cos(angle) * 40;
      
      const b = { x: tipX, y: tipY, vx, vy };
      muzzleFlashes.current.push({ x: tipX, y: tipY, life: 1.0 });
      socket.current.emit("fire", { roomId, x: W - b.x, y: H - b.y, vx: -vx, vy: -vy });
      myBullets.current.push(b);
    }, 180); 
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId]);

  const launchGrenade = useCallback(() => {
    const angle = myRot.current;
    const range = (H / 2) * 0.55;
    const tx = myPos.current.x + Math.sin(angle) * range;
    const ty = myPos.current.y - Math.cos(angle) * range;
    const grenade = { x: myPos.current.x, y: myPos.current.y, tx, ty, progress: 0, exploded: false, life: 1.0, owner: role };
    activeGrenades.current.push(grenade);
    socket.current.emit("launch_grenade", { roomId, x: W - grenade.x, y: H - grenade.y, tx: W - tx, ty: H - ty });
  }, [role, roomId, H]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    for (let t of e.changedTouches) {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);
      
      if (e.type === "touchstart") {
        const distToShooter = Math.hypot(tx - myPos.current.x, ty - myPos.current.y);
        if (distToShooter < 45) {
          const now = Date.now();
          if (now - lastTap.current < 300 && grenades[role] > 0) {
            setIsCharging(true);
            let prog = 0;
            chargeTimer.current = setInterval(() => {
              prog += 0.05;
              setChargeProgress(prog);
              if (prog >= 1) {
                clearInterval(chargeTimer.current);
                setIsCharging(false);
                setChargeProgress(0);
                launchGrenade();
              }
            }, 100);
          }
          lastTap.current = now;
          activeTouches.current[t.identifier] = 'dragging';
        } 
        else if (Math.hypot(tx - myPos.current.x, ty - (myPos.current.y + 55)) < 45) activeTouches.current[t.identifier] = 'steering';
        else if (boxHealth[role] > 0 && Math.hypot(tx - myBoxPos.current.x, ty - myBoxPos.current.y) < 35) activeTouches.current[t.identifier] = 'box';
        else if (shieldHealth[role] > 0 && Math.hypot(tx - myShieldPos.current.x, ty - myShieldPos.current.y) < 45) activeTouches.current[t.identifier] = 'shield';
      }
      
      if (e.type === "touchmove") {
        const type = activeTouches.current[t.identifier];
        if (!type) continue;
        const minY = H / 2 + 30, maxY = H - 30;
        if (type === 'steering') myRot.current = Math.max(-1.3, Math.min(1.3, (tx - myPos.current.x) * 0.05));
        else if (type === 'dragging') { myPos.current.x = Math.max(25, Math.min(W - 25, tx)); myPos.current.y = Math.max(minY, Math.min(maxY, ty)); }
        else if (type === 'box') { myBoxPos.current.x = Math.max(25, Math.min(W - 25, tx)); myBoxPos.current.y = Math.max(minY, Math.min(maxY, ty)); }
        else if (type === 'shield') { myShieldPos.current.x = Math.max(55, Math.min(W - 55, tx)); myShieldPos.current.y = Math.max(minY, Math.min(maxY, ty)); }
        socket.current.emit("move", { roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myRot.current, boxX: W - myBoxPos.current.x, boxY: H - myBoxPos.current.y, sX: W - myShieldPos.current.x, sY: H - myShieldPos.current.y });
      }

      if (e.type === "touchend") {
        if (activeTouches.current[t.identifier] === 'dragging') {
          clearInterval(chargeTimer.current);
          setIsCharging(false);
          setChargeProgress(0);
        }
        delete activeTouches.current[t.identifier];
      }
    }
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      enemyPos.current.x = lerp(enemyPos.current.x, enemyTarget.current.x, 0.35);
      enemyPos.current.y = lerp(enemyPos.current.y, enemyTarget.current.y, 0.35);
      enemyRot.current = lerp(enemyRot.current, enemyTarget.current.rot, 0.35);

      muzzleFlashes.current.forEach((f, i) => {
        ctx.beginPath(); ctx.fillStyle = `rgba(255, 255, 0, ${f.life * 0.5})`;
        ctx.arc(f.x, f.y, 20 * (1.2 - f.life), 0, Math.PI * 2); ctx.fill();
        f.life -= 0.15; if (f.life <= 0) muzzleFlashes.current.splice(i, 1);
      });

      const drawPlayer = (x, y, r, c, isE) => {
        ctx.save(); ctx.translate(x, y);
        if (!isE) {
           ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.beginPath(); ctx.arc(0, 55, 22, 0, Math.PI * 2); ctx.fill();
           ctx.fillStyle = c; ctx.beginPath(); ctx.arc((r/1.3)*18, 55, 8, 0, Math.PI * 2); ctx.fill();
           if(isCharging) {
             ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
             ctx.beginPath(); ctx.arc(0, -45, 25 * chargeProgress, 0, Math.PI * 2); ctx.stroke();
           }
        }
        ctx.rotate(r); ctx.fillStyle = c; ctx.beginPath();
        if (isE) { ctx.moveTo(0, 40); ctx.lineTo(-15, -15); ctx.lineTo(15, -15); } 
        else { ctx.moveTo(0, -40); ctx.lineTo(-15, 15); ctx.lineTo(15, 15); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      };
      drawPlayer(myPos.current.x, myPos.current.y, myRot.current, "#00f2ff", false);
      drawPlayer(enemyPos.current.x, enemyPos.current.y, enemyRot.current, "#ff3e3e", true);

      activeGrenades.current.forEach((g, i) => {
        if (!g.exploded) {
          g.progress += 0.03;
          const curX = lerp(g.x, g.tx, g.progress);
          const curY = lerp(g.y, g.ty, g.progress);
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(curX, curY, 6, 0, Math.PI * 2); ctx.fill();
          if (g.progress >= 1) { 
            g.exploded = true; g.exX = g.tx; g.exY = g.ty;
            if (g.owner === role) socket.current.emit("grenade_explosion", { roomId, x: g.exX, y: g.exY });
          }
        } else {
          ctx.beginPath(); ctx.fillStyle = `rgba(255, 100, 0, ${g.life})`;
          ctx.arc(g.exX, g.exY, 90 * (1 - g.life + 0.1), 0, Math.PI * 2); ctx.fill();
          g.life -= 0.04; if (g.life <= 0) activeGrenades.current.splice(i, 1);
        }
      });

      [myBullets, enemyBullets].forEach(ref => {
        ref.current.forEach((b, i) => {
          b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = ref === myBullets ? "#fffb00" : "#ff3e3e";
          ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
          if (b.y < -50 || b.y > H + 50) ref.current.splice(i, 1);
        });
      });

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, roomId, isCharging, chargeProgress, H]);

  const h_me = health[role], b_me = bonusHp[role];
  const h_opp = health[role === 'host' ? 'guest' : 'host'], b_opp = bonusHp[role === 'host' ? 'guest' : 'host'];

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">OPPONENT</span>
          <div className="mini-hp">
            <div className="fill red" style={{ width: `${(h_opp / 400) * 100}%` }} />
            <div className="fill bonus" style={{ width: `${(b_opp / 400) * 100}%` }} />
          </div>
        </div>
        <div className="grenade-indicator">G: {grenades[role]}</div>
        <div className="stat-box">
          <span className="name">YOU</span>
          <div className="mini-hp">
            <div className="fill blue" style={{ width: `${(h_me / 400) * 100}%` }} />
            <div className="fill bonus" style={{ width: `${(b_me / 400) * 100}%` }} />
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><h1 className="count">{countdown}</h1></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => window.location.reload()}>RETRY</button></div>}
    </div>
  );
}