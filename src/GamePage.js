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
  const [remoteState, setRemoteState] = useState(null);
  const canvasRef = useRef(null);
  const userId = useRef(getUserId());

  // Local player state
  const local = useRef({
    attacker: { x: 200, y: 300, hp: 400, angle: -Math.PI/2, lastFireId: null },
    shield: { x: 300, y: 250, hp: 150 },
    treasure: { x: 400, y: 350, hp: 200 },
    bullets: [],
    charge: 0,
    isCharging: false,
    activeSprite: null,
    dragOffset: { x: 0, y: 0 }
  });

  // Remote bullets
  const remoteBullets = useRef([]);

  // Apply damage helper
  const applyDamage = useCallback(async (target, amount, isHeal=false) => {
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
      await updateDoc(roomRef, { [`${targetRole}.${target}.hp`]: Math.max(0,currentHp - amount) });
    } catch(err){ console.error(err); }
  }, [isHost, roomId]);

  // Sync local state to Firestore
  const sync = useCallback(async () => {
    const role = isHost ? "hostState" : "guestState";
    await updateDoc(doc(db, "rooms", roomId), {
      [`${role}.attacker`]: local.current.attacker,
      [`${role}.shield`]: local.current.shield,
      [`${role}.treasure`]: local.current.treasure
    });
  }, [isHost, roomId]);

  // Firestore subscription for opponent updates
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), async (snap) => {
      const data = snap.data();
      if(!data) return;
      setGameData(data);
      if(data.status === "finished") setShowVictory(true);

      const hostFlag = data.hostId === userId.current;
      setIsHost(hostFlag);

      const opponent = hostFlag ? data.guestState : data.hostState;
      setRemoteState(opponent);

      // Detect opponent fire
      if(opponent?.attacker?.lastFireId){
        const lastId = opponent.attacker.lastFireId;
        if(!remoteBullets.current.find(b => b.id === lastId)){
          remoteBullets.current.push({
            id: lastId,
            x: opponent.attacker.x,
            y: opponent.attacker.y,
            vx: Math.cos(opponent.attacker.angle) * 12,
            vy: Math.sin(opponent.attacker.angle) * 12,
            active: true,
            damage:2
          });
        }
      }

      // End game detection
      const myState = hostFlag ? data.hostState : data.guestState;
      if(myState && myState.attacker.hp<=0 && myState.treasure.hp<=0 && data.status!=="finished"){
        await updateDoc(doc(db,"rooms",roomId),{
          status:"finished",
          winner: hostFlag ? (data.guestName || "Guest") : (data.hostName || "Host")
        });
      }
    });
    return ()=>unsubscribe();
  }, [roomId]);

  // Auto-fire bullets
  useEffect(()=>{
    const interval = setInterval(()=>{
      const l = local.current;
      if(!l.isCharging && l.attacker.hp>0){
        const fireId = Math.random().toString(36).substr(2,9);
        l.bullets.push({
          x:l.attacker.x, y:l.attacker.y,
          vx: Math.cos(l.attacker.angle)*12,
          vy: Math.sin(l.attacker.angle)*12,
          active:true, damage:2, id:fireId
        });
        const role = isHost ? "hostState":"guestState";
        updateDoc(doc(db,"rooms",roomId),{ [`${role}.attacker.lastFireId`]:fireId });
      } else if(l.isCharging){ l.charge=Math.min(100,l.charge+10); }
    },300);
    return ()=>clearInterval(interval);
  },[isHost,roomId]);

  // Touch handling for dragging
  const handleTouchStart = (e)=>{
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const tx = touch.clientX - rect.left;
    const ty = touch.clientY - rect.top;
    const l = local.current;
    const hit = (s,r)=>Math.sqrt((tx-s.x)**2 + (ty-s.y)**2) < r;

    if(hit(l.attacker,30)){ l.activeSprite='attacker'; l.dragOffset={x:tx-l.attacker.x, y:ty-l.attacker.y}; }
    else if(hit(l.shield,30)){ l.activeSprite='shield'; l.dragOffset={x:tx-l.shield.x, y:ty-l.shield.y}; }
    else if(hit(l.treasure,30)){ l.activeSprite='treasure'; l.dragOffset={x:tx-l.treasure.x, y:ty-l.treasure.y}; }

    // Charge turret if attacker touched
    if(l.activeSprite==='attacker'){ l.isCharging=true; l.charge=0; }
  };

  const handleTouchEnd = ()=>{
    const l = local.current;
    if(l.isCharging && l.charge>=50){
      const fireId = Math.random().toString(36).substr(2,9);
      l.bullets.push({
        x:l.attacker.x, y:l.attacker.y,
        vx: Math.cos(l.attacker.angle)*15,
        vy: Math.sin(l.attacker.angle)*15,
        active:true, damage:40, id:fireId
      });
      const role = isHost ? "hostState":"guestState";
      updateDoc(doc(db,"rooms",roomId),{ [`${role}.attacker.lastFireId`]:fireId });
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

    const W = window.innerWidth;
    const H = window.innerHeight - 150;

    const render = ()=>{
      const l=local.current;
      const r=remoteState;

      ctx.clearRect(0,0,W,H);

      // === Remote bullets ===
      remoteBullets.current = remoteBullets.current.filter(b=>b.active && b.y>0 && b.y<H);
      remoteBullets.current.forEach(b=>{
        b.x+=b.vx; b.y+=b.vy;
        ctx.fillStyle="white";
        ctx.beginPath(); ctx.arc(b.x,H-b.y,3,0,2*Math.PI); ctx.fill();
        // collisions
        if(Math.abs(b.x-l.shield.x)<50 && Math.abs(H-b.y-l.shield.y)<30 && l.shield.hp>0){ applyDamage("shield",2); b.active=false; }
        if(Math.abs(b.x-l.treasure.x)<30 && Math.abs(H-b.y-l.treasure.y)<20 && l.treasure.hp>0){ applyDamage("treasure",2); applyDamage("attacker",2,true); b.active=false; }
        if(Math.abs(b.x-l.attacker.x)<25 && Math.abs(H-b.y-l.attacker.y)<25 && l.attacker.hp>0){ applyDamage("attacker",2); b.active=false; }
      });

      // === Opponent elements (mirrored top) ===
      if(r){
        ctx.strokeStyle = r.shield.hp>0?"red":"transparent";
        ctx.beginPath();
        ctx.arc(r.shield.x,H-r.shield.y,50,0,Math.PI); ctx.stroke();

        ctx.fillStyle = r.treasure.hp>0?"#550000":"transparent";
        ctx.fillRect(r.treasure.x-20,H-r.treasure.y-20,40,40);

        ctx.fillStyle="red";
        ctx.fillRect(r.attacker.x-20,H-r.attacker.y-20,40,40);
      }

      // === Local elements (bottom half) ===
      ctx.beginPath();
      ctx.arc(l.shield.x,l.shield.y,50,Math.PI,0);
      ctx.strokeStyle="#00f2ff"; ctx.lineWidth=4; ctx.stroke();
      ctx.fillStyle="#ffd700"; ctx.fillRect(l.treasure.x-25,l.treasure.y-15,50,30);

      // Turret
      ctx.save();
      ctx.translate(l.attacker.x,l.attacker.y);
      ctx.rotate(l.attacker.angle);
      ctx.fillStyle=l.isCharging?`rgb(255,${255-l.charge*2},0)`:"#33ff33";
      ctx.fillRect(-25,-10,50,20);
      ctx.restore();

      // Turret angle control knob (small draggable at base)
      ctx.fillStyle="#00f2ff";
      ctx.strokeStyle="#fff";
      ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(l.attacker.x,l.attacker.y+15,10,0,2*Math.PI); ctx.fill(); ctx.stroke();

      // Charge bar
      if(l.isCharging){ ctx.fillStyle="white"; ctx.fillRect(l.attacker.x-25,l.attacker.y+35,l.charge/2,6); }

      // Local bullets
      l.bullets = l.bullets.filter(b=>b.active && b.y>0 && b.y<H);
      l.bullets.forEach(b=>{
        b.x+=b.vx; b.y+=b.vy;
        ctx.fillStyle=b.damage>2?"orange":"white";
        ctx.beginPath(); ctx.arc(b.x,b.y,b.damage>2?8:3,0,2*Math.PI); ctx.fill();
      });

      loop=requestAnimationFrame(render);
    };
    render();
    return ()=>cancelAnimationFrame(loop);
  },[remoteState,applyDamage]);

  return (
    <div className="game-screen"
         onTouchStart={handleTouchStart}
         onTouchMove={(e)=>{
           const touch = e.touches[0];
           const rect = canvasRef.current.getBoundingClientRect();
           if(local.current.activeSprite){
             const half = isHost? (window.innerHeight/2):0; // top or bottom half
             let newY = touch.clientY - rect.top - local.current.dragOffset.y;
             let newX = touch.clientX - rect.left - local.current.dragOffset.x;

             // constrain to player's half
             if(isHost){ if(newY>window.innerHeight/2) newY=window.innerHeight/2; }
             else { if(newY<window.innerHeight/2) newY=window.innerHeight/2; }

             local.current[local.current.activeSprite].x = Math.max(30,Math.min(W-30,newX));
             local.current[local.current.activeSprite].y = Math.max(30,Math.min(H-30,newY));
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
          <span>MY HP: {gameData?.[isHost?'hostState':'guestState']?.attacker.hp || 0}</span>
          <span>OPPONENT HP: {remoteState?.attacker.hp || 0}</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight-150}/>
    </div>
  );
}

export default GamePage;