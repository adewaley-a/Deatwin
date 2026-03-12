import React, { useEffect, useRef, useState } from "react";
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
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [overHealth, setOverHealth] = useState({ host: 0, guest: 0 });
  const [grenades, setGrenades] = useState({ host: 2, guest: 2 });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [isCharging, setIsCharging] = useState(false);
  const [muzzle, setMuzzle] = useState(false);

  const W = 400, H = 700;
  const myPos = useRef({ x: 200, y: 600 });
  const myRot = useRef(0);
  const enemyPos = useRef({ x: 200, y: 100, rot: 0 });
  
  const lastTap = useRef(0);
  const grenadeTimer = useRef(null);
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const activeGrenades = useRef([]);
  const activeExplosions = useRef([]);

  useEffect(() => {
    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current.emit("join_game", { roomId });
    socket.current.on("assign_role", (data) => setRole(data.role));
    socket.current.on("start_countdown", () => setCountdown(3));
    socket.current.on("opp_move", (d) => {
        enemyPos.current = d;
    });
    socket.current.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    socket.current.on("incoming_grenade", (g) => activeGrenades.current.push(g));
    
    socket.current.on("update_game_state", (data) => {
      setHealth(data.health);
      setOverHealth(data.overHealth);
      setGrenades(data.grenades);
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const iWon = socket.current.role === 'host' ? data.health.guest <= 0 : data.health.host <= 0;
        setGameOver(iWon ? "win" : "lose");
      }
    });

    return () => socket.current.disconnect();
  }, [roomId]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Shooting loop
  useEffect(() => {
    if (countdown > 0 || gameOver || !role || isCharging) return;
    const fireInt = setInterval(() => {
      const tipX = myPos.current.x + Math.sin(myRot.current) * 40;
      const tipY = myPos.current.y - Math.cos(myRot.current) * 40;
      const vx = Math.sin(myRot.current) * 18;
      const vy = -Math.cos(myRot.current) * 18;
      myBullets.current.push({ x: tipX, y: tipY, vx, vy });
      setMuzzle(true);
      setTimeout(() => setMuzzle(false), 50);
      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy });
    }, 160); 
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, isCharging, roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.changedTouches[0];
    const tx = (t.clientX - rect.left) * (W / rect.width);
    const ty = (t.clientY - rect.top) * (H / rect.height);

    if (e.type === "touchstart") {
      const now = Date.now();
      if ((now - lastTap.current) < 300 && grenades[role] > 0) {
        setIsCharging(true);
        grenadeTimer.current = setTimeout(launchGrenade, 2000);
      }
      lastTap.current = now;
    }

    if (e.type === "touchmove") {
      myPos.current.x = tx;
      myPos.current.y = ty;
      socket.current.emit("move", { roomId, x: W-tx, y: H-ty, rot: -myRot.current });
    }

    if (e.type === "touchend") {
      clearTimeout(grenadeTimer.current);
      setIsCharging(false);
    }
  };

  const launchGrenade = () => {
    setIsCharging(false);
    const g = {
      x: myPos.current.x, y: myPos.current.y,
      tx: myPos.current.x + Math.sin(myRot.current) * 250,
      ty: myPos.current.y - Math.cos(myRot.current) * 250,
      progress: 0, role, id: Math.random()
    };
    activeGrenades.current.push(g);
    socket.current.emit("launch_grenade", { ...g, roomId, x: W-g.x, y: H-g.y, tx: W-g.tx, ty: H-g.ty });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      // Bullets & Treasure Box Logic
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff";
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        
        // Hitting opponent's treasure box area
        if (b.y < 120 && b.x > 150 && b.x < 250) {
          socket.current.emit("take_damage", { roomId, target: 'box', victimRole: role === 'host' ? 'guest' : 'host' });
          myBullets.current.splice(i, 1);
        }
        if (b.y < -10 || b.y > H + 10) myBullets.current.splice(i, 1);
      });

      // Enemy Bullets & Arc Collision
      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e";
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();

        // Pixel Perfect Shield Arc Check
        const dist = Math.hypot(b.x - myPos.current.x, b.y - myPos.current.y);
        const angle = Math.atan2(b.y - myPos.current.y, b.x - myPos.current.x);
        // Only hits if within 60-70px radius and within front 90-degree arc
        if (dist > 60 && dist < 75 && Math.abs(angle + Math.PI/2) < 0.8) {
            socket.current.emit("take_damage", { roomId, target: 'shield', victimRole: role });
            enemyBullets.current.splice(i, 1);
        }
      });

      // Grenades
      activeGrenades.current.forEach((g, i) => {
        g.progress += 0.025;
        const curX = g.x + (g.tx - g.x) * g.progress;
        const curY = g.y + (g.ty - g.y) * g.progress;
        ctx.fillStyle = "#ffeb3b";
        ctx.beginPath(); ctx.arc(curX, curY, 8, 0, Math.PI*2); ctx.fill();
        if (g.progress >= 1) {
          activeExplosions.current.push({ x: g.tx, y: g.ty, r: 0, alpha: 1 });
          // Damage calculation (distance-based)
          const distToEnemy = Math.hypot(g.tx - enemyPos.current.x, g.ty - enemyPos.current.y);
          if (distToEnemy < 100) {
            const dmg = Math.floor(70 * (1 - distToEnemy/100));
            socket.current.emit("take_damage", { roomId, target: 'player', victimRole: role === 'host' ? 'guest' : 'host', amount: dmg });
          }
          activeGrenades.current.splice(i, 1);
        }
      });

      // Explosions
      activeExplosions.current.forEach((ex, i) => {
        ex.r += 4; ex.alpha -= 0.02;
        ctx.strokeStyle = `rgba(255, 165, 0, ${ex.alpha})`;
        ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI*2); ctx.stroke();
        if (ex.alpha <= 0) activeExplosions.current.splice(i, 1);
      });

      // Draw Arc Shield
      ctx.strokeStyle = "#00f2ff"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(myPos.current.x, myPos.current.y, 65, -Math.PI*0.75, -Math.PI*0.25); ctx.stroke();

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, muzzle, roomId]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        <div className="stat-box">
          <span className="name">ENEMY</span>
          <div className="mini-hp"><div className="fill red" style={{width: `${(health[role==='host'?'guest':'host']/400)*100}%`}}/></div>
        </div>
        <div className="stat-box">
          <span className="name">YOU</span>
          <div className="mini-hp">
            <div className="fill blue" style={{width: `${(health[role]/400)*100}%`}}/>
            <div className="fill shield" style={{width: `${(overHealth[role]/200)*100}%`}}/>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {isCharging && <div className="charge-bar" />}
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && <div className="overlay"><h1 className={gameOver}>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}