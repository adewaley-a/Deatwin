import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from './firebase';
import { doc, onSnapshot, updateDoc, increment, getDoc } from 'firebase/firestore';
import './GamePage.css';

const getUserId = () => {
  let id = localStorage.getItem('game_user_id');
  if (!id) {
    id = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('game_user_id', id);
  }
  return id;
};

function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [gameData, setGameData] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [showVictory, setShowVictory] = useState(false);
  const canvasRef = useRef(null);
  const userId = useRef(getUserId());

  // Local state
  const local = useRef({
    attacker: { x: 200, y: 700, hp: 400, angle: -Math.PI/2, lastFireId: null },
    shield: { x: 200, y: 600, hp: 150 },
    treasure: { x: 100, y: 750, hp: 200 },
    bullets: [],
    charge: 0,
    isCharging: false,
    activeSprite: null,
    dragOffset: { x: 0, y: 0 }
  });

  const remote = useRef(null);
  const remoteBullets = useRef([]);

  // Apply damage
  const applyDamage = useCallback(async (target, amount, isHeal = false) => {
    const roomRef = doc(db, "rooms", roomId);
    const targetRole = isHost ? "guestState" : "hostState";
    const selfRole = isHost ? "hostState" : "guestState";
    try {
      const snap = await getDoc(roomRef);
      const data = snap.data();
      if (!data || !data[targetRole]) return;

      if (isHeal) {
        await updateDoc(roomRef, { [`${selfRole}.attacker.hp`]: increment(amount) });
        return;
      }

      const currentHp = data[targetRole][target].hp;
      if (currentHp <= 0) return;

      const newHp = Math.max(0, currentHp - amount);
      await updateDoc(roomRef, { [`${targetRole}.${target}.hp`]: newHp });
    } catch (err) { console.error("Damage Error:", err); }
  }, [isHost, roomId]);

  // Sync local state
  const sync = useCallback(async () => {
    const role = isHost ? "hostState" : "guestState";
    await updateDoc(doc(db, "rooms", roomId), {
      [`${role}.attacker`]: local.current.attacker,
      [`${role}.shield`]: local.current.shield,
      [`${role}.treasure`]: local.current.treasure
    });
  }, [isHost, roomId]);

  // Firestore subscription
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      const data = snap.data();
      if (!data) return;
      setGameData(data);
      if (data.status === "finished") setShowVictory(true);

      const hostFlag = data.hostId === userId.current;
      setIsHost(hostFlag);
      remote.current = hostFlag ? data.guestState : data.hostState;

      // Detect opponent firing
      if (remote.current) {
        const oldIds = remoteBullets.current.map(b => b.id);
        const newFireId = remote.current.attacker.lastFireId;
        if (newFireId && !oldIds.includes(newFireId)) {
          remoteBullets.current.push({
            id: newFireId,
            x: remote.current.attacker.x,
            y: remote.current.attacker.y,
            vx: Math.cos(remote.current.attacker.angle) * 12,
            vy: Math.sin(remote.current.attacker.angle) * 12,
            active: true
          });
        }
      }

      // Game end detection
      const myState = hostFlag ? data.hostState : data.guestState;
      if (myState && myState.attacker.hp <= 0 && myState.treasure.hp <= 0 && data.status !== "finished") {
        updateDoc(doc(db, "rooms", roomId), { 
          status: "finished", 
          winner: hostFlag ? (data.guestName || "Guest") : (data.hostName || "Host") 
        });
      }
    });
    return () => unsubscribe();
  }, [roomId]);

  // Auto-fire bullets
  useEffect(() => {
    const interval = setInterval(() => {
      const l = local.current;
      if (l.isCharging) {
        l.charge = Math.min(100, l.charge + 10);
      } else if (l.attacker.hp > 0) {
        const fireId = Math.random().toString(36).substr(2,9);
        l.bullets.push({
          x: l.attacker.x, y: l.attacker.y,
          vx: Math.cos(l.attacker.angle) * 12,
          vy: Math.sin(l.attacker.angle) * 12,
          active: true,
          damage: 2,
          id: fireId
        });
        // Notify opponent
        const role = isHost ? "hostState" : "guestState";
        updateDoc(doc(db, "rooms", roomId), { [`${role}.attacker.lastFireId`]: fireId });
      }
    }, 300);
    return () => clearInterval(interval);
  }, [isHost, roomId]);

  // Touch handlers
  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const tx = touch.clientX - rect.left;
    const ty = touch.clientY - rect.top;
    const l = local.current;
    const hit = (s,r)=>Math.sqrt((tx-s.x)**2+(ty-s.y)**2)<r;

    if(hit(l.attacker,50)) { l.isCharging=true; l.charge=0; }
    else if(hit(l.shield,60)) l.activeSprite='shield';
    else if(hit(l.treasure,40)) l.activeSprite='treasure';

    if(l.activeSprite){
      l.dragOffset.x = tx - l[l.activeSprite].x;
      l.dragOffset.y = ty - l[l.activeSprite].y;
    }
  };

  const handleTouchEnd = () => {
    const l = local.current;
    if(l.isCharging && l.charge >=50){
      const fireId = Math.random().toString(36).substr(2,9);
      l.bullets.push({
        x:l.attacker.x, y:l.attacker.y,
        vx:Math.cos(l.attacker.angle)*15,
        vy:Math.sin(l.attacker.angle)*15,
        active:true, damage:40, isGrenade:true,
        id:fireId
      });
      const role = isHost ? "hostState" : "guestState";
      updateDoc(doc(db,"rooms",roomId), { [`${role}.attacker.lastFireId`]:fireId });
    }
    l.isCharging=false;
    l.charge=0;
    l.activeSprite=null;
    sync();
  };

  // Canvas render
  useEffect(()=>{
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let loop;

    const scale = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * scale;
    canvas.height = (window.innerHeight-150) * scale;
    ctx.scale(scale, scale);

    const render = ()=>{
      const l = local.current;
      const r = remote.current;
      const W = window.innerWidth;
      const H = window.innerHeight-150;

      ctx.clearRect(0,0,W,H);

      // Opponent bullets
      remoteBullets.current = remoteBullets.current.filter(b=>b.active && b.y>0 && b.y<H);
      remoteBullets.current.forEach(b=>{
        b.x+=b.vx; b.y+=b.vy;
        ctx.fillStyle="white";
        ctx.beginPath(); ctx.arc(b.x,H-b.y,3,0,2*Math.PI); ctx.fill();

        // Collision with local
        if(Math.abs(b.x-l.shield.x)<50 && Math.abs(H-b.y-l.shield.y)<30 && l.shield.hp>0){ applyDamage("shield",2); b.active=false; }
        if(Math.abs(b.x-l.treasure.x)<30 && Math.abs(H-b.y-l.treasure.y)<20 && l.treasure.hp>0){ applyDamage("treasure",2); applyDamage("attacker",2,true); b.active=false; }
        if(Math.abs(b.x-l.attacker.x)<25 && Math.abs(H-b.y-l.attacker.y)<25 && l.attacker.hp>0){ applyDamage("attacker",2); b.active=false; }
      });

      // Opponent elements mirrored
      if(r){
        ctx.strokeStyle=r.shield.hp>0?"red":"transparent";
        ctx.beginPath(); ctx.arc(r.shield.x,H-r.shield.y,50,0,Math.PI); ctx.stroke();
        ctx.fillStyle=r.treasure.hp>0?"#550000":"transparent";
        ctx.fillRect(r.treasure.x-20,H-r.treasure.y-20,40,40);
        ctx.fillStyle="red";
        ctx.fillRect(r.attacker.x-20,H-r.attacker.y-20,40,40);
      }

      // Local elements
      ctx.beginPath(); ctx.arc(l.shield.x,l.shield.y,50,Math.PI,0);
      ctx.strokeStyle="#00f2ff"; ctx.lineWidth=4; ctx.stroke();
      ctx.fillStyle="#ffd700"; ctx.fillRect(l.treasure.x-25,l.treasure.y-15,50,30);

      ctx.save();
      ctx.translate(l.attacker.x,l.attacker.y);
      ctx.rotate(l.attacker.angle);
      ctx.fillStyle=l.isCharging?`rgb(255,${255-l.charge*2},0)`:"#33ff33";
      ctx.fillRect(0,-10,50,20);
      ctx.restore();

      if(l.isCharging){ ctx.fillStyle="white"; ctx.fillRect(l.attacker.x-25,l.attacker.y+35,l.charge/2,6); }

      // Local bullets
      l.bullets = l.bullets.filter(b=>b.active && b.y>0 && b.y<H);
      l.bullets.forEach(b=>{ b.x+=b.vx; b.y+=b.vy; ctx.fillStyle=b.isGrenade?"orange":"white"; ctx.beginPath(); ctx.arc(b.x,b.y,b.isGrenade?8:3,0,2*Math.PI); ctx.fill(); });

      loop=requestAnimationFrame(render);
    };
    render();
    return ()=>cancelAnimationFrame(loop);
  }, [applyDamage]);

  return (
    <div className="game-screen"
         onTouchStart={handleTouchStart}
         onTouchMove={(e)=>{
           const touch=e.touches[0];
           const rect=canvasRef.current.getBoundingClientRect();
           if(local.current.activeSprite){
             local.current[local.current.activeSprite].x = touch.clientX - rect.left - local.current.dragOffset.x;
             local.current[local.current.activeSprite].y = touch.clientY - rect.top - local.current.dragOffset.y;
             sync();
           }
         }}
         onTouchEnd={handleTouchEnd}>
      {showVictory && (
        <div className="victory-overlay">
          <h1>GAME OVER</h1>
          <p>Champion: {gameData?.winner}</p>
          <h2 className="prize-won">₦{gameData?.prizePool} Won!</h2>
          <button onClick={()=>navigate('/')}>Return to Lobby</button>
        </div>
      )}
      <div className="hp-header">
        <div className="prize-display">PRIZE: ₦{gameData?.prizePool}</div>
        <div className="player-stats-row">
          <span>MY HP: {gameData?.[isHost?'hostState':'guestState']?.attacker.hp||0}</span>
          <span>OPPONENT HP: {remote.current?.attacker.hp||0}</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight-150}/>
      <div className="angle-control">
        <input type="range" min="-3.14" max="0" step="0.01"
               value={local.current.attacker.angle}
               onChange={(e)=>{local.current.attacker.angle=parseFloat(e.target.value); sync();}}/>
      </div>
    </div>
  );
}

export default GamePage;