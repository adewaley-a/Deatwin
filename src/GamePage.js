import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "./firebase";
import { doc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";
import { rtdb } from "./firebase";
import { ref, push, onChildAdded, remove } from "firebase/database";
import "./GamePage.css";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef(null);

  const [gameData, setGameData] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [remote, setRemote] = useState(null);

  const bullets = useRef([]);

  const local = useRef({
    attacker: { x: 200, y: 420, hp: 400, angle: -Math.PI / 2 },
    shield: { x: 300, y: 380, hp: 150 },
    treasure: { x: 400, y: 460, hp: 200 },
    dragging: null,
    dragOffset: { x: 0, y: 0 }
  });

  /* -------------------- FIRESTORE SNAPSHOT -------------------- */
  useEffect(() => {
    return onSnapshot(doc(db, "rooms", roomId), snap => {
      const d = snap.data();
      if (!d) return;
      setGameData(d);
      setIsHost(d.hostId === d.selfId);
      setRemote(isHost ? d.guestState : d.hostState);
    });
  }, [roomId, isHost]);

  /* -------------------- BULLETS (RTDB) -------------------- */
  useEffect(() => {
    const bulletsRef = ref(rtdb, `rooms/${roomId}/bullets`);
    return onChildAdded(bulletsRef, snap => {
      bullets.current.push({ id: snap.key, ...snap.val() });
    });
  }, [roomId]);

  const fireBullet = () => {
    const a = local.current.attacker;
    push(ref(rtdb, `rooms/${roomId}/bullets`), {
      x: a.x,
      y: a.y,
      vx: Math.cos(a.angle) * 12,
      vy: Math.sin(a.angle) * 12,
      owner: isHost ? "host" : "guest",
      damage: 2,
      created: Date.now()
    });
  };

  /* -------------------- INPUT -------------------- */
  const startDrag = e => {
    const r = canvasRef.current.getBoundingClientRect();
    const x = e.touches[0].clientX - r.left;
    const y = e.touches[0].clientY - r.top;

    ["attacker", "shield", "treasure"].forEach(k => {
      const p = local.current[k];
      if (Math.hypot(x - p.x, y - p.y) < 40) {
        local.current.dragging = k;
        local.current.dragOffset = { x: x - p.x, y: y - p.y };
      }
    });
  };

  const drag = e => {
    if (!local.current.dragging) return;
    const r = canvasRef.current.getBoundingClientRect();
    let x = e.touches[0].clientX - r.left - local.current.dragOffset.x;
    let y = e.touches[0].clientY - r.top - local.current.dragOffset.y;

    const H = canvasRef.current.height;
    const minY = H / 2;
    y = clamp(y, minY + 40, H - 40);
    x = clamp(x, 40, canvasRef.current.width - 40);

    local.current[local.current.dragging].x = x;
    local.current[local.current.dragging].y = y;
  };

  const endDrag = async () => {
    const role = isHost ? "hostState" : "guestState";
    await updateDoc(doc(db, "rooms", roomId), {
      [`${role}.attacker`]: local.current.attacker,
      [`${role}.shield`]: local.current.shield,
      [`${role}.treasure`]: local.current.treasure
    });
    local.current.dragging = null;
  };

  /* -------------------- RENDER LOOP -------------------- */
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");

    const loop = () => {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

      // Local
      drawPlayer(ctx, local.current, false);

      // Remote
      if (remote) drawPlayer(ctx, remote, true);

      // Bullets
      bullets.current.forEach(b => {
        b.x += b.vx;
        b.y += b.vy;
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(b.x, b.owner === "host" ? canvasRef.current.height - b.y : b.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      requestAnimationFrame(loop);
    };
    loop();
  }, [remote]);

  return (
    <div
      className="game-screen"
      onTouchStart={startDrag}
      onTouchMove={drag}
      onTouchEnd={endDrag}
    >
      <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight - 100} />
      <button className="fire-btn" onClick={fireBullet}>FIRE</button>
    </div>
  );
}

function drawPlayer(ctx, p, mirror) {
  const H = ctx.canvas.height;
  const y = mirror ? H - p.attacker.y : p.attacker.y;

  ctx.fillStyle = mirror ? "red" : "#33ff33";
  ctx.fillRect(p.attacker.x - 20, y - 20, 40, 40);

  ctx.strokeStyle = mirror ? "red" : "#00f2ff";
  ctx.beginPath();
  ctx.arc(p.shield.x, mirror ? H - p.shield.y : p.shield.y, 50, Math.PI, 0);
  ctx.stroke();

  ctx.fillStyle = mirror ? "#550000" : "#ffd700";
  ctx.fillRect(p.treasure.x - 20, (mirror ? H - p.treasure.y : p.treasure.y) - 20, 40, 40);
}