import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./GamePage.css";

// ⚠️ CHANGE THIS to your Render URL after deployment
const SOCKET_URL = "https://your-backend-service.onrender.com";

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  
  const [role, setRole] = useState(null);
  const [health, setHealth] = useState({ host: 100, guest: 100 });
  const [gameOver, setGameOver] = useState(null);

  const GAME_WIDTH = 400;
  const GAME_HEIGHT = 700;

  // Refs for non-react state (high speed updates)
  const myPos = useRef({ x: 200, y: 600 });
  const oppTargetPos = useRef({ x: 200, y: 100 }); // Target for interpolation
  const oppRenderPos = useRef({ x: 200, y: 100 }); // Current visual position
  const bullets = useRef([]);

  useEffect(() => {
    socket.current = io(SOCKET_URL);

    socket.current.emit("join_room", { roomId, playerName: "Survivor" });

    socket.current.on("assign_role", (data) => {
      setRole(data.role);
      myPos.current.y = data.role === 'host' ? 600 : 100;
    });

    socket.current.on("opponent_moved", (data) => {
      oppTargetPos.current = { x: data.x, y: data.y };
    });

    socket.current.on("incoming_bullet", (b) => {
      bullets.current.push(b);
    });

    socket.current.on("update_health", (h) => {
      setHealth(h);
      if (h.host <= 0) setGameOver(role === 'guest' ? 'win' : 'lose');
      if (h.guest <= 0) setGameOver(role === 'host' ? 'win' : 'lose');
    });

    // Auto-Firing Logic
    const fireInt = setInterval(() => {
      if (!role || gameOver) return;
      const bData = {
        x: myPos.current.x,
        y: role === 'host' ? myPos.current.y - 40 : myPos.current.y + 40,
        vy: role === 'host' ? -10 : 10,
        owner: role,
        roomId
      };
      socket.current.emit("fire", bData);
      bullets.current.push(bData);
    }, 800);

    return () => {
      socket.current.disconnect();
      clearInterval(fireInt);
    };
  }, [roomId, role, gameOver]);

  const handleTouch = (e) => {
    if (!role || gameOver) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches[0];
    
    let nX = (t.clientX - rect.left) * (GAME_WIDTH / rect.width);
    let nY = (t.clientY - rect.top) * (GAME_HEIGHT / rect.height);

    // Coordinate Mirroring for Input
    if (role === 'guest') {
        nX = GAME_WIDTH - nX;
        nY = GAME_HEIGHT - nY;
    }

    // Constraint (Stay in bottom half)
    nY = Math.max(GAME_HEIGHT / 2 + 50, Math.min(GAME_HEIGHT - 40, nY));
    nX = Math.max(40, Math.min(GAME_WIDTH - 40, nX));

    myPos.current = { x: nX, y: nY };
    socket.current.emit("move", { roomId, x: nX, y: nY });
  };

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame;

    const render = () => {
      ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      // 1. INTERPOLATION: Smoothly move Opponent toward target
      oppRenderPos.current.x += (oppTargetPos.current.x - oppRenderPos.current.x) * 0.2;
      oppRenderPos.current.y += (oppTargetPos.current.y - oppRenderPos.current.y) * 0.2;

      const drawBox = (x, y, isOpponent) => {
        let rX = x, rY = y;
        // Mirror the view for the Guest or Mirror the Opponent for the Host
        if ((role === 'guest' && !isOpponent) || (role === 'host' && isOpponent) || (role === 'guest' && isOpponent)) {
            // Logic to ensure the local player is always at the bottom
            if (role === 'guest') {
                rX = GAME_WIDTH - x;
                rY = GAME_HEIGHT - y;
            } else if (isOpponent) {
                rX = GAME_WIDTH - x;
                rY = GAME_HEIGHT - y;
            }
        }

        ctx.fillStyle = isOpponent ? "#ff3e3e" : "#00f2ff";
        ctx.shadowBlur = 15; ctx.shadowColor = ctx.fillStyle;
        ctx.fillRect(rX - 20, rY - 20, 40, 40);
        ctx.shadowBlur = 0;
      };

      drawBox(myPos.current.x, myPos.current.y, false);
      drawBox(oppRenderPos.current.x, oppRenderPos.current.y, true);

      // Bullets & Collision
      bullets.current.forEach((b, i) => {
        b.y += b.vy;
        let bX = b.x, bY = b.y;
        if (role === 'guest') { bX = GAME_WIDTH - b.x; bY = GAME_HEIGHT - b.y; }

        ctx.fillStyle = "#fffb00";
        ctx.beginPath(); ctx.arc(bX, bY, 5, 0, Math.PI*2); ctx.fill();

        // Hit Detection (Server validated health)
        if (Math.hypot(b.x - myPos.current.x, b.y - myPos.current.y) < 25 && b.owner !== role) {
          bullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role });
        }

        if (b.y < -50 || b.y > GAME_HEIGHT + 50) bullets.current.splice(i, 1);
      });

      frame = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frame);
  }, [role, gameOver]);

  return (
    <div className="game-container">
      <div className="hp-bar opponent">
        <div className="hp-fill" style={{ width: `${role === 'host' ? health.guest : health.host}%` }} />
      </div>

      <canvas ref={canvasRef} width={GAME_WIDTH} height={GAME_HEIGHT} onTouchMove={handleTouch} />

      <div className="hp-bar local">
        <div className="hp-fill" style={{ width: `${role === 'host' ? health.host : health.guest}%` }} />
      </div>

      {gameOver && (
        <div className="game-over">
          <h1 className={gameOver}>{gameOver === 'win' ? 'VICTORY' : 'DEFEAT'}</h1>
          <button onClick={() => navigate("/")}>EXIT</button>
        </div>
      )}
    </div>
  );
}