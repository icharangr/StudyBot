/* StudyBot app-level accounts. No Supabase Auth is used. */
const DB_KEY='studybot-app-db-v1',SESSION_KEY='studybot-session-v1',LEGACY_DB_KEY='studybot-local-db-v2';
const DEFAULT_QUOTES=[
 ['Stand up. Open the book. The next 25 minutes are not optional.',null],
 ['Your exam date is fixed. Your excuses are not. Start the block now.',null],
 ['Nobody is coming to rescue this syllabus. Sit down and finish the next page.',null],
 ['You already know what to do. Stop shopping for a feeling and start the timer.',null],
 ['GATE and UPSC do not care that you are tired. Open the notes.',null],
 ['If you wait until you feel ready, you will lose the year. Begin in the next 10 seconds.',null]
];
const uuid=()=>{try{return crypto.randomUUID();}catch{return 'local-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}};
function storage(){try{const k='__studybot_storage_test__';window.localStorage.setItem(k,'1');window.localStorage.removeItem(k);return window.localStorage;}catch{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}}
const store=storage();
const normalize=v=>String(v||'').trim().toLowerCase();
async function hashPasscode(value){const input=String(value||'');if(globalThis.crypto?.subtle&&typeof TextEncoder!=='undefined'){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join('');}let h=2166136261;for(let i=0;i<input.length;i+=1)h=Math.imul(h^input.charCodeAt(i),16777619);return `fallback-${(h>>>0).toString(16)}`;}
function userRow(id,identifier,passcodeHash){return{id,identifier,identifierType:identifier.includes('@')?'email':'phone',passcodeHash,displayName:'',timezone:'Asia/Kolkata',dayStart:'06:00',gateExamDate:'2027-02-07',upscExamDate:'2027-05-30',createdAt:new Date().toISOString()};}
function accountSeed(){return{tasks:[],monthly_goals:[],study_sessions:[],ai_command_log:[],quotes:DEFAULT_QUOTES.map(([quote,author])=>({id:uuid(),quote,author,active:true}))};}
function readDb(){try{const raw=store.getItem(DB_KEY);if(raw){const p=JSON.parse(raw);return{version:1,users:p.users||{},accounts:p.accounts||{}};}const legacyRaw=store.getItem(LEGACY_DB_KEY);const legacy=legacyRaw?JSON.parse(legacyRaw):null;if(legacy&&(legacy.tasks?.length||legacy.monthly_goals?.length||legacy.study_sessions?.length)){const id=uuid(),u=userRow(id,'migrated-local','legacy'),a=accountSeed();a.tasks=(legacy.tasks||[]).map(t=>({...t,user_id:id}));a.monthly_goals=(legacy.monthly_goals||[]).map(g=>({...g,user_id:id}));a.study_sessions=(legacy.study_sessions||[]).map(s=>({...s,user_id:id}));if(legacy.quotes?.length)a.quotes=legacy.quotes;return{version:1,users:{[id]:u},accounts:{[id]:a}};}}catch{}return{version:1,users:{},accounts:{}};}
let db=readDb();let sessionUserId=null;try{sessionUserId=store.getItem(SESSION_KEY);}catch{sessionUserId=null;}const listeners=new Set();
const persist=()=>{try{store.setItem(DB_KEY,JSON.stringify(db));}catch{}};
const currentUser=()=>sessionUserId?db.users[sessionUserId]||null:null;
const currentAccount=()=>sessionUserId?db.accounts[sessionUserId]||null:null;
const makeSession=u=>u?{user:u,access_token:`studybot-${u.id}`} : null;
function emit(event='SIGNED_IN'){const u=currentUser();for(const cb of listeners)cb(event,makeSession(u));}
function matches(row,filters){return filters.every(f=>{const v=row?.[f.column];if(f.op==='eq')return String(v)===String(f.value);if(f.op==='lt')return v<f.value;if(f.op==='lte')return v<=f.value;if(f.op==='gt')return v>f.value;if(f.op==='gte')return v>=f.value;return true;});}
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
function profileRow(u){return{id:u.id,display_name:u.displayName,timezone:u.timezone,gate_exam_date:u.gateExamDate,upsc_exam_date:u.upscExamDate,day_start:u.dayStart,created_at:u.createdAt};}
class LocalQuery{
 constructor(table){this.table=table;this.operation='select';this.values=null;this.filters=[];this.ordering=null;this.returnRows=false;this.singleMode=false;this.maybeSingleMode=false;}
 select(columns='*'){this.returnRows=true;this.columns=columns;return this;}
 insert(values){this.operation='insert';this.values=Array.isArray(values)?values:[values];return this;}
 update(values){this.operation='update';this.values=values||{};return this;}
 delete(){this.operation='delete';return this;}
 upsert(values){this.operation='upsert';this.values=Array.isArray(values)?values:[values];return this;}
 eq(column,value){this.filters.push({column,op:'eq',value});return this;}
 lt(column,value){this.filters.push({column,op:'lt',value});return this;}
 lte(column,value){this.filters.push({column,op:'lte',value});return this;}
 gt(column,value){this.filters.push({column,op:'gt',value});return this;}
 gte(column,value){this.filters.push({column,op:'gte',value});return this;}
 order(column,options={}){this.ordering={column,ascending:options.ascending!==false};return this;}
 single(){this.singleMode=true;return this;}
 maybeSingle(){this.maybeSingleMode=true;return this;}
 async execute(){
  if(!sessionUserId)return{data:null,error:{message:'Not signed in'}};
  const u=currentUser(),a=currentAccount();if(!u||!a)return{data:null,error:{message:'Account not found'}};
  if(this.table==='profiles'){
   const patch=Array.isArray(this.values)?(this.values[0]||{}):(this.values||{});
   if(this.operation==='select'){const rows=[profileRow(u)].filter(r=>matches(r,this.filters));if(this.singleMode)return rows.length===1?{data:rows[0],error:null}:{data:null,error:{message:'Profile not found'}};if(this.maybeSingleMode)return{data:rows[0]||null,error:null};return{data:rows,error:null};}
   if(patch.day_start)u.dayStart=patch.day_start;if(patch.display_name!=null)u.displayName=patch.display_name;if(patch.timezone)u.timezone=patch.timezone;if(patch.gate_exam_date)u.gateExamDate=patch.gate_exam_date;if(patch.upsc_exam_date)u.upscExamDate=patch.upsc_exam_date;persist();return{data:this.returnRows?profileRow(u):null,error:null};
  }
  const table=a[this.table];if(!Array.isArray(table))return{data:null,error:{message:`Unknown local table: ${this.table}`}};
  if(this.operation==='insert'){const now=new Date().toISOString(),rows=this.values.map(v=>({id:v.id||uuid(),created_at:v.created_at||now,user_id:sessionUserId,...v}));table.push(...rows);persist();return{data:this.returnRows?clone(this.singleMode?rows[0]:rows):null,error:null};}
  if(this.operation==='upsert'){const rows=[];for(const v of this.values){const match=table.find(r=>r.id===v.id);if(match)Object.assign(match,v);else{const row={id:v.id||uuid(),created_at:v.created_at||new Date().toISOString(),user_id:sessionUserId,...v};table.push(row);rows.push(row);continue;}rows.push(match);}persist();return{data:this.returnRows?clone(this.singleMode?rows[0]:rows):null,error:null};}
  if(this.operation==='update'){const matched=table.filter(r=>matches(r,this.filters));matched.forEach(r=>Object.assign(r,this.values));persist();return{data:this.returnRows?clone(this.singleMode?matched[0]:matched):null,error:null};}
  if(this.operation==='delete'){const matched=table.filter(r=>matches(r,this.filters));a[this.table]=table.filter(r=>!matches(r,this.filters));persist();return{data:this.returnRows?clone(matched):null,error:null};}
  let rows=table.filter(r=>matches(r,this.filters)).map(clone);if(this.ordering){const{column,ascending}=this.ordering;rows.sort((x,y)=>{const xv=x?.[column]??'',yv=y?.[column]??'',res=String(xv).localeCompare(String(yv),undefined,{numeric:true});return ascending?res:-res;});}if(this.singleMode){if(rows.length!==1)return{data:null,error:{message:'JSON object requested, multiple (or no) rows returned'}};return{data:rows[0],error:null};}if(this.maybeSingleMode){if(rows.length>1)return{data:null,error:{message:'JSON object requested, multiple rows returned'}};return{data:rows[0]||null,error:null};}return{data:rows,error:null};
 }
 then(resolve,reject){return this.execute().then(resolve,reject);}catch(reject){return this.execute().catch(reject);}
}
async function signUpWithPasscode(identifier,passcode){const idf=normalize(identifier),code=String(passcode||'');if(!idf)return{data:null,error:{message:'Email or phone is required.'}};if(code.length<4)return{data:null,error:{message:'Passcode must be at least 4 characters.'}};if(Object.values(db.users).some(u=>u.identifier===idf))return{data:null,error:{message:'An account with this email/phone already exists. Sign in instead.'}};const id=uuid(),u=userRow(id,idf,await hashPasscode(code));db.users[id]=u;db.accounts[id]=accountSeed();persist();sessionUserId=id;store.setItem(SESSION_KEY,id);emit();return{data:{user:u,session:makeSession(u)},error:null};}
async function signInWithPasscode(identifier,passcode){const idf=normalize(identifier),u=Object.values(db.users).find(x=>x.identifier===idf);if(!u)return{data:null,error:{message:'Account not found. Create an account first.'}};if(await hashPasscode(passcode)!==u.passcodeHash)return{data:null,error:{message:'Incorrect passcode.'}};sessionUserId=u.id;if(!db.accounts[u.id])db.accounts[u.id]=accountSeed();store.setItem(SESSION_KEY,u.id);emit();return{data:{user:u,session:makeSession(u)},error:null};}
async function getSession(){return{data:{session:makeSession(currentUser())},error:null};}
export const supabase={__localMode:true,from:table=>new LocalQuery(table),auth:{getSession,signUpWithPasscode,signInWithPasscode,onAuthStateChange:callback=>{listeners.add(callback);queueMicrotask(()=>callback?.(currentUser()?'SIGNED_IN':'SIGNED_OUT',makeSession(currentUser())));return{data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};},signOut:async()=>{sessionUserId=null;try{store.removeItem(SESSION_KEY);}catch{}emit('SIGNED_OUT');return{data:null,error:null};}}};
