import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io("https://deatgame-server.onrender.com"); // ⚠️ UPDATE THIS
const W = 400, H = 600;

export default function SimpleShooter() {
    const canvasRef = useRef(null);
    const [role, setRole] = useState(null);
    const myPos = useRef({ x: 200, y: 500 });
    const oppPos = useRef({ x: 200, y: 500 }); // Raw coords from server
    const bullets = useRef([]);

    useEffect(() => {
        const roomId = "test-room";
        socket.emit('join', roomId);
        socket.on('role', (r) => setRole(r));
        
        socket.on('opp_move', (data) => { oppPos.current = data; });
        socket.on('opp_shoot', (data) => { bullets.current.push(data); });

        // Auto-shoot loop
        const interval = setInterval(() => {
            const b = { x: myPos.current.x, y: myPos.current.y, v: -7, owner: 'me' };
            socket.emit('shoot', { ...b, roomId });
            bullets.current.push(b);
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const draw = () => {
        const ctx = canvasRef.current.getContext("2d");
        ctx.clearRect(0, 0, W, H);

        // 1. Draw ME (Bottom) - Cyan
        ctx.fillStyle = "#00f2ff";
        ctx.fillRect(myPos.current.x - 20, myPos.current.y - 20, 40, 40);

        // 2. Draw OPPONENT (Mirrored to Top) - Red
        ctx.fillStyle = "#ff3e3e";
        const mirroredX = W - oppPos.current.x;
        const mirroredY = H - oppPos.current.y;
        ctx.fillRect(mirroredX - 20, mirroredY - 20, 40, 40);

        // 3. Draw BULLETS
        bullets.current.forEach((b, i) => {
            b.y += b.v;
            ctx.fillStyle = "yellow";
            
            // If bullet is mine, draw normal. If opponent's, draw mirrored.
            let bX = b.owner === 'me' ? b.x : W - b.x;
            let bY = b.owner === 'me' ? b.y : H - b.y;
            
            ctx.beginPath(); ctx.arc(bX, bY, 5, 0, 7); ctx.fill();
            if (b.y < 0 || b.y > H) bullets.current.splice(i, 1);
        });
        requestAnimationFrame(draw);
    };

    useEffect(() => { requestAnimationFrame(draw); }, [role]);

    const handleTouch = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const t = e.touches[0];
        const x = (t.clientX - rect.left) * (W / rect.width);
        const y = Math.max(H/2 + 50, (t.clientY - rect.top) * (H / rect.height)); // Stay in bottom
        myPos.current = { x, y };
        socket.emit('move', { x, y, roomId: "test-room" });
    };

    return (
        <div style={{ background: '#000', height: '100vh', display: 'flex', justifyContent: 'center' }}>
            <canvas ref={canvasRef} width={W} height={H} onTouchMove={handleTouch} style={{ border: '1px solid #fff' }} />
        </div>
    );
}