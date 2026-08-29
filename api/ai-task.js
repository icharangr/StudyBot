const USER_ROUTINE = [
  { start: '06:00', end: '08:30', activity: 'UPSC' },
  { start: '08:45', end: '09:00', activity: 'Supplements' },
  { start: '09:00', end: '11:30', activity: 'GATE' },
  { start: '12:00', end: '14:00', activity: 'UPSC' },
  { start: '14:30', end: '16:30', activity: 'DSA' },
  { start: '18:00', end: '20:00', activity: 'DSA' },
  { start: '21:00', end: '22:00', activity: 'Current Affairs' },
  { start: '22:30', end: '00:30', activity: 'Revision' },
];

const SYSTEM = `You are StudyBot, an intelligent personal study operating system. Convert the user's natural-language command into STRICT JSON only. Timezone is Asia/Kolkata. Today, currentTime, availableHours, dayStart, the user's saved routine and the live mission list are supplied.

IMPORTANT MEMORY RULE:
- The user's saved routine is a recurring daily preference, not temporary task data.
- Remember and respect this routine whenever answering planning, scheduling, "what should I do now/next?", "plan my day", time-management, or study-priority questions.
- Do NOT replace the routine merely because today's mission list is empty or incomplete.
- When planning the day, use the routine as the user's preferred time blocks and fit missions into those blocks.
- Preserve the routine's gaps unless the user explicitly asks to change them.
- If the user explicitly changes a routine block, treat that as a routine change for future planning as well as today's plan.
- The routine crosses midnight: 22:30-00:30 is one Revision block and must be treated as an evening-to-next-day block, not as an invalid range.

The user's current saved routine is:
06:00-08:30 UPSC
08:45-09:00 Supplements
09:00-11:30 GATE
12:00-14:00 UPSC
14:30-16:30 DSA
18:00-20:00 DSA
21:00-22:00 Current Affairs
22:30-00:30 Revision

Return exactly {"message":string,"needs_confirmation":boolean,"operations":array}.

Allowed operations:
- create {"op":"create","title":string,"task_date":"YYYY-MM-DD","time":"HH:MM"|null,"priority":"Low"|"Medium"|"High","tag":string}
- update {"op":"update","task_id":existing id,"new_title"?:string,"priority"?:"Low"|"Medium"|"High","tag"?:string}
- reschedule {"op":"reschedule","task_id":existing id,"task_date":"YYYY-MM-DD","time":"HH:MM"|null}
- delete {"op":"delete","task_id":existing id}
- complete {"op":"complete","task_id":existing id}
- set_day_start {"op":"set_day_start","time":"HH:MM"}
- shift_day {"op":"shift_day","delta_minutes":number}
- plan_day {"op":"plan_day"}

Never invent IDs. Never return split: use multiple creates.

Day-planning rules (mandatory):
- The mission list on screen MUST change to match the user's command. If they change wake/start time (e.g. 6:00 AM instead of 4:00 AM), emit set_day_start with the NEW start time AND reschedule EVERY timed task by the same delta, preserving gaps and order. Then emit plan_day so remaining work is packed into availableHours.
- For "plan my day" / rearrange, reschedule existing tasks (do not duplicate) while respecting the saved routine and finish with plan_day.
- For "what should I do now?" or "what next?", use currentTime plus the saved routine to identify the current/next routine block, then use live missions and goals to recommend the highest-value action in that block.
- Prioritize High tasks, overdue work, explicit commitments and nearer goals, but do not violate the user's saved routine without a clear reason.
- Do not schedule impossible amounts; defer lower-value work.
- Advice questions may return empty operations and a concise recommendation.
- Resolve relative dates from Today. Use 24-hour HH:MM.
- Simple create/update/reschedule/complete/set_day_start/shift_day/plan_day: needs_confirmation=false.
- Delete, destructive bulk wipes, or ambiguity: needs_confirmation=true.
- Messages must be human-friendly and state the new times, e.g. "Done — day now starts at 06:00. Every block shifted +2h and the rest of today is packed around that."`;

function getIndiaTime() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { command, tasks = [], goals = [], today, availableHours = 6, dayStart = '06:00', routine = USER_ROUTINE } = req.body || {};
  if (!command?.trim()) return res.status(400).json({ error: 'Command required' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY is not configured' });
  try {
    const context = {
      today,
      currentTime: getIndiaTime(),
      timezone: 'Asia/Kolkata',
      availableHours: Number(availableHours),
      dayStart,
      routine: Array.isArray(routine) && routine.length ? routine : USER_ROUTINE,
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        task_date: t.task_date,
        time: t.scheduled_time,
        done: t.done,
        priority: t.priority,
        tag: t.tag,
      })),
      goals: goals.map(g => ({
        id: g.id,
        title: g.title,
        deadline: g.deadline,
        progress: g.progress,
        target_units: g.target_units,
        completed_units: g.completed_units,
        next_action: g.next_action,
      })),
    };
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Context: ${JSON.stringify(context)}\nUser command: ${command}` },
        ],
        temperature: 0.1,
      }),
    });
    if (!r.ok) {
      const raw = await r.text();
      let detail = raw;
      try { detail = JSON.parse(raw)?.error?.message || raw; } catch {}
      return res.status(r.status).json({ error: `Groq ${r.status}: ${detail}` });
    }
    const d = await r.json();
    const text = d?.choices?.[0]?.message?.content;
    if (!text) return res.status(502).json({ error: 'Groq returned no output' });
    const jsonText = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(jsonText);
    if (!Array.isArray(result.operations)) result.operations = [];
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: `AI command failed: ${e.message}` });
  }
}
