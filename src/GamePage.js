import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore"; // Import from your Firebase setup
import { db } from "../firebase"; // ⚠️ UPDATE THIS to your Firebase config import
import { io } from "socket.io-client";
import "./GamePage.css";

// ⚠️ CHANGE THIS to your Render URL after deployment
const SOCKET_URL = "https://deatgame-server.onrender.com";

export default function GamePage() {
  const { roomId } = useParams();
  const socket = useRef(null);
  const canvasRef = useRef(null);
  
  // Players' data from Firestore
  const [playerNames, setPlayerNames] = useState({ host: "Player A", guest: "Player B" });
  
  // Game state (Sockets-based)
  const [role, setRole] = useState(null);
  const [health, setHealth] = useState({ host: 400, guest: 400 });
  const [gameOver, setGameOver] = useState(null);

  // Logical game space (Logical coordinate system)
  const W = 400;
  const H = 700;

  // Refs for non-react state (high speed updates)
  const myPos = useRef({ x: 200, y: 600 });
  const enemyPos = useRef({ x: 200, y: 100 });
  const bullets = useRef([]);

  useEffect(() => {
    // 1. Listen to the room data in Firestore for names
    // Ensure the structure matches your app logic
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPlayerNames({ 
            host: data.hostName || "Player A", 
            guest: data.guestName || "Player B" 
        });
      }
    });

    // 2. Initialize Sockets
    socket.current = io(SOCKET_URL);

    // Join with name placeholder for now
    socket.current.emit("join_game", { roomId, playerName: "Player" });

    socket.current.on("assign_role", (data) => {
      setRole(data.role);
      myPos.current.y = data.role === 'host' ? 600 : 100;
    });

    socket.current.on("opp_move", (data) => {
      enemyPos.current = { x: data.x, y: data.y };
    });

    socket.current.on("incoming_bullet", (b) => {
      bullets.current.push(b);
    });

    socket.current.on("update_health", (h) => {
      setHealth(h);
      if (h.host <= 0 || h.guest <= 0) {
        setGameOver(h[role] <= 0 ? "lose" : "win");
      }
    });

    // 3. Auto-fire loop (Runs every second)
    const fireInterval = setInterval(() => {
      if (!role || gameOver) return;
      const bData = {
        x: myPos.current.x,
        y: role === 'host' ? myPos.current.y - 40 : myPos.current.y + 40,
        vy: role === 'host' ? -8 : 8,
        owner: role,
        roomId
      };
      socket.current.emit("fire", bData);
      bullets.current.push(bData);
    }, 1000);

    return () => {
      unsubscribe();
      socket.current.disconnect();
      clearInterval(fireInterval);
    };
  }, [roomId, role, gameOver]);

  // Handle local player movement (Constraint: Stay in bottom half)
  const handleTouch = (e) => {
    if (!role || gameOver) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches[0];
    
    let nX = (t.clientX - rect.left) * (W / rect.width);
    let nY = (t.clientY - rect.top) * (H / rect.height);

    // Coordinate Mirroring Constraint for Touch Input
    // If the guest, the server gives us a 'flipped' view, so
    // our local coordinate system must be translated back.
    if (role === 'guest') {
        nX = W - nX;
        nY = H - nY;
    }

    // Constraint (Stay in bottom half as per sketch)
    nY = Math.max(H / 2 + 50, Math.min(H - 40, nY));
    nX = Math.max(40, Math.min(W - 40, nX));
    
    myPos.current = { x: nX, y: nY };
    socket.current.emit("move", { roomId, x: nX, y: nY, role });
  };

  // The Game Engine (Rendering)
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    const loop = () => {
      ctx.clearRect(0, 0, W, H);

      const drawShooter = (x, y, isEnemy) => {
        let rX = x, rY = y;
        // Corrected coordinate mirroring for drawing:
        // We ensure the local player is *always* at the bottom
        if (role === 'guest') {
            rX = W - x;
            rY = H - y;
        } else if (isEnemy) {
            rX = W - x;
            rY = H - y;
        }

        ctx.fillStyle = isEnemy ? "#ff3e3e" : "#00f2ff";
        ctx.fillRect(rX - 20, rY - 20, 40, 40);
      };

      // Draw local and enemy shooters
      drawShooter(myPos.current.x, myPos.current.y, false);
      drawShooter(enemyPos.current.x, enemyPos.current.y, true);

      // Draw and move bullets
      bullets.current.forEach((b, i) => {
        b.y += b.vy;
        let bX = b.x, bY = b.y;
        if (role === 'guest') { bX = W - b.x; bY = H - b.y; }

        ctx.fillStyle = "yellow";
        ctx.beginPath(); ctx.arc(bX, bY, 5, 0, Math.PI*2); ctx.fill();

        // Hit Detection (Server validated health)
        if (Math.hypot(b.x - myPos.current.x, b.y - myPos.current.y) < 25 && b.owner !== role) {
          bullets.current.splice(i, 1);
          socket.current.emit("take_damage", { roomId, victimRole: role });
        }
      });
      requestAnimationFrame(loop);
    };
    loop();
  }, [role, gameOver]);

  return (
    <div className="game-container" onTouchMove={handleTouch}>
      {/* UI Top Bar (from sketch) */}
      <div className="hp-bar opponent">
        <div className="hp-fill" style={{ width: `${(health.guest / 400) * 100}%` }} />
      </div>

      <canvas ref={canvasRef} width={W} height={H} />

      <div className="hp-bar local">
        <div className="hp-fill" style={{ width: `${(health.host / 400) * 100}%` }} />
      </div>

      {gameOver && (
        <div className="game-over">
          <h1 className={gameOver}>{gameOver === 'win' ? 'VICTORY' : 'DEFEAT'}</h1>
          <button onClick={() => window.location.href = '/'}>EXIT</button>
        </div>
      )}
    </div>
  );
}