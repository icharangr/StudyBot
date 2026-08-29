/* StudyBot app-level accounts backed by a shared Supabase database. No Supabase Auth is used. */
const FUNCTION_URL='https://wvzigkbmlbyjfxpikqhh.supabase.co/functions/v1/studybot-sync';
const SESSION_KEY='studybot-cloud-session-v1';
let token=null;
try { token=localStorage.getItem(SESSION_KEY); } catch { token=null; }
const listeners=new Set();
const emit=(event,session)=>listeners.forEach(cb=>cb(event,session));
const request=async body=>{
  const headers={'Content-Type':'application/json'};
  if(token) headers.Authorization=`Bearer ${token}`;
  const r=await fetch(FUNCTION_URL,{method:'POST',headers,body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({error:'Invalid server response'}));
  if(!r.ok) return {data:null,error:{message:data.error||`Request failed (${r.status})`}};
  return data;
};
const saveToken=t=>{token=t||null;try{if(token)localStorage.setItem(SESSION_KEY,token);else localStorage.removeItem(SESSION_KEY);}catch{}};

class RemoteQuery {
  constructor(table){this.table=table;this.operation='select';this.values=null;this.filters=[];this.ordering=null;this.returnRows=false;this.columns='*';this.singleMode=false;this.maybeSingleMode=false;}
  select(columns='*'){this.returnRows=true;this.columns=columns;return this;}
  insert(values){this.operation='insert';this.values=values;return this;}
  update(values){this.operation='update';this.values=values||{};return this;}
  delete(){this.operation='delete';return this;}
  upsert(values){this.operation='upsert';this.values=values;return this;}
  eq(column,value){this.filters.push({column,op:'eq',value});return this;}
  lt(column,value){this.filters.push({column,op:'lt',value});return this;}
  lte(column,value){this.filters.push({column,op:'lte',value});return this;}
  gt(column,value){this.filters.push({column,op:'gt',value});return this;}
  gte(column,value){this.filters.push({column,op:'gte',value});return this;}
  order(column,options={}){this.ordering={column,ascending:options.ascending!==false};return this;}
  single(){this.singleMode=true;return this;}
  maybeSingle(){this.maybeSingleMode=true;return this;}
  then(resolve,reject){return this.execute().then(resolve,reject);}
  catch(reject){return this.execute().catch(reject);}
  async execute(){
    return request({kind:'query',table:this.table,operation:this.operation,values:this.values,filters:this.filters,order:this.ordering,columns:this.columns,returnRows:this.returnRows,single:this.singleMode,maybeSingle:this.maybeSingleMode});
  }
}

async function signUpWithPasscode(identifier,passcode){
  const result=await request({kind:'auth',action:'signup',identifier,passcode});
  if(result.error)return result;
  saveToken(result.session?.access_token);
  emit('SIGNED_IN',result.session);
  return result;
}
async function signInWithPasscode(identifier,passcode){
  const result=await request({kind:'auth',action:'signin',identifier,passcode});
  if(result.error)return result;
  saveToken(result.session?.access_token);
  emit('SIGNED_IN',result.session);
  return result;
}
async function getSession(){
  if(!token)return {data:{session:null},error:null};
  const result=await request({kind:'auth',action:'session'});
  if(result.error){saveToken(null);return {data:{session:null},error:null};}
  return result;
}

export const supabase={
  __localMode:false,
  from:table=>new RemoteQuery(table),
  auth:{
    getSession,
    signUpWithPasscode,
    signInWithPasscode,
    onAuthStateChange:callback=>{listeners.add(callback);queueMicrotask(async()=>{const result=await getSession();callback?.(result.data?.session?'SIGNED_IN':'SIGNED_OUT',result.data?.session||null);});return{data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};},
    signOut:async()=>{const result=await request({kind:'auth',action:'signout'});saveToken(null);emit('SIGNED_OUT',null);return result;},
  },
};
