import { buildDailyPlan, minutesToTime, timeToMinutes } from './study-engine.js';

export const DEFAULT_DAY_START = '04:30';
const DAY = 24 * 60;

export function wrapMinutes(m) {
  return ((Math.round(m) % DAY) + DAY) % DAY;
}

export function parseClock(raw) {
  if (raw == null || raw === '') return null;
  const text = String(raw).trim().toLowerCase().replace(/\./g, '');
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const ap = (match[3] || '').toLowerCase();
  if (ap === 'pm' && hours < 12) hours += 12;
  if (ap === 'am' && hours === 12) hours = 0;
  if (!ap && hours === 24) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return minutesToTime(hours * 60 + minutes);
}

export function formatRange(start, durationMinutes) {
  const s = timeToMinutes(start);
  if (s == null) return 'Anytime';
  const dur = Math.max(0, Number(durationMinutes) || 0);
  if (dur < 20) return minutesToTime(s);
  return `${minutesToTime(s)}–${minutesToTime(wrapMinutes(s + dur))}`;
}

export function shiftClock(time, deltaMinutes) {
  const mins = timeToMinutes(time);
  if (mins == null) return time;
  return minutesToTime(wrapMinutes(mins + Number(deltaMinutes || 0)));
}

export function inferDayStartChange(command, currentStart = DEFAULT_DAY_START) {
  const text = String(command || '');
  if (!text.trim()) return null;

  const clocks = [...text.matchAll(/(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/gi)]
    .map(match => parseClock(match[1]))
    .filter(Boolean);

  const instead = text.match(/instead of\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i);
  const oldFromPhrase = instead ? parseClock(instead[1]) : null;

  const startPhrase = text.match(/(?:start(?:ing)?(?:\s+my)?\s+day|wake(?:\s+up)?|begin(?:\s+at)?)\s+(?:at\s+|from\s+)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i);
  const newFromPhrase = startPhrase ? parseClock(startPhrase[1]) : null;

  const mentionsShift = /start(?:ing)? my day|wake up|routine|shift|move all|push all|from \d|instead of|begin at/i.test(text);

  let nextStart = newFromPhrase;
  let prevStart = oldFromPhrase || currentStart;

  if (!nextStart && mentionsShift && clocks.length) {
    nextStart = oldFromPhrase ? clocks.find(t => t !== oldFromPhrase) || clocks[0] : clocks[0];
  }

  if (!nextStart || nextStart === prevStart) return null;

  const delta = wrapMinutes(timeToMinutes(nextStart) - timeToMinutes(prevStart || currentStart));
  const signed = timeToMinutes(nextStart) - timeToMinutes(prevStart || currentStart);
  return { newStart: nextStart, oldStart: prevStart, deltaMinutes: signed, wrapDelta: delta };
}

export function shiftTasks(tasks, deltaMinutes) {
  return (tasks || []).map(task => {
    if (!task.scheduled_time) return task;
    return { ...task, scheduled_time: shiftClock(task.scheduled_time, deltaMinutes) };
  }).sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99'));
}

export function planDayIntelligently(tasks, availableHours, day, now = new Date()) {
  const plan = buildDailyPlan(tasks, availableHours, day, now);
  const byId = new Map((tasks || []).map(t => [t.id, t]));
  const scheduled = new Set();
  const next = [];

  for (const item of plan.items) {
    const task = byId.get(item.task_id);
    if (!task) continue;
    scheduled.add(task.id);
    next.push({ ...task, task_date: item.task_date, scheduled_time: item.time });
  }

  for (const task of tasks || []) {
    if (scheduled.has(task.id)) continue;
    next.push(task);
  }

  return {
    tasks: next.sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99')),
    plan,
  };
}
