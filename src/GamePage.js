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
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);

  const W = 400, H = 700;
  const MID = H / 2; // Mid-point boundary
  
  const myPos = useRef({ x: 200, y: 600, rot: 0 });
  const enemyPos = useRef({ x: 200, y: 100, rot: 0 });
  const boxPos = useRef({ x: 200, y: 450 }); // Start in user's half
  
  const dragTarget = useRef(null); 
  const lastTap = useRef(0);
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);

  useEffect(() => {
    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    socket.current.emit("join_game", { roomId });
    
    socket.current.on("assign_role", (data) => setRole(data.role));
    socket.current.on("start_countdown", () => setCountdown(3));
    socket.current.on("opp_move", (d) => { enemyPos.current = d; });
    socket.current.on("box_move", (d) => { boxPos.current = d; });
    socket.current.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    
    socket.current.on("update_game_state", (data) => {
      setHealth(data.health);
      setOverHealth(data.overHealth);
      if (data.health.host <= 0 || data.health.guest <= 0) {
        const iAmHost = socket.current.id === data.host; 
        setGameOver((iAmHost ? data.health.host <= 0 : data.health.guest <= 0) ? "lose" : "win");
      }
    });

    return () => socket.current?.disconnect();
  }, [roomId]);

  const handleTouch = (e) => {
    if (!role || gameOver || countdown > 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.changedTouches[0];
    const tx = (t.clientX - rect.left) * (W / rect.width);
    const ty = (t.clientY - rect.top) * (H / rect.height);

    if (e.type === "touchstart") {
      const distToWheel = Math.hypot(tx - myPos.current.x, ty - (myPos.current.y + 20));
      const distToBox = Math.hypot(tx - boxPos.current.x, ty - boxPos.current.y);
      const distToPlayer = Math.hypot(tx - myPos.current.x, ty - myPos.current.y);

      if (distToWheel < 50) dragTarget.current = 'wheel';
      else if (distToBox < 40) dragTarget.current = 'box';
      else if (distToPlayer < 50) dragTarget.current = 'player';
      
      const now = Date.now();
      if (dragTarget.current === 'player' && now - lastTap.current < 300) {
        socket.current.emit("toss_grenade", { roomId, x: tx, y: ty });
      }
      lastTap.current = now;
    }

    if (e.type === "touchmove") {
      // BOUNDARY ENFORCEMENT: ty cannot be less than MID
      const constrainedY = Math.max(MID + 20, ty); 

      if (dragTarget.current === 'player') {
        myPos.current.x = tx; 
        myPos.current.y = constrainedY;
        socket.current.emit("move", { roomId, x: W - tx, y: H - constrainedY, rot: -myPos.current.rot });
      } 
      else if (dragTarget.current === 'box') {
        boxPos.current.x = tx; 
        boxPos.current.y = constrainedY;
        socket.current.emit("sync_box", { roomId, x: W - tx, y: H - constrainedY });
      }
      else if (dragTarget.current === 'wheel') {
        const angle = Math.atan2(ty - myPos.current.y, tx - myPos.current.x) + Math.PI/2;
        const limit = 1.22; // 70 degrees
        myPos.current.rot = Math.max(-limit, Math.min(limit, angle));
        socket.current.emit("move", { roomId, x: W - myPos.current.x, y: H - myPos.current.y, rot: -myPos.current.rot });
      }
    }
    if (e.type === "touchend") dragTarget.current = null;
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      // MID SEPARATION LINE
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.moveTo(0, MID); ctx.lineTo(W, MID); ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // DRAW TREASURE BOX
      ctx.fillStyle = "#e1ff00";
      ctx.shadowBlur = 15; ctx.shadowColor = "#e1ff00";
      ctx.fillRect(boxPos.current.x - 20, boxPos.current.y - 20, 40, 40);
      ctx.shadowBlur = 0;

      const drawEntity = (x, y, rot, color, isEnemy, hpShield) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        if (!isEnemy) {
            ctx.strokeStyle = "rgba(0, 242, 255, 0.4)";
            ctx.beginPath(); ctx.arc(0, 20, 45, Math.PI, 0, true); ctx.stroke();
        }
        if (hpShield > 0) {
          ctx.strokeStyle = "#e1ff00"; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(0, isEnemy ? 10 : -10, 45, isEnemy ? 0 : Math.PI, isEnemy ? Math.PI : 0); ctx.stroke();
        }
        ctx.fillStyle = color; ctx.beginPath();
        if (isEnemy) { ctx.moveTo(0, 40); ctx.lineTo(-20, -10); ctx.lineTo(20, -10); }
        else { ctx.moveTo(0, -40); ctx.lineTo(-20, 10); ctx.lineTo(20, 10); }
        ctx.fill(); ctx.restore();
      };

      drawEntity(myPos.current.x, myPos.current.y, myPos.current.rot, "#00f2ff", false, overHealth[role]);
      drawEntity(enemyPos.current.x, enemyPos.current.y, enemyPos.current.rot, "#ff3e3e", true, overHealth[role === 'host' ? 'guest' : 'host']);

      // BULLET LOGIC
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff";
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        
        if (Math.abs(b.x - boxPos.current.x) < 30 && Math.abs(b.y - boxPos.current.y) < 30) {
          socket.current.emit("take_damage", { roomId, target: 'box' });
          myBullets.current.splice(i, 1);
        }
        if (Math.hypot(b.x - enemyPos.current.x, b.y - enemyPos.current.y) < 30) {
          socket.current.emit("take_damage", { roomId, target: 'player', victimRole: role === 'host' ? 'guest' : 'host' });
          myBullets.current.splice(i, 1);
        }
        if (b.y < -50 || b.y > H + 50) myBullets.current.splice(i, 1);
      });

      enemyBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#ff3e3e";
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        if (b.y > H + 50) enemyBullets.current.splice(i, 1);
      });

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, overHealth, boxPos.current]);

  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const angle = myPos.current.rot;
      const vx = Math.sin(angle) * 18;
      const vy = -Math.cos(angle) * 18;
      myBullets.current.push({ x: myPos.current.x, y: myPos.current.y, vx, vy });
      socket.current.emit("fire", { roomId, x: W - myPos.current.x, y: H - myPos.current.y, vx: -vx, vy: -vy });
    }, 200);
    return () => clearInterval(fireInt);
  }, [countdown, gameOver, role]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <div className="header-dashboard">
        {/* Same stat-box structure for Enemy and You */}
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      {/* Overlays */}
    </div>
  );
}