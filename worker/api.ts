import {validateGift,publishSnapshot} from '../lib/domain';
import {encryptGift,decryptGift,digest} from '../lib/crypto';
interface Stored {etag?:string;json():Promise<any>;}
interface Store {get(key:string):Promise<Stored|null>;put(key:string,value:string,options?:{onlyIf?:{etagDoesNotMatch?:string;etagMatches?:string}}):Promise<unknown>;delete(key:string):Promise<unknown>;list(args:{prefix:string}):Promise<{objects:{key:string}[]}>;}
export interface Env {BUCKET:Store;}
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const read=async(s:Store,k:string)=>(await s.get(k))?.json();
const queues=new WeakMap<Store,Map<string,Promise<unknown>>>();
async function locked<T>(store:Store,key:string,operation:()=>Promise<T>):Promise<T>{
 let queue=queues.get(store);if(!queue){queue=new Map();queues.set(store,queue);}const previous=queue.get(key)||Promise.resolve();
 const next=previous.catch(()=>{}).then(async()=>{
  const lockKey='locks/'+key,token=crypto.randomUUID();let acquired=false;
  for(let n=0;n<30;n++){
   const entry=await store.get(lockKey);const existing=await entry?.json();
   const options=existing&&existing.until<Date.now()&&entry?.etag?{onlyIf:{etagMatches:entry.etag}}:{onlyIf:{etagDoesNotMatch:'*'}};
   const result=await store.put(lockKey,JSON.stringify({token,until:Date.now()+120000}),options);
   if(result!==null){acquired=true;break;}await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!acquired)throw new Error('มีการบันทึกจากอีกหน้าต่างอยู่ กรุณาลองใหม่');
  try{return await operation();}finally{const current=await read(store,lockKey);if(current?.token===token)await store.delete(lockKey);}
 });queue.set(key,next);try{return await next;}finally{if(queue.get(key)===next)queue.delete(key);}
}
export async function handleApi(r:Request,env:Env):Promise<Response>{
 try {
  const u=new URL(r.url),parts=u.pathname.split('/').filter(Boolean);
  if(parts[1]==='health')return response({storage:!!env.BUCKET,mode:'demo'});
  if(!env.BUCKET)return response({error:'พื้นที่เก็บข้อมูลออนไลน์ยังไม่พร้อม ข้อมูลฉบับร่างยังอยู่ในเครื่อง'},503);
  if(!['GET','HEAD'].includes(r.method)){const origin=r.headers.get('origin');if(origin&&origin!==u.origin)return response({error:'ไม่อนุญาตคำขอจากเว็บไซต์อื่น'},403);if(Number(r.headers.get('content-length')||0)>7000000)return response({error:'ข้อมูลใหญ่เกิน 6 MB'},413);}
  if(parts[1]==='open'){
   const id=parts[2];if(!id||!/^[-\w]{8,80}$/.test(id))return response({error:'ไม่พบของขวัญนี้'},404);
   const pub=await read(env.BUCKET,'published/'+id);if(!pub)return response({error:'ของขวัญนี้ยังไม่เผยแพร่ หรือถูกยกเลิกแล้ว'},404);
   if(r.method==='GET')return response(pub.sealed?{locked:true,hint:pub.hint}:{locked:false,gift:pub.gift});
   if(r.method!=='POST')return response({error:'ไม่รองรับคำขอนี้'},405);
   if(!pub.sealed)return response({gift:pub.gift});
   const body=await r.json() as any;if(typeof body.password!=='string'||body.password.length>128)return response({error:'กรุณาใส่รหัสให้ถูกต้อง'},400);
   const ip=r.headers.get('cf-connecting-ip')||'shared';const attemptKey='attempts/'+id+'/'+await digest(ip);
   return await locked(env.BUCKET,'unlock/'+id+'/'+await digest(ip),async()=>{
    // Re-read publication after acquiring the lock; unpublishing is checked again before release.
    const live=await read(env.BUCKET,'published/'+id);if(!live)return response({error:'ของขวัญนี้ถูกยกเลิกเผยแพร่แล้ว'},404);
    const now=Date.now(),attempts=await read(env.BUCKET,attemptKey);if(attempts&&attempts.until>now&&attempts.count>=5)return response({error:'ลองรหัสหลายครั้งแล้ว รออีก 10 นาทีก่อนลองใหม่'},429);
    await env.BUCKET.put(attemptKey,JSON.stringify({count:attempts&&attempts.until>now?attempts.count+1:1,until:attempts&&attempts.until>now?attempts.until:now+600000}));
    try{const gift=live.sealed?await decryptGift(live.sealed,body.password):live.gift;if(!await read(env.BUCKET,'published/'+id))return response({error:'ของขวัญนี้ถูกยกเลิกเผยแพร่แล้ว'},404);await env.BUCKET.delete(attemptKey);return response({gift});}catch{return response({error:'รหัสยังไม่ถูกนะ ลองดูคำใบ้อีกครั้ง ♡'},401);}
   });
  }
  if(parts[1]!=='gifts')return response({error:'ไม่พบเส้นทางนี้'},404);
  const identity=r.headers.get('oai-authenticated-user-id');if(!identity)return response({error:'กรุณาเข้าสู่ระบบก่อนจัดการของขวัญ'},401);
  const owner=await digest('account:'+identity);
  if(parts.length===2&&r.method==='GET'){const list=await env.BUCKET.list({prefix:'drafts/'+owner+'/'});const gifts=await Promise.all(list.objects.map(o=>read(env.BUCKET,o.key)));return response({gifts:gifts.filter(Boolean).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))});}
  const id=parts[2];if(!id||!/^[-\w]{8,80}$/.test(id))return response({error:'รหัสของขวัญไม่ถูกต้อง'},400);
  const action=async()=>{
   const ownerKey='ownership/'+id,ownership=await read(env.BUCKET,ownerKey);
   if(ownership&&ownership.owner!==owner)return response({error:'คุณไม่มีสิทธิ์แก้ไขของขวัญชิ้นนี้'},403);
   if(ownership?.deleted)return response({error:'ของขวัญชิ้นนี้ถูกลบแล้ว'},r.method==='GET'?404:410);
   const key='drafts/'+owner+'/'+id,current=await read(env.BUCKET,key);
   if(parts[3]==='publish'){
    if(!current)return response({error:'กรุณาบันทึกฉบับร่างก่อนเผยแพร่'},404);
    if(r.method==='DELETE'){await env.BUCKET.delete('published/'+id);const next={...current,publishedAt:undefined,passwordProtected:false};await env.BUCKET.put(key,JSON.stringify(next));return response({gift:next});}
    if(r.method!=='POST')return response({error:'ไม่รองรับคำขอนี้'},405);
    const body=await r.json() as any,password=body.password||'';if(typeof password!=='string'||password.length>128||(password&&password.length<4))return response({error:'รหัสต้องมี 4–128 ตัวอักษร'},400);
    const gift={...publishSnapshot(current),passwordProtected:Boolean(password),hint:String(body.hint||'').slice(0,300)};
    const pub=password?{sealed:await encryptGift(gift,password),hint:gift.hint}:{gift};await env.BUCKET.put('published/'+id,JSON.stringify(pub));await env.BUCKET.put(key,JSON.stringify(gift));return response({gift,url:'/?gift='+id});
   }
   if(r.method==='GET')return current?response({gift:current}):response({error:'ไม่พบฉบับร่างนี้'},404);
   if(r.method==='PUT'){const raw=await r.text();if(raw.length>6500000)return response({error:'ข้อมูลใหญ่เกิน 6 MB'},413);const gift=validateGift(JSON.parse(raw));if(gift.id!==id)return response({error:'รหัสของขวัญไม่ตรงกัน'},400);if(current&&gift.updatedAt<current.updatedAt)return response({error:'พบฉบับร่างใหม่กว่าจากอีกหน้าต่าง กรุณาดาวน์โหลดสำรองแล้วเปิดของขวัญใหม่อีกครั้ง'},409);const saved={...gift,publishedAt:current?.publishedAt,passwordProtected:current?.passwordProtected};if(!ownership)await env.BUCKET.put(ownerKey,JSON.stringify({owner}));await env.BUCKET.put(key,JSON.stringify(saved));return response({gift:saved});}
   if(r.method==='DELETE'){if(!current)return response({error:'ไม่พบของขวัญนี้'},404);await env.BUCKET.put(ownerKey,JSON.stringify({owner,deleted:true}));await env.BUCKET.delete('published/'+id);await env.BUCKET.delete(key);return response({deleted:true});}
   return response({error:'ไม่รองรับคำขอนี้'},405);
  };
  return r.method==='GET'?await action():await locked(env.BUCKET,'gift/'+id,action);
 }catch(e){return response({error:e instanceof Error?e.message:'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง'},400);}
}
