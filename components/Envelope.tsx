'use client';
import {useState,useRef,useEffect} from 'react';
import {useInView,useIsPresent} from 'motion/react';
import {ArrowUpRight,Heart,Sparkles,RotateCcw} from 'lucide-react';
import {createRevealController} from '../lib/reveal';
import {MagicBurst,useCalmMotion} from './Motion';
export default function Envelope({onOpen,reduced=false,recipient='มายด์',compact=false,replayKey='welcome-sample'}:{onOpen:()=>void;reduced?:boolean;recipient?:string;compact?:boolean;replayKey?:string}){
 const calm=useCalmMotion()||reduced;const present=useIsPresent();
 const [opening,setOpening]=useState(false),[played,setPlayed]=useState(false),[tilt,setTilt]=useState({x:0,y:0}),[visible,setVisible]=useState(true);
 const stage=useRef<HTMLDivElement>(null),inView=useInView(stage,{amount:.1});
 const presentRef=useRef(present);presentRef.current=present;
 const onOpenRef=useRef(onOpen);onOpenRef.current=onOpen;
 const sequence=useRef<ReturnType<typeof createRevealController>|null>(null);
 const sessionKey='donjai-reveal:'+replayKey;
 useEffect(()=>{if(!present){sequence.current?.dispose();sequence.current=null;setOpening(false);return;}try{setPlayed(sessionStorage.getItem(sessionKey)==='opened');}catch{setPlayed(false);}setOpening(false);const c=createRevealController(()=>{if(!presentRef.current)return;setOpening(false);setPlayed(true);try{sessionStorage.setItem(sessionKey,'opened');}catch{/* Optional replay preference. */}onOpenRef.current();});sequence.current=c;return()=>{c.dispose();if(sequence.current===c)sequence.current=null;};},[sessionKey,present]);
 useEffect(()=>{const changed=()=>setVisible(!document.hidden);changed();document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[]);
 useEffect(()=>{if(calm&&opening)sequence.current?.skip();},[calm,opening]);
 function open(replay=false){const c=sequence.current;if(!present||!c||c.isRunning())return;setTilt({x:0,y:0});const immediate=calm||(played&&!replay);setOpening(!immediate);c.start(immediate);}
 function skip(){if(!present)return;setTilt({x:0,y:0});sequence.current?.skip();}
 return <div className={`gift-teaser ${compact?'compact':''} ${opening?'is-opening':''} ${!visible||!inView||calm||opening?'motion-paused':''}`}>
 <div className="collage-stage" ref={stage} onPointerMove={e=>{if(e.pointerType!=='mouse'||calm||opening)return;const r=e.currentTarget.getBoundingClientRect();setTilt({x:Math.max(-5,Math.min(5,(e.clientY-r.top-r.height/2)/32)),y:Math.max(-7,Math.min(7,(e.clientX-r.left-r.width/2)/32))});}} onPointerLeave={()=>setTilt({x:0,y:0})}>
 {!compact&&<><span className="handwritten teaser-note">a little something,<br/>just for you.</span><div className="polaroid floating-photo"><div className="tape"/><img src="/images/couple.jpg" alt="ตัวอย่างภาพคู่รัก"/><span>you, me & all our little days</span></div><div className="memory-ticket"><span>OUR LITTLE STORY</span><strong>365</strong><small>days of us ♡</small></div><span className="sparkle s1" aria-hidden="true">✧</span><span className="sparkle s2" aria-hidden="true">✦</span><span className="sparkle s3" aria-hidden="true">+</span></>}
 <div className="ambient-magic" aria-hidden="true"><i/><i/><i/><i/><i/></div>
 <button className="envelope-control" onClick={()=>open()} disabled={opening} aria-label={`เปิดของขวัญถึง ${recipient}`} style={{transform:`perspective(900px) rotateX(${-tilt.x}deg) rotateY(${tilt.y}deg)`}}>
 <div className="envelope-float"><div className="envelope-shadow"/><div className="envelope-back"/><div className="envelope-letter"><span className="handwritten">Dear {recipient},</span><span>มีอะไรบางอย่าง</span><strong>อยากให้เธอดู ♡</strong><div className="letter-lines"/></div><div className="envelope-flap"/><div className="envelope-front"><span className="envelope-to">ถึง {recipient} <Heart size={14}/></span><span className="envelope-from">with a little love</span></div><div className="wax-seal"><Heart size={23} fill="currentColor" strokeWidth={1}/></div><MagicBurst/></div></button>
 <span className="teaser-caption">sealed with a whole lot of love</span></div>
 <button className="try-gift" onClick={()=>open()} disabled={opening}>{opening?<><Sparkles size={17}/> กำลังเปิดความรู้สึกดี ๆ…</>:<>{played?'เปิดของขวัญอีกครั้ง':'ลองเปิดของขวัญ'} <ArrowUpRight size={18}/></>}</button>
 <span className="try-note" aria-live="polite">{opening?'เปิดซอง · เลื่อนจดหมาย · เผยข้อความ':played?'กลับมาเปิดอีกครั้งได้เลย โดยไม่ต้องรอเอฟเฟกต์':'ลองเป็นคนรับสักครั้ง · ไม่ต้องสมัครสมาชิก'}</span>
 <div className="reveal-options"><button className="skip-reveal" onClick={skip}>{opening?'ข้ามเอฟเฟกต์เลย':compact?'ดูของขวัญเลย':'ข้ามเอฟเฟกต์ ดูตัวอย่างเลย'}</button>{played&&!calm&&!opening&&<button className="replay-reveal" onClick={()=>open(true)}><RotateCcw size={10}/> เล่นเอฟเฟกต์อีกครั้ง</button>}</div>
 </div>;
}
