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
    health: { host: 650, guest: 650 },
    boxHealth: { host: 300, guest: 300 },
    shieldHealth: { host: 350, guest: 350 }
  });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);

  const myObj = useRef({
    shooter: { x: 100, y: 640, rot: 0 },
    shield: { x: 200, y: 560 },
    box: { x: 300, y: 660 }
  });

  const enemyTarget = useRef({
    shooter: { x: 300, y: 60, rot: 0 },
    shield: { x: 200, y: 140 },
    box: { x: 100, y: 40 }
  });

  const enemyVis = useRef({
    shooter: { x: 300, y: 60, rot: 0 },
    shield: { x: 200, y: 140 },
    box: { x: 100, y: 40 }
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
    
    if (type === 'hit') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, audioCtx.current.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, audioCtx.current.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, audioCtx.current.currentTime);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.05, audioCtx.current.currentTime);
    }
    
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    osc.connect(gain); gain.connect(audioCtx.current.destination);
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.1);
  }, []);

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
    s.on("assign_role", (d) => {
      setRole(d.role);
      if (d.role === 'guest') {
        myObj.current.shooter.x = 300;
        myObj.current.box.x = 100;
      }
    });
    s.on("start_countdown", () => setCountdown(3));
    s.on("opp_move_all", (d) => { enemyTarget.current = d; });
    s.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    s.on("update_game_state", (data) => {
      setGameState(data);
      if (data.lastHit) playSound('hit');
      if (data.health.host <= 0 || data.health.guest <= 0) {
        setGameOver(data.health[role] <= 0 ? "lose" : "win");
        socket.current.disconnect();
      }
    });
    return () => s.disconnect();
  }, [roomId, role, playSound]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const { x, y, rot } = myObj.current.shooter;
      // Calculate Tip of Shooter
      const tipX = x + Math.sin(rot) * 25;
      const tipY = y - Math.cos(rot) * 25;
      const vx = Math.sin(rot) * 15, vy = -Math.cos(rot) * 15;
      const bId = Math.random().toString(36).substr(2, 9);
      
      myBullets.current.push({ x: tipX, y: tipY, vx, vy, id: bId });
      socket.current.emit("fire", { roomId, x: W - tipX, y: H - tipY, vx: -vx, vy: -vy, id: bId });
      playSound('fire');
    }, 200);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role, roomId, playSound]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    Array.from(e.changedTouches).forEach(t => {
      const tx = (t.clientX - rect.left) * (W / rect.width);
      const ty = (t.clientY - rect.top) * (H / rect.height);

      if (e.type === "touchstart") {
        let id = null;
        if (Math.hypot(tx - myObj.current.shooter.x, ty - (myObj.current.shooter.y + 45)) < 40) id = "wheel";
        else if (Math.hypot(tx - myObj.current.shooter.x, ty - myObj.current.shooter.y) < 40) id = "shooter";
        else if (Math.hypot(tx - myObj.current.shield.x, ty - myObj.current.shield.y) < 50) id = "shield";
        else if (Math.hypot(tx - myObj.current.box.x, ty - myObj.current.box.y) < 50) id = "box";
        if (id) activeTouches.current.set(t.identifier, id);
      }
      if (e.type === "touchmove") {
        const dId = activeTouches.current.get(t.identifier);
        if (dId === "wheel") {
          myObj.current.shooter.rot = Math.max(-1.1, Math.min(1.1, (tx - myObj.current.shooter.x) / 30));
        } else if (dId) {
          myObj.current[dId].x = tx;
          myObj.current[dId].y = Math.max(H/2 + 20, ty); // Keep in bottom half
        }
        syncPosition();
      }
      if (e.type === "touchend") activeTouches.current.delete(t.identifier);
    });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      // Demarcation Line
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
      ctx.setLineDash([]);

      // Interpolate Enemy
      ["shooter", "shield", "box"].forEach(k => {
        enemyVis.current[k].x = lerp(enemyVis.current[k].x, enemyTarget.current[k].x, 0.2);
        enemyVis.current[k].y = lerp(enemyVis.current[k].y, enemyTarget.current[k].y, 0.2);
        if (k === "shooter") enemyVis.current.shooter.rot = lerp(enemyVis.current.shooter.rot, enemyTarget.current.shooter.rot, 0.2);
      });

      // Sparks
      sparks.current.forEach((s, i) => {
        s.x += s.vx; s.y += s.vy; s.life -= 0.05;
        if (s.life <= 0) sparks.current.splice(i, 1);
        ctx.fillStyle = `rgba(255, 255, 255, ${s.life})`;
        ctx.fillRect(s.x, s.y, 2, 2);
      });

      // Bullets & Collision
      [myBullets.current, enemyBullets.current].forEach((list, isEnemy) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const b = list[i]; b.x += b.vx; b.y += b.vy;
          ctx.shadowBlur = 10; ctx.shadowColor = isEnemy ? "#f00" : "#0ff";
          ctx.fillStyle = isEnemy ? "#ff3e3e" : "#00f2ff";
          ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI*2); ctx.fill();
          ctx.shadowBlur = 0;

          if (!isEnemy) {
            const hitS = gameState.shieldHealth[opp] > 0 && Math.hypot(b.x - enemyVis.current.shield.x, b.y - enemyVis.current.shield.y) < 45;
            const hitB = gameState.boxHealth[opp] > 0 && Math.hypot(b.x - enemyVis.current.box.x, b.y - enemyVis.current.box.y) < 25;
            const hitP = Math.hypot(b.x - enemyVis.current.shooter.x, b.y - enemyVis.current.shooter.y) < 25;
            
            if (hitS || hitB || hitP) {
              socket.current.emit("take_damage", { roomId, target: hitS?'shield':hitB?'box':'player', victimRole: opp, bulletId: b.id });
              for(let j=0; j<5; j++) sparks.current.push({ x: b.x, y: b.y, vx: (Math.random()-0.5)*5, vy: (Math.random()-0.5)*5, life: 1 });
              list.splice(i, 1);
            }
          }
          if (b.y < -20 || b.y > H + 20) list.splice(i, 1);
        }
      });

      const drawObj = (obj, col, isE, hps) => {
        const hpKey = isE ? opp : role;
        // Box
        if (gameState.boxHealth[hpKey] > 0) {
          ctx.fillStyle = col; ctx.shadowBlur = 15; ctx.shadowColor = col;
          ctx.fillRect(obj.box.x-20, obj.box.y-20, 40, 40);
        }
        // Shield
        if (gameState.shieldHealth[hpKey] > 0) {
          ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 3;
          ctx.arc(obj.shield.x, obj.shield.y, 45, isE?0:Math.PI, isE?Math.PI:0); ctx.stroke();
        }
        // Shooter
        ctx.save(); ctx.translate(obj.shooter.x, obj.shooter.y); ctx.rotate(obj.shooter.rot);
        ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(0, isE?25:-25); ctx.lineTo(-15, isE?-10:10); ctx.lineTo(15, isE?-10:10); ctx.fill();
        ctx.restore();
        // Wheel
        ctx.beginPath(); ctx.strokeStyle = "#444"; ctx.arc(obj.shooter.x, obj.shooter.y + (isE?-45:45), 15, 0, Math.PI*2); ctx.stroke();
        ctx.shadowBlur = 0;
      };

      drawObj(myObj.current, "#00f2ff", false);
      drawObj(enemyVis.current, "#ff3e3e", true);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [role, gameState, opp, roomId, playSound]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="hud">
        <div className="stat red">ENEMY: {Math.floor(gameState.health[opp])}</div>
        <div className="stat blue">YOU: {Math.floor(gameState.health[role])}</div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="count-overlay">{countdown}</div>}
      {gameOver && <div className="game-over"><h1>{gameOver.toUpperCase()}</h1><button onClick={() => navigate("/")}>EXIT</button></div>}
    </div>
  );
}