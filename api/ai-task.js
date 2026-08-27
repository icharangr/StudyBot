const SYSTEM = `You are StudyBot, an intelligent personal study operating system. Convert the user's natural-language command into STRICT JSON only. Timezone is Asia/Kolkata. Today, availableHours, dayStart and the live mission list are supplied.

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
- For "plan my day" / rearrange, reschedule existing tasks (do not duplicate) and finish with plan_day.
- Prioritize High tasks, overdue work, explicit commitments and nearer goals. Do not schedule impossible amounts; defer lower-value work.
- Advice questions may return empty operations and a concise recommendation.
- Resolve relative dates from Today. Use 24-hour HH:MM.
- Simple create/update/reschedule/complete/set_day_start/shift_day/plan_day: needs_confirmation=false.
- Delete, destructive bulk wipes, or ambiguity: needs_confirmation=true.
- Messages must be human-friendly and state the new times, e.g. "Done — day now starts at 06:00. Every block shifted +2h and the rest of today is packed around that."`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { command, tasks = [], goals = [], today, availableHours = 6, dayStart = '04:30' } = req.body || {};
  if (!command?.trim()) return res.status(400).json({ error: 'Command required' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY is not configured' });
  try {
    const context = {
      today,
      timezone: 'Asia/Kolkata',
      availableHours: Number(availableHours),
      dayStart,
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
