import { buildDailyPlan, minutesToTime, timeToMinutes } from './study-engine.js';

export const DEFAULT_DAY_START = '06:00';
const DAY = 24 * 60;
export function wrapMinutes(m) { return ((Math.round(m) % DAY) + DAY) % DAY; }
export function parseClock(raw) {
  if (raw == null || raw === '') return null;
  const match = String(raw).trim().toLowerCase().replace(/\./g, '').match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = Number(match[1]); const minutes = Number(match[2] || 0); const ap = (match[3] || '').toLowerCase();
  if (ap === 'pm' && hours < 12) hours += 12;
  if (ap === 'am' && hours === 12) hours = 0;
  if (!ap && hours === 24) hours = 0;
  return hours > 23 || minutes > 59 ? null : minutesToTime(hours * 60 + minutes);
}
export function formatRange(start, durationMinutes) {
  const s = timeToMinutes(start); if (s == null) return 'Anytime';
  const format12 = value => { const m = wrapMinutes(value); const h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
  const dur = Math.max(0, Number(durationMinutes) || 0);
  return dur < 20 ? format12(s) : `${format12(s)} – ${format12(s + dur)}`;
}
export function shiftClock(time, deltaMinutes) { const mins = timeToMinutes(time); return mins == null ? time : minutesToTime(wrapMinutes(mins + Number(deltaMinutes || 0))); }
export function inferDayStartChange(command, currentStart = DEFAULT_DAY_START) {
  const text = String(command || '');
  const clocks = [...text.matchAll(/(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/gi)].map(m => parseClock(m[1])).filter(Boolean);
  const instead = text.match(/instead of\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i);
  const oldStart = instead ? parseClock(instead[1]) : currentStart;
  const start = text.match(/(?:start(?:ing)?(?:\s+my)?\s+day|wake(?:\s+up)?|begin(?:\s+at)?)\s+(?:at\s+|from\s+)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i);
  const newStart = start ? parseClock(start[1]) : (instead ? clocks.find(t => t !== oldStart) : clocks[0]);
  return !newStart || newStart === oldStart ? null : { newStart, oldStart, deltaMinutes: timeToMinutes(newStart) - timeToMinutes(oldStart) };
}
export function shiftTasks(tasks, deltaMinutes) { return (tasks || []).map(t => !t.scheduled_time ? t : { ...t, scheduled_time: shiftClock(t.scheduled_time, deltaMinutes) }).sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99')); }
export function planDayIntelligently(tasks, availableHours, day, now = new Date()) {
  const plan = buildDailyPlan(tasks, availableHours, day, now); const byId = new Map((tasks || []).map(t => [t.id, t])); const scheduled = new Set(); const next = [];
  for (const item of plan.items) { const task = byId.get(item.task_id); if (task) { scheduled.add(task.id); next.push({ ...task, task_date: item.task_date, scheduled_time: item.time }); } }
  for (const task of tasks || []) if (!scheduled.has(task.id)) next.push(task);
  return { tasks: next.sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99')), plan };
}
