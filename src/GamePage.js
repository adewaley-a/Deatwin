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
  const [gameState, setGameState] = useState(null);
  const [gameOver, setGameOver] = useState(null);
  const [countdown, setCountdown] = useState(null);

  const W = 400, H = 700;
  const MID = H / 2; 
  
  // My Assets (Bottom Half)
  const myPos = useRef({ x: 200, y: 600, rot: 0 });
  const myBoxPos = useRef({ x: 100, y: 550 });
  const myShieldPos = useRef({ x: 300, y: 550 });

  // Opponent Assets (Mirrored in Top Half)
  const oppPos = useRef({ x: 200, y: 100, rot: 0 });
  const oppBoxPos = useRef({ x: 300, y: 150 });
  const oppShieldPos = useRef({ x: 100, y: 150 });

  const dragTarget = useRef(null); 
  const myBullets = useRef([]);
  const enemyBullets = useRef([]);

  // Socket setup - roomId added to dependencies
  useEffect(() => {
    socket.current = io(SOCKET_URL, { transports: ['websocket'] });
    const s = socket.current;

    s.emit("join_game", { roomId });
    
    s.on("assign_role", (data) => setRole(data.role));
    s.on("start_countdown", () => setCountdown(3));

    s.on("sync_all", (data) => {
      // Mirrored coordinates for display
      oppPos.current = { x: W - data.pos.x, y: H - data.pos.y, rot: -data.pos.rot };
      oppBoxPos.current = { x: W - data.box.x, y: H - data.box.y };
      oppShieldPos.current = { x: W - data.shield.x, y: H - data.shield.y };
    });

    s.on("incoming_bullet", (b) => enemyBullets.current.push(b));
    
    s.on("update_game_state", (data) => {
      setGameState(data);
      if (data.health[data.host] <= 0 || data.health[data.guest] <= 0) {
        setGameOver(data.health[s.id] <= 0 ? "lose" : "win");
      }
    });

    return () => s.disconnect();
  }, [roomId, W, H]);

  // Touch Handler - Memoized to prevent dependency loops
  const handleTouch = useCallback((e) => {
    if (!role || gameOver || (countdown !== null && countdown > 0)) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.changedTouches[0];
    const tx = (t.clientX - rect.left) * (W / rect.width);
    const ty = (t.clientY - rect.top) * (H / rect.height);

    if (e.type === "touchstart") {
      if (Math.hypot(tx - myPos.current.x, ty - (myPos.current.y + 20)) < 50) dragTarget.current = 'wheel';
      else if (Math.hypot(tx - myBoxPos.current.x, ty - myBoxPos.current.y) < 40) dragTarget.current = 'box';
      else if (Math.hypot(tx - myShieldPos.current.x, ty - myShieldPos.current.y) < 40) dragTarget.current = 'shield';
      else if (Math.hypot(tx - myPos.current.x, ty - myPos.current.y) < 50) dragTarget.current = 'player';
    }

    if (e.type === "touchmove") {
      const cy = Math.max(MID + 40, ty); // Locking to bottom half

      if (dragTarget.current === 'player') { myPos.current.x = tx; myPos.current.y = cy; } 
      else if (dragTarget.current === 'box') { myBoxPos.current.x = tx; myBoxPos.current.y = cy; }
      else if (dragTarget.current === 'shield') { myShieldPos.current.x = tx; myShieldPos.current.y = cy; }
      else if (dragTarget.current === 'wheel') {
        const angle = Math.atan2(ty - myPos.current.y, tx - myPos.current.x) + Math.PI/2;
        myPos.current.rot = Math.max(-1.22, Math.min(1.22, angle));
      }

      socket.current.emit("client_movement", {
        roomId,
        pos: myPos.current,
        box: myBoxPos.current,
        shield: myShieldPos.current
      });
    }
    if (e.type === "touchend") dragTarget.current = null;
  }, [role, gameOver, countdown, roomId, MID, W, H]);

  // Render Effect - dependencies satisfied
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      // Territory line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(0, MID); ctx.lineTo(W, MID); ctx.stroke();
      ctx.setLineDash([]);

      const drawAsset = (x, y, hp, maxHp, color, isBox, rot = 0) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillStyle = color;
        if (isBox) ctx.fillRect(-20, -20, 40, 40);
        else { ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill(); }

        // Local Entity HP Bars
        const barW = 40;
        ctx.fillStyle = "#333"; ctx.fillRect(-barW/2, 25, barW, 4);
        ctx.fillStyle = color; ctx.fillRect(-barW/2, 25, (Math.max(0, hp)/maxHp) * barW, 4);
        ctx.restore();
      };

      if (gameState) {
        const myId = socket.current.id;
        const oppId = role === 'host' ? gameState.guest : gameState.host;
        const myData = gameState.entities[myId];
        const oppData = gameState.entities[oppId];

        if (myData && oppData) {
          // You
          drawAsset(myPos.current.x, myPos.current.y, gameState.health[myId], 400, "#00f2ff", false, myPos.current.rot);
          drawAsset(myBoxPos.current.x, myBoxPos.current.y, myData.boxHp, 200, "#e1ff00", true);
          drawAsset(myShieldPos.current.x, myShieldPos.current.y, myData.shieldHp, 200, "#00ff88", false);
          // Enemy
          drawAsset(oppPos.current.x, oppPos.current.y, gameState.health[oppId], 400, "#ff3e3e", false, oppPos.current.rot);
          drawAsset(oppBoxPos.current.x, oppBoxPos.current.y, oppData.boxHp, 200, "#ffaa00", true);
          drawAsset(oppShieldPos.current.x, oppShieldPos.current.y, oppData.shieldHp, 200, "#ff0066", false);
        }
      }

      // Bullet Physics & Hit Detection
      myBullets.current.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI*2); ctx.fill();
        
        if (Math.hypot(b.x - oppBoxPos.current.x, b.y - oppBoxPos.current.y) < 25) {
          socket.current.emit("damage_entity", { roomId, type: 'box', targetId: 'opponent' });
          myBullets.current.splice(i, 1);
        } else if (Math.hypot(b.x - oppShieldPos.current.x, b.y - oppShieldPos.current.y) < 25) {
          socket.current.emit("damage_entity", { roomId, type: 'shield', targetId: 'opponent' });
          myBullets.current.splice(i, 1);
        } else if (Math.hypot(b.x - oppPos.current.x, b.y - oppPos.current.y) < 25) {
          socket.current.emit("damage_entity", { roomId, type: 'player', targetId: 'opponent' });
          myBullets.current.splice(i, 1);
        }
        if (b.y < 0 || b.y > H) myBullets.current.splice(i, 1);
      });

      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [role, gameState, MID, W, H, roomId]);

  // Shooting loop
  useEffect(() => {
    if (countdown > 0 || gameOver || !role) return;
    const fireInt = setInterval(() => {
      const vx = Math.sin(myPos.current.rot) * 16;
      const vy = -Math.cos(myPos.current.rot) * 16;
      myBullets.current.push({ x: myPos.current.x, y: myPos.current.y, vx, vy });
      socket.current.emit("fire", { roomId, x: W - myPos.current.x, y: H - myPos.current.y, vx: -vx, vy: -vy });
    }, 200);
    return () => clearInterval(fireInt);
  }, [role, countdown, gameOver, roomId, W, H]);

  // Internal Countdown Timer
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  return (
    <div className="game-container" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch}>
      <canvas ref={canvasRef} width={W} height={H} />
      {countdown > 0 && <div className="overlay"><div className="count">{countdown}</div></div>}
      {gameOver && (
        <div className="overlay">
          <h1 className={gameOver}>{gameOver.toUpperCase()}</h1>
          <button onClick={() => navigate("/")}>EXIT</button>
        </div>
      )}
    </div>
  );
}