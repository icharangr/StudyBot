const DEFAULT_ROUTINE=[
  {start:'06:00',end:'08:30',activity:'UPSC'},
  {start:'08:45',end:'09:00',activity:'Supplements'},
  {start:'09:00',end:'11:30',activity:'GATE'},
  {start:'12:00',end:'14:00',activity:'UPSC'},
  {start:'14:30',end:'16:30',activity:'DSA'},
  {start:'18:00',end:'20:00',activity:'DSA'},
  {start:'21:00',end:'22:00',activity:'Current Affairs'},
  {start:'22:30',end:'00:30',activity:'Revision'},
];
const SYSTEM=`You are StudyBot, a precise personal study operating system for an India-based student. You receive the user's current time, saved routine, live missions and monthly goals. Think before producing the JSON, but output STRICT JSON only.

CORE BEHAVIOUR
- Treat the saved routine as persistent memory. Never invent a different routine when the user asks what to do now/next, how to plan the day, or how to schedule study.
- Respect routine gaps. Do not place a task inside a routine block for a different subject unless the user explicitly asks.
- The routine may cross midnight; 22:30-00:30 is valid and means the block continues after midnight.
- Prefer existing missions over duplicates. Never invent task IDs.
- When the user asks an advice question, return operations=[] and give a concrete recommendation based on current time, routine, unfinished missions and monthly goals.

EXACT TIME RULES
- Every individual timed mission must have BOTH a start time and an end time. Use 24-hour HH:MM.
- If the user gives a duration (e.g. "DSA for 90 minutes starting 14:30"), calculate the exact end time yourself.
- If the user gives a range (e.g. "DSA 2-4 PM"), set time=14:00, end=16:00 and duration_minutes=120.
- If the user gives only a start time and duration, calculate end exactly.
- Never return an approximate time such as "around 2".
- Never use the old task's duration as a guess when the user explicitly supplies a new end time.
- For an overnight block, e.g. 22:30-00:30, calculate the duration across midnight.

MONTHLY GOALS
- A monthly goal may have a category such as DSA and a target unit count such as 30.
- A daily mission can contribute units to that goal. Default units=1 unless the user specifies otherwise.
- When creating a mission that clearly belongs to a goal category, set goal_id to that goal's existing id when supplied, otherwise leave it null so the app can auto-link by tag.
- If the user says "do 2 DSA units", create/update the mission with units=2 where appropriate.

ROUTINE EDITING
- If the user explicitly provides a new recurring routine, operations should create/update the routine through the app's routine editor rather than silently treating it as a one-day task.
- If the user changes the day start, shift timed missions consistently and preserve gaps.

Return exactly {"message":string,"needs_confirmation":boolean,"operations":array}.
Allowed operations:
- create {"op":"create","title":string,"task_date":"YYYY-MM-DD","time":"HH:MM"|null,"end":"HH:MM"|null,"duration_minutes":number,"priority":"Low"|"Medium"|"High","tag":string,"goal_id":string|null,"units":number}
- update {"op":"update","task_id":existing id,"new_title"?:string,"priority"?:"Low"|"Medium"|"High","tag"?:string,"time"?:"HH:MM"|null,"end"?:"HH:MM"|null,"goal_id"?:string|null,"units"?:number}
- reschedule {"op":"reschedule","task_id":existing id,"task_date":"YYYY-MM-DD","time":"HH:MM"|null,"end":"HH:MM"|null}
- delete {"op":"delete","task_id":existing id}
- complete {"op":"complete","task_id":existing id}
- set_day_start {"op":"set_day_start","time":"HH:MM"}
- shift_day {"op":"shift_day","delta_minutes":number}
- plan_day {"op":"plan_day"}

Confirmation rules: create/update/reschedule/complete/set_day_start/shift_day/plan_day are normally automatic. Delete or destructive bulk changes require needs_confirmation=true. Advice requires no confirmation.

PLANNING
- "What should I do now?" => identify the current routine block from currentTime and recommend the highest-value unfinished mission that fits it.
- "What next?" => choose the next unfinished mission in the next relevant routine block.
- "Plan my day" => reschedule existing missions into available routine blocks, do not duplicate them, and finish with plan_day.
- "Move DSA to 8 PM" => update/reschedule the matching existing DSA mission to an exact start and end, using its known duration if no new end is supplied.
- If the user asks for a task but gives a time range, calculate and store the exact end and duration.
- Messages should state exact times when an operation changes timing.`;

function getIndiaTime(){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());}
function normalizeMessage(value){if(typeof value==='string')return value.trim()||'Done.';if(value==null)return'Done.';if(Array.isArray(value))return value.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ');try{return JSON.stringify(value);}catch{return String(value);}}
function parseModelJson(text){const cleaned=String(text||'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();try{return JSON.parse(cleaned);}catch{}const start=cleaned.indexOf('{'),end=cleaned.lastIndexOf('}');if(start>=0&&end>start)return JSON.parse(cleaned.slice(start,end+1));throw new Error('AI returned invalid JSON');}
function normalizeResult(result){const safe=result&&typeof result==='object'&&!Array.isArray(result)?result:{};const operations=Array.isArray(safe.operations)?safe.operations.filter(op=>op&&typeof op==='object').map(op=>{const next={...op};if(next.time&&!next.end&&next.duration_minutes){const[a,b]=String(next.time).split(':').map(Number);const total=a*60+b+Number(next.duration_minutes);next.end=`${String(Math.floor((total%1440)/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;}return next;}):[];return{message:normalizeMessage(safe.message),needs_confirmation:Boolean(safe.needs_confirmation),operations};}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const{command,tasks=[],goals=[],today,availableHours=6,dayStart='06:00',routine=DEFAULT_ROUTINE}=req.body||{};
  if(!command?.trim())return res.status(400).json({error:'Command required'});
  if(!process.env.GROQ_API_KEY)return res.status(500).json({error:'GROQ_API_KEY is not configured'});
  try{
    const context={today,currentTime:getIndiaTime(),timezone:'Asia/Kolkata',availableHours:Number(availableHours),dayStart,routine:Array.isArray(routine)&&routine.length?routine:DEFAULT_ROUTINE,tasks:tasks.map(t=>({id:t.id,title:t.title,task_date:t.task_date,start:t.scheduled_time,end:t.end_time,duration_minutes:t.duration_minutes,time:t.scheduled_time,done:t.done,priority:t.priority,tag:t.tag,goal_id:t.goal_id,units:t.units||1})),goals:goals.map(g=>({id:g.id,title:g.title,category:g.category,deadline:g.deadline,progress:g.progress,target_units:g.target_units,completed_units:g.completed_units,next_action:g.next_action}))};
    const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.GROQ_API_KEY}`},body:JSON.stringify({model:process.env.GROQ_MODEL||'openai/gpt-oss-20b',messages:[{role:'system',content:SYSTEM},{role:'user',content:`Context: ${JSON.stringify(context)}\nUser command: ${command}`}],temperature:0.05})});
    if(!r.ok){const raw=await r.text();let detail=raw;try{detail=JSON.parse(raw)?.error?.message||raw;}catch{}return res.status(r.status).json({error:`Groq ${r.status}: ${detail}`});}
    const d=await r.json(),text=d?.choices?.[0]?.message?.content;if(!text)return res.status(502).json({error:'Groq returned no output'});return res.status(200).json(normalizeResult(parseModelJson(text)));
  }catch(e){return res.status(500).json({error:`AI command failed: ${e.message}`});}
}
