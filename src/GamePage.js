import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

const SOCKET_URL = "https://deatgame-server.onrender.com";
const W = 400, H = 700;

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  const audioCtx = useRef(null);
  
  const [role, setRole] = useState(null);
  const [gameState, setGameState] = useState({
    health: { host: 650, guest: 650 }, overHealth: { host: 0, guest: 0 },
    boxHealth: { host: 300, guest: 300 }, shieldHealth: { host: 350, guest: 350 }
  });
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [rematchSent, setRematchSent] = useState(false);

  const myObj = useRef({ shooter: { x: 100, y: 640, rot: 0 }, shield: { x: 200, y: 560 }, box: { x: 300, y: 660 } });
  const enemyTarget = useRef({ shooter: { x: 300, y: 60, rot: 0 }, shield: { x: 200, y: 140 }, box: { x: 100, y: 40 } });
  const enemyVis = useRef({ shooter: { x: 300, y: 60, rot: 0 }, shield: { x: 200, y: 140 }, box: { x: 100, y: 40 } });
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);
  const activeTouches = useRef(new Map());

  const playHitSound = useCallback(() => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
    const osc = audioCtx.current.createOscillator();
    const g = audioCtx.current.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(1000, audioCtx.current.currentTime);
    g.gain.setValueAtTime(0.05, audioCtx.current.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.1);
    osc.connect(g); g.connect(audioCtx.current.destination);
    osc.start(); osc.stop(audioCtx.current.currentTime + 0.1);
  }, []);

  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ["websocket"] });
    socket.current = s;
    s.emit("join_game", { roomId });
    s.on("assign_role", (d) => {
      setRole(d.role);
      if (d.role === 'guest') { myObj.current.shooter.x = 300; myObj.current.box.x = 100; }
    });
    s.on("start_countdown", () => {
      setCountdown(3);
      setGameOver(null);
      setRematchSent(false);
    });
    s.on("opp_move_all", (d) => { enemyTarget.current = d; });
    s.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    s.on("update_game_state", (data) => {
      setGameState(data);
      if (data.lastHit) playHitSound();
      const opp = role === 'host' ? 'guest' : 'host';
      if (data.health[role] <= 0) setGameOver("lose");
      else if (data.health[opp] <= 0) setGameOver("win");
    });
    return () => s.disconnect();
  }, [roomId, role, playHitSound]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fire = setInterval(() => {
      const { x, y, rot } = myObj.current.shooter;
      const bId = Math.random().toString(36).substr(2, 9);
      const b = { x: x + Math.sin(rot)*25, y: y - Math.cos(rot)*25, vx: Math.sin(rot)*16, vy: -Math.cos(rot)*16, id: bId };
      myBullets.current.push(b);
      socket.current.emit("fire", { roomId, x: W-b.x, y: H-b.y, vx: -b.vx, vy: -b.vy, id: bId });
    }, 220);
    return () => clearInterval(fire);
  }, [countdown, gameOver, role, roomId]);

  const handleTouch = (e) => {
    if (gameOver || !role) return;
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
        if (dId === "wheel") myObj.current.shooter.rot = Math.max(-1.1, Math.min(1.1, (tx - myObj.current.shooter.x) / 30));
        else if (dId) { myObj.current[dId].x = tx; myObj.current[dId].y = Math.max(H/2 + 20, ty); }
        socket.current.emit("move_all", { roomId, shooter: { x: W-myObj.current.shooter.x, y: H-myObj.current.shooter.y, rot: -myObj.current.shooter.rot }, shield: { x: W-myObj.current.shield.x, y: H-myObj.current.shield.y }, box: { x: W-myObj.current.box.x, y: H-myObj.current.box.y } });
      }
    });
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      const oppRole = role === 'host' ? 'guest' : 'host';
      
      ["shooter", "shield", "box"].forEach(k => {
        enemyVis.current[k].x = 0.8*enemyVis.current[k].x + 0.2*enemyTarget.current[k].x;
        enemyVis.current[k].y = 0.8*enemyVis.current[k].y + 0.2*enemyTarget.current[k].y;
        if (k === "shooter") enemyVis.current.shooter.rot = 0.8*enemyVis.current.shooter.rot + 0.2*enemyTarget.current.shooter.rot;
      });

      [myBullets.current, enemyBullets.current].forEach((list, isEnemy) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const b = list[i]; b.x += b.vx; b.y += b.vy;
          ctx.fillStyle = isEnemy ? "#f00" : "#0ff";
          ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, 7); ctx.fill();
          if (!isEnemy) {
            const hitS = gameState.shieldHealth[oppRole] > 0 && Math.hypot(b.x - enemyVis.current.shield.x, b.y - enemyVis.current.shield.y) < 40;
            const hitB = gameState.boxHealth[oppRole] > 0 && Math.hypot(b.x - enemyVis.current.box.x, b.y - enemyVis.current.box.y) < 25;
            const hitP = Math.hypot(b.x - enemyVis.current.shooter.x, b.y - enemyVis.current.shooter.y) < 25;
            if (hitS || hitB || hitP) {
              socket.current.emit("take_damage", { roomId, target: hitS?'shield':hitB?'box':'player', victimRole: oppRole, bulletId: b.id });
              list.splice(i, 1);
            }
          }
          if (b.y < -10 || b.y > H+10) list.splice(i, 1);
        }
      });

      const drawObj = (obj, col, isE, hKey) => {
        if (gameState.shieldHealth[hKey] > 0) {
          ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(obj.shield.x, obj.shield.y, 40, isE?0:Math.PI, isE?Math.PI:0); ctx.stroke();
        }
        if (gameState.boxHealth[hKey] > 0) {
          ctx.fillStyle = col; ctx.fillRect(obj.box.x-15, obj.box.y-15, 30, 30);
        }
        ctx.save(); ctx.translate(obj.shooter.x, obj.shooter.y); ctx.rotate(obj.shooter.rot);
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, isE?20:-20); ctx.lineTo(-12, isE?-8:8); ctx.lineTo(12, isE?-8:8); ctx.fill();
        ctx.restore();
      };
      drawObj(myObj.current, "#0ff", false, role);
      drawObj(enemyVis.current, "#f00", true, oppRole);
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [gameState, role, roomId]);

  if (!role) return <div className="loading">Connecting...</div>;

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch}>
      <div className="hud-top">
        <div className="hp-box"><span>ENEMY: {Math.floor(gameState.health[role==='host'?'guest':'host'])}</span></div>
        <div className="hp-box"><span>YOU: {Math.floor(gameState.health[role])}</span></div>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="countdown-overlay">{countdown}</div>}
      {gameOver && (
        <div className={`end-scr ${gameOver}`}>
          <h1>{gameOver==='win'?'VICTORY':'DEFEAT'}</h1>
          <button onClick={() => { setRematchSent(true); socket.current.emit("request_rematch", { roomId, role }); }} disabled={rematchSent}>
            {rematchSent ? "WAITING..." : "REMATCH"}
          </button>
          <button onClick={()=>navigate("/")}>EXIT</button>
        </div>
      )}
    </div>
  );
}