import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, rtdb } from "./firebase"; 
import { doc, onSnapshot } from "firebase/firestore";
import { ref, onValue, set, push, onChildAdded, update } from "firebase/database";
import "./GamePage.css";

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  
  // UI State
  const [playerRole, setPlayerRole] = useState(null); 
  const [names, setNames] = useState({ host: "Player 1", guest: "Player 2" });
  const [health, setHealth] = useState({ host: 100, guest: 100 });
  const [gameOver, setGameOver] = useState(null);

  // Constants
  const GAME_WIDTH = 400; 
  const GAME_HEIGHT = 700; 

  // High-frequency refs
  const gameState = useRef({
    host: { x: 200, y: 600 },
    guest: { x: 200, y: 100 },
    bullets: []
  });
  const isDragging = useRef(false);

  /* 1. SYNC ROLES & INITIALIZE RTDB */
  useEffect(() => {
    const roomRef = doc(db, "rooms", roomId);
    const unsubFirestore = onSnapshot(roomRef, (snap) => {
      const data = snap.data();
      if (!data) return;

      setNames({ host: data.hostName, guest: data.guestName });
      
      // Determine Role
      const currentUserId = data.selfId; // Adjust based on your Auth/ID logic
      const role = data.hostId === currentUserId ? "host" : "guest";
      setPlayerRole(role);

      // INITIALIZATION: If Host, set the starting values in RTDB
      if (role === "host") {
        const gameRef = ref(rtdb, `rooms/${roomId}`);
        onValue(gameRef, (snapshot) => {
          if (!snapshot.exists()) {
            update(gameRef, {
              health: { host: 100, guest: 100 },
              positions: {
                host: { x: 200, y: 600 },
                guest: { x: 200, y: 100 }
              }
            });
          }
        }, { onlyOnce: true });
      }
    });

    return () => unsubFirestore();
  }, [roomId]);

  /* 2. REALTIME GAME ENGINE (RTDB) */
  useEffect(() => {
    if (!playerRole) return;

    // Listen for Positions
    const posRef = ref(rtdb, `rooms/${roomId}/positions`);
    onValue(posRef, (snap) => {
      const val = snap.val();
      if (val) {
        if (val.host) gameState.current.host = val.host;
        if (val.guest) gameState.current.guest = val.guest;
      }
    });

    // Listen for Health & Victory
    const healthRef = ref(rtdb, `rooms/${roomId}/health`);
    onValue(healthRef, (snap) => {
      const val = snap.val();
      if (val) {
        setHealth(val);
        if (val.host <= 0) setGameOver(playerRole === 'host' ? 'lose' : 'win');
        if (val.guest <= 0) setGameOver(playerRole === 'guest' ? 'lose' : 'win');
      }
    });

    // Bullet Listener
    const bulletsRef = ref(rtdb, `rooms/${roomId}/bullets`);
    onChildAdded(bulletsRef, (snap) => {
      gameState.current.bullets.push({ id: snap.key, ...snap.val() });
    });

    // Auto-Firing Logic
    const fireInterval = setInterval(() => {
      if (gameOver) return;
      const myPos = gameState.current[playerRole];
      
      push(ref(rtdb, `rooms/${roomId}/bullets`), {
        x: myPos.x,
        y: playerRole === "host" ? myPos.y - 40 : myPos.y + 40,
        vy: playerRole === "host" ? -9 : 9, 
        owner: playerRole
      });
    }, 600 + Math.random() * 1000);

    return () => clearInterval(fireInterval);
  }, [roomId, playerRole, gameOver]);

  /* 3. INPUT HANDLING */
  const handleMove = (e) => {
    if (!isDragging.current || !playerRole || gameOver) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    
    let nX = (touch.clientX - rect.left) * (GAME_WIDTH / rect.width);
    let nY = (touch.clientY - rect.top) * (GAME_HEIGHT / rect.height);

    // Mirroring for the Guest
    if (playerRole === "guest") {
        nY = GAME_HEIGHT - nY;
        nX = GAME_WIDTH - nX;
    }

    // Lock to bottom half
    nY = Math.max(GAME_HEIGHT / 2 + 50, Math.min(GAME_HEIGHT - 40, nY));
    nX = Math.max(40, Math.min(GAME_WIDTH - 40, nX));

    set(ref(rtdb, `rooms/${roomId}/positions/${playerRole}`), { x: nX, y: nY });
  };

  const takeDamage = () => {
    const currentHP = health[playerRole];
    if (currentHP > 0) {
      set(ref(rtdb, `rooms/${roomId}/health/${playerRole}`), currentHP - 5);
    }
  };

  /* 4. CANVAS RENDERER */
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let animationReq;

    const loop = () => {
      ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      // Mid-field Glow
      ctx.strokeStyle = "rgba(0, 242, 255, 0.2)";
      ctx.setLineDash([5, 15]);
      ctx.beginPath(); ctx.moveTo(0, GAME_HEIGHT/2); ctx.lineTo(GAME_WIDTH, GAME_HEIGHT/2); ctx.stroke();
      ctx.setLineDash([]);

      const drawPlayer = (data, isOpponent) => {
        let renderX = data.x;
        let renderY = data.y;

        // Render Mirror Logic
        if ((playerRole === "host" && isOpponent) || (playerRole === "guest" && !isOpponent)) {
            renderX = GAME_WIDTH - data.x;
            renderY = GAME_HEIGHT - data.y;
        }

        ctx.fillStyle = isOpponent ? "#ff3e3e" : "#00f2ff";
        ctx.shadowBlur = 20;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fillRect(renderX - 20, renderY - 20, 40, 40);
        ctx.shadowBlur = 0;
      };

      drawPlayer(gameState.current.host, playerRole === "guest");
      drawPlayer(gameState.current.guest, playerRole === "host");

      // Bullet Physics & Collision
      gameState.current.bullets.forEach((b, i) => {
        b.y += b.vy;
        
        let bX = b.x; let bY = b.y;
        if (playerRole === "guest") { bX = GAME_WIDTH - b.x; bY = GAME_HEIGHT - b.y; }

        ctx.fillStyle = "#fffb00";
        ctx.beginPath(); ctx.arc(bX, bY, 5, 0, Math.PI * 2); ctx.fill();

        // Check if I got hit
        const me = gameState.current[playerRole];
        if (Math.hypot(b.x - me.x, b.y - me.y) < 25 && b.owner !== playerRole) {
            gameState.current.bullets.splice(i, 1);
            takeDamage();
        }

        if (b.y < -100 || b.y > GAME_HEIGHT + 100) gameState.current.bullets.splice(i, 1);
      });

      animationReq = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(animationReq);
  }, [playerRole, health, gameOver]);

  return (
    <div className="game-container">
      <div className="ui-layer opponent">
        <div className="hp-container">
          <div className="hp-fill" style={{ width: `${playerRole === 'host' ? health.guest : health.host}%` }} />
        </div>
        <p>{playerRole === 'host' ? names.guest : names.host}</p>
      </div>
      
      <canvas 
        ref={canvasRef} 
        width={GAME_WIDTH} 
        height={GAME_HEIGHT}
        onTouchStart={() => isDragging.current = true}
        onTouchMove={handleMove}
        onTouchEnd={() => isDragging.current = false}
      />

      <div className="ui-layer local">
        <p>{playerRole === 'host' ? names.host : names.guest} (YOU)</p>
        <div className="hp-container">
          <div className="hp-fill" style={{ width: `${playerRole === 'host' ? health.host : health.guest}%` }} />
        </div>
      </div>

      {gameOver && (
        <div className="game-over-screen">
          <h1 className={gameOver}>{gameOver === 'win' ? 'VICTORY' : 'DEFEAT'}</h1>
          <button onClick={() => navigate("/lobby")}>EXIT TO LOBBY</button>
        </div>
      )}
    </div>
  );
}