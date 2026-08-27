import React, { Component, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check, Clock, Plus, Sparkles, Target, LayoutDashboard, MessageCircle,
  Play, Pause, RotateCcw, AlarmClock, X, Send, Loader2, Trash2,
} from 'lucide-react';
import './styles.css';
import { supabase } from './lib/supabase';
import { timeToMinutes } from './lib/study-engine';
import { fetchKickQuote, pickKickQuote } from './lib/quotes';
import {
  DEFAULT_DAY_START,
  formatRange,
  inferDayStartChange,
  planDayIntelligently,
  shiftClock,
  shiftTasks,
} from './lib/day-planner';

const pad = n => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthStart = () => today().slice(0, 7) + '-01';
const daysUntil = d => Math.max(0, Math.ceil((new Date(d) - new Date()) / 86400000));
const normTime = t => (t ? String(t).slice(0, 5) : null);
const focusStorageKey = () => `studybot-focus-${today()}`;
const dayStartKey = 'studybot-day-start';

const ROUTINE_SEED = [
  ['UPSC', '04:30', '07:00', 'UPSC', 'High', 'U', 'upsc'],
  ['GATE', '07:00', '08:30', 'GATE', 'High', 'G', 'gate'],
  ['Supplements', '08:45', '08:45', 'Routine', 'Medium', 'S', 'routine'],
  ['GATE', '09:00', '11:00', 'GATE', 'High', 'G', 'gate'],
  ['Read / Re-Vision', '11:00', '12:00', 'Revision', 'High', 'R', 'study'],
  ['UPSC', '12:00', '14:00', 'UPSC', 'High', 'U', 'upsc'],
  ['Lunch', '14:00', '14:30', 'Routine', 'Low', 'L', 'routine'],
  ['DSA', '14:30', '17:00', 'DSA', 'High', 'D', 'dsa'],
  ['DSA', '18:00', '20:00', 'DSA', 'High', 'D', 'dsa'],
  ['Current Affairs', '21:00', '22:00', 'Current Affairs', 'High', 'C', 'study'],
  ['Bed', '23:00', '23:00', 'Routine', 'Low', 'B', 'routine'],
];

function shiftedRoutine(dayStart = DEFAULT_DAY_START) {
  const delta = (timeToMinutes(dayStart) ?? 4 * 60 + 30) - (timeToMinutes(DEFAULT_DAY_START) ?? 4 * 60 + 30);
  return ROUTINE_SEED.map(([title, start, end, tag, priority, icon, tone]) => {
    const nextStart = shiftClock(start, delta);
    const nextEnd = shiftClock(end, delta);
    const duration = Math.max(0, ((timeToMinutes(end) - timeToMinutes(start)) + 1440) % 1440);
    return {
      title,
      start: nextStart,
      end: nextEnd,
      duration,
      tag,
      priority,
      icon,
      tone,
      time: formatRange(nextStart, duration),
    };
  });
}

const TASK_TAGS = ['Personal', 'UPSC', 'GATE', 'DSA', 'Current Affairs', 'Revision', 'Routine'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const TAG_TONE = {
  UPSC: 'upsc', GATE: 'gate', DSA: 'dsa', 'Current Affairs': 'study',
  Revision: 'study', Routine: 'routine', Personal: 'college',
};
const QUICK_PROMPTS = [
  'Plan my day',
  'Start my day at 6:00 AM instead of 4:00 AM',
  'What should I do next?',
  'Move DSA to 8 PM',
];

function formatFocus(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function readFocusLog() {
  try { return JSON.parse(localStorage.getItem(focusStorageKey()) || '{}'); } catch { return {}; }
}

function writeFocusLog(log) {
  try { localStorage.setItem(focusStorageKey(), JSON.stringify(log)); } catch { /* ignore */ }
}

function FocusClock({ progress, active, onClick, label }) {
  const pct = Math.min(1, Math.max(0, Number(progress) || 0));
  const angle = pct * 360;
  return (
    <button
      type="button"
      className={`focus-clock ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <span
        className="focus-clock-face"
        style={{
          background: `conic-gradient(from -90deg, #9ec5ff 0deg ${angle}deg, #0a2463 ${angle}deg 360deg)`,
        }}
      />
    </button>
  );
}

class AppErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('StudyBot crash', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="shell">
          <main className="auth">
            <div className="auth-mark">!</div>
            <h1>StudyBot<span>.</span></h1>
            <p>Something went wrong while loading the dashboard.</p>
            <button className="primary-button" onClick={() => location.reload()}>Reload StudyBot</button>
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}

function Sheet({ title, onClose, onSubmit, submitLabel = 'Save', children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal sheet" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); onSubmit(); }}>
        <div className="between mb-10">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="task-list">{children}</div>
        <div className="row mt-12" style={{ gap: 10 }}>
          <button type="button" className="soft-button" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" style={{ flex: 1 }}>{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}

const SWIPE_TRIGGER = 72;
const SWIPE_MAX = 96;

function TaskRow({ item, done, disabled, onToggle, onDelete, focusedSeconds, focusProgress, focusing, onFocusToggle }) {
  const [dragX, setDragX] = useState(0);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const locked = useRef(null);
  const canSwipe = !!item.task && !item.template;

  const onPointerDown = e => {
    if (!canSwipe || e.target.closest('button')) return;
    dragging.current = true;
    locked.current = null;
    startX.current = e.clientX;
    startY.current = e.clientY;
  };
  const onPointerMove = e => {
    if (!canSwipe || !dragging.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (!locked.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      locked.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (locked.current !== 'x') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragX(Math.min(0, Math.max(dx, -SWIPE_MAX)));
  };
  const endDrag = () => {
    if (!canSwipe || !dragging.current) return;
    dragging.current = false;
    if (locked.current === 'x' && dragX <= -SWIPE_TRIGGER) onDelete(item.task.id);
    setDragX(0);
    locked.current = null;
  };

  return (
    <div className="task-swipe">
      {canSwipe && (
        <div className="task-swipe-action" style={{ opacity: Math.min(1, -dragX / SWIPE_TRIGGER) }}>
          <Trash2 size={18} />
        </div>
      )}
      <div
        className={`task-card ${done ? 'done' : ''} ${focusing ? 'focusing' : ''}`}
        style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: dragging.current ? 'none' : 'transform .2s ease' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="task-icon">{item.icon}</div>
        <div>
          <div className="task-name">{item.title}</div>
          <div className="task-time">{item.time}</div>
          <div className="pill-row">
            <span className={`pill cat-${item.tone}`}>{item.tag}</span>
            {focusedSeconds > 0 && <span className="focus-time">{formatFocus(focusedSeconds)} focused</span>}
            {item.task && !item.template && (
              <button type="button" className="icon-button" style={{ width: 24, height: 24, minHeight: 0 }} onClick={() => onDelete(item.task.id)} aria-label={`Delete ${item.title}`}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="check-wrap">
          <FocusClock
            progress={focusProgress}
            active={focusing}
            label={focusing ? `Pause focus on ${item.title}` : `Start focus on ${item.title}`}
            onClick={e => { e.stopPropagation(); onFocusToggle(item); }}
          />
          <button
            type="button"
            disabled={disabled}
            aria-pressed={done}
            aria-label={done ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`}
            className={`checkbox-button ${done ? 'checked' : ''}`}
            onPointerDown={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onToggle(item); }}
          >
            {done ? <Check size={18} /> : <span />}
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [tasks, setTasks] = useState([]);
  const [goals, setGoals] = useState([]);
  const [tab, setTab] = useState('today');
  const [quote, setQuote] = useState(() => pickKickQuote());
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState('');
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [timer, setTimer] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [hours, setHours] = useState(6);
  const [dayStart, setDayStart] = useState(() => {
    try { return localStorage.getItem(dayStartKey) || DEFAULT_DAY_START; } catch { return DEFAULT_DAY_START; }
  });
  const [focusLog, setFocusLog] = useState(() => readFocusLog());
  const [activeFocusId, setActiveFocusId] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', priority: 'Medium', tag: 'Personal', time: '' });
  const [goalForm, setGoalForm] = useState({ title: '', target: 1 });
  const [chatMessages, setChatMessages] = useState([
    { id: 'seed', role: 'bot', text: "Hey — I'm your StudyBot AI. Change your wake time, plan the day, move a block, or mark something done. The mission list will follow." },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  const quoteRef = useRef(quote);
  const activeFocusRef = useRef(null);
  const sessionStampRef = useRef(null);

  quoteRef.current = quote;
  activeFocusRef.current = activeFocusId;

  const flash = m => { setToast(String(m || 'Something went wrong')); setTimeout(() => setToast(''), 3500); };
  const persistDayStart = value => {
    setDayStart(value);
    try { localStorage.setItem(dayStartKey, value); } catch { /* ignore */ }
  };

  const refreshQuote = async () => {
    const next = await fetchKickQuote(quoteRef.current, supabase);
    setQuote(next);
  };

  useEffect(() => {
    refreshQuote();
    const onVis = () => { if (document.visibilityState === 'visible') refreshQuote(); };
    const onPageShow = () => refreshQuote();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refreshQuote);
    window.addEventListener('pageshow', onPageShow);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshQuote();
    }, 75000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', refreshQuote);
      window.removeEventListener('pageshow', onPageShow);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    let subscription;

    const bootstrap = async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        let session = sessionData?.session || null;

        if (!session) {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
          session = data?.session || null;
        }

        if (!cancelled) {
          setUser(session?.user || null);
          setAuthReady(true);
        }
      } catch (error) {
        console.error('Anonymous session bootstrap failed', error);
        if (!cancelled) {
          setUser(null);
          setAuthReady(true);
          flash('Could not start a private StudyBot session.');
        }
      }
    };

    bootstrap();
    const listener = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setUser(session?.user || null);
    });
    subscription = listener?.data?.subscription;

    return () => {
      cancelled = true;
      subscription?.unsubscribe?.();
    };
  }, []);

  const load = async () => {
    if (!supabase || !user) return;
    try {
      const [a, b, profile] = await Promise.all([
        supabase.from('tasks').select('*').eq('user_id', user.id).eq('task_date', today()).order('scheduled_time'),
        supabase.from('monthly_goals').select('*').eq('user_id', user.id).eq('month_start', monthStart()),
        supabase.from('profiles').select('day_start').eq('id', user.id).maybeSingle(),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      setTasks(a.data || []);
      setGoals(b.data || []);
      const remoteStart = normTime(profile.data?.day_start);
      if (remoteStart) persistDayStart(remoteStart);
      const nextLog = { ...readFocusLog() };
      for (const task of a.data || []) {
        const stored = Number(task.focus_seconds || 0);
        if (stored > (nextLog[task.id] || 0)) nextLog[task.id] = stored;
      }
      setFocusLog(nextLog);
      writeFocusLog(nextLog);
    } catch (error) {
      flash(error.message);
    }
  };

  useEffect(() => { if (authReady && user) load(); }, [authReady, user]);

  useEffect(() => {
    let current = today();
    const id = setInterval(() => {
      const now = today();
      if (now !== current) { current = now; load(); setFocusLog(readFocusLog()); }
    }, 60000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (!running) return;
    if (!sessionStampRef.current) sessionStampRef.current = new Date().toISOString();
    const id = setInterval(() => {
      setTimer(v => {
        if (v <= 1) {
          setRunning(false);
          return 0;
        }
        return v - 1;
      });
      const key = activeFocusRef.current;
      if (!key) return;
      setFocusLog(prev => {
        const next = { ...prev, [key]: (prev[key] || 0) + 1 };
        writeFocusLog(next);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, chatLoading, tab]);

  const persistFocusSeconds = async (taskId, seconds) => {
    if (!supabase || !user || !taskId || String(taskId).startsWith('template:')) return;
    const { error } = await supabase.from('tasks').update({ focus_seconds: seconds }).eq('id', taskId).eq('user_id', user.id);
    if (error && !/focus_seconds/i.test(error.message)) flash(error.message);
  };

  const saveStudySession = async (taskItem, minutes) => {
    if (!supabase || !user || minutes < 1) return;
    await supabase.from('study_sessions').insert({
      user_id: user.id,
      started_at: sessionStampRef.current || new Date().toISOString(),
      ended_at: new Date().toISOString(),
      minutes,
      subject: taskItem?.tag || taskItem?.title || 'Focus',
    });
  };

  const setFocusDuration = mins => {
    const clamped = Math.min(180, Math.max(1, Math.round(Number(mins) || 0)));
    setFocusMinutes(clamped);
    if (!running) setTimer(clamped * 60);
  };

  const routine = shiftedRoutine(dayStart);

  const findRoutineTask = r => tasks.find(t => t.title === r.title && normTime(t.scheduled_time) === r.start);

  const ensureTask = async r => {
    if (!supabase || !user) return null;
    const existing = findRoutineTask(r);
    if (existing) return existing;

    const { data, error } = await supabase.from('tasks').insert({
      user_id: user.id,
      title: r.title,
      task_date: today(),
      scheduled_time: r.start,
      priority: r.priority,
      tag: r.tag,
      source: 'routine',
      done: false,
    }).select().single();

    if (error) {
      flash(error.message);
      return null;
    }
    setTasks(v => [...v, data].sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || '')));
    return data;
  };

  const toItem = (task, template) => {
    const start = normTime(task.scheduled_time) || template?.start;
    const duration = Number(task.duration_minutes) || template?.duration || 0;
    return {
      key: task.id || `template:${template?.title}:${template?.start}`,
      title: task.title,
      time: start ? formatRange(start, duration) : 'Anytime',
      tag: task.tag,
      tone: TAG_TONE[task.tag] || template?.tone || 'routine',
      icon: template?.icon || (task.tag || 'T')[0],
      template: !task.id,
      task: task.id ? task : null,
      focusKey: task.id || `template:${template?.title}:${template?.start}`,
    };
  };

  const allItems = tasks.length
    ? [...tasks]
      .sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99'))
      .map(task => {
        const template = routine.find(r => r.title === task.title && r.start === normTime(task.scheduled_time))
          || routine.find(r => r.title === task.title);
        return toItem(task, template);
      })
    : routine.map(r => toItem({ title: r.title, scheduled_time: r.start, tag: r.tag, priority: r.priority }, r));

  const totalCount = allItems.length;
  const completedCount = allItems.filter(i => i.task?.done).length;
  const completionPct = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;
  const sessionLength = Math.max(1, focusMinutes * 60);
  const sessionConsumed = 1 - (timer / sessionLength);

  const toggleFocusFor = async item => {
    let task = item.task;
    if (!task && item.template) task = await ensureTask(routine.find(r => r.title === item.title && r.start === (normTime(item.time) || item.time.slice(0, 5))) || routine.find(r => r.title === item.title));
    const key = task?.id || item.focusKey;
    if (!key) return;

    if (activeFocusId === key && running) {
      setRunning(false);
      persistFocusSeconds(key, focusLog[key] || 0);
      const elapsedMin = Math.round((sessionLength - timer) / 60);
      saveStudySession(item, elapsedMin);
      return;
    }

    if (timer <= 0) setTimer(focusMinutes * 60);
    setActiveFocusId(key);
    sessionStampRef.current = new Date().toISOString();
    setRunning(true);
    flash(`Focus linked to ${item.title}`);
  };

  const toggleItem = async item => {
    if (saving) return;
    if (!supabase) return;
    if (!user) { flash('Still connecting — give it a second and tap again.'); return; }
    setSaving('task');
    let task = item.task;
    const previousDone = task?.done ?? false;

    try {
      if (!task) {
        const seed = routine.find(r => r.title === item.title);
        if (seed) task = await ensureTask(seed);
      }
      if (!task) throw new Error('Task could not be created.');

      const next = !previousDone;
      setTasks(v => v.map(t => (t.id === task.id ? { ...t, done: next } : t)));

      const { data, error } = await supabase.from('tasks')
        .update({ done: next, completed_at: next ? new Date().toISOString() : null })
        .eq('id', task.id)
        .eq('user_id', user.id)
        .select('id,done,completed_at')
        .single();

      if (error) throw error;
      setTasks(v => v.map(t => (t.id === data.id ? { ...t, ...data } : t)));
      flash(next ? 'Task completed ✓' : 'Task reopened');
    } catch (error) {
      if (task) {
        setTasks(v => v.map(t => (t.id === task.id ? { ...t, done: previousDone } : t)));
      }
      flash('Could not save task: ' + error.message);
    } finally {
      setSaving('');
    }
  };

  const toggleGoal = async goal => {
    if (!supabase || !user || saving) return;
    setSaving(goal.id);
    const target = Math.max(1, Number(goal.target_units || 1));
    const wasDone = Number(goal.completed_units || 0) >= target;
    const nextUnits = wasDone ? 0 : target;
    setGoals(v => v.map(g => (g.id === goal.id ? { ...g, completed_units: nextUnits } : g)));
    try {
      const { error } = await supabase.from('monthly_goals').update({ completed_units: nextUnits }).eq('id', goal.id).eq('user_id', user.id);
      if (error) throw error;
      flash(wasDone ? 'Goal reopened' : 'Goal completed ✓');
    } catch (error) {
      setGoals(v => v.map(g => (g.id === goal.id ? goal : g)));
      flash('Could not save goal: ' + error.message);
    } finally {
      setSaving('');
    }
  };

  const submitGoal = async () => {
    const title = goalForm.title.trim();
    if (!title || !supabase || !user) return;
    const target = Math.max(1, Number(goalForm.target) || 1);
    const { error } = await supabase.from('monthly_goals').insert({
      user_id: user.id, month_start: monthStart(), title, target_units: target, completed_units: 0, color: 'blue',
    });
    if (error) flash(error.message); else { flash('Goal added'); load(); }
    setShowAddGoal(false);
    setGoalForm({ title: '', target: 1 });
  };

  const submitTask = async () => {
    const title = taskForm.title.trim();
    if (!title || !supabase || !user) return;
    const { error } = await supabase.from('tasks').insert({
      user_id: user.id, title, task_date: today(), scheduled_time: taskForm.time || null,
      priority: taskForm.priority, tag: taskForm.tag || 'Personal', source: 'manual', done: false,
    });
    if (error) flash(error.message); else { flash('Task added'); load(); }
    setShowAddTask(false);
    setTaskForm({ title: '', priority: 'Medium', tag: 'Personal', time: '' });
  };

  const deleteTask = async id => {
    if (!supabase || !user) return;
    const { error } = await supabase.from('tasks').delete().eq('id', id).eq('user_id', user.id);
    if (error) flash(error.message); else { setTasks(v => v.filter(t => t.id !== id)); flash('Task removed'); }
  };

  const loadRoutine = async () => {
    let failed = false;
    for (const r of shiftedRoutine(dayStart)) { if (!(await ensureTask(r))) failed = true; }
    if (!failed) flash(`Daily routine loaded from ${dayStart}.`);
  };

  const saveProfileStart = async time => {
    if (!supabase || !user) return;
    await supabase.from('profiles').upsert({ id: user.id, day_start: time, timezone: 'Asia/Kolkata' });
  };

  const applyDayStart = async (newStart, oldStart = dayStart) => {
    const from = normTime(oldStart) || dayStart;
    const to = normTime(newStart);
    if (!to) return;
    const delta = (timeToMinutes(to) ?? 0) - (timeToMinutes(from) ?? 0);
    persistDayStart(to);
    saveProfileStart(to);

    if (!tasks.length) {
      flash(`Day now starts at ${to}. Mission list shifted.`);
      return;
    }

    const next = shiftTasks(tasks, delta);
    setTasks(next);
    if (supabase && user) {
      for (const task of next) {
        const { error } = await supabase.from('tasks')
          .update({ scheduled_time: task.scheduled_time, task_date: task.task_date || today() })
          .eq('id', task.id)
          .eq('user_id', user.id);
        if (error) flash('Could not move a block: ' + error.message);
      }
    }
    flash(`Day now starts at ${to}. Every timed block moved with it.`);
  };

  const replanDay = async currentTasks => {
    const source = currentTasks || tasks;
    const { tasks: next, plan } = planDayIntelligently(source, hours, today());
    setTasks(next);
    if (supabase && user) {
      for (const task of next) {
        await supabase.from('tasks')
          .update({ scheduled_time: task.scheduled_time, task_date: task.task_date || today() })
          .eq('id', task.id)
          .eq('user_id', user.id);
      }
    }
    flash(plan.overloaded
      ? `Day packed. ${plan.deferred} lower-value block(s) could not fit into ${hours}h.`
      : `Day packed into ${hours} focused hours.`);
    return next;
  };

  const applyOperations = async ops => {
    let local = [...tasks];
    let planned = false;
    const bulkShift = ops.some(o => o.op === 'set_day_start' || o.op === 'shift_day');

    for (const op of ops) {
      try {
        if (op.op === 'create') {
          const row = {
            user_id: user.id, title: op.title, task_date: op.task_date || today(),
            scheduled_time: op.time || null, priority: op.priority || 'Medium',
            tag: op.tag || 'Personal', source: 'ai', done: false,
          };
          const { data, error } = await supabase.from('tasks').insert(row).select().single();
          if (error) throw error;
          local = [...local, data];
        } else if (op.op === 'update') {
          const patch = {};
          if (op.new_title) patch.title = op.new_title;
          if (op.priority) patch.priority = op.priority;
          if (op.tag) patch.tag = op.tag;
          if (Object.keys(patch).length) {
            const { error } = await supabase.from('tasks').update(patch).eq('id', op.task_id).eq('user_id', user.id);
            if (error) throw error;
            local = local.map(t => (t.id === op.task_id ? { ...t, ...patch } : t));
          }
        } else if (op.op === 'reschedule') {
          if (bulkShift) continue;
          const { error } = await supabase.from('tasks').update({ task_date: op.task_date || today(), scheduled_time: op.time || null }).eq('id', op.task_id).eq('user_id', user.id);
          if (error) throw error;
          local = local.map(t => (t.id === op.task_id ? { ...t, task_date: op.task_date || today(), scheduled_time: op.time || null } : t));
        } else if (op.op === 'delete') {
          const { error } = await supabase.from('tasks').delete().eq('id', op.task_id).eq('user_id', user.id);
          if (error) throw error;
          local = local.filter(t => t.id !== op.task_id);
        } else if (op.op === 'complete') {
          const { error } = await supabase.from('tasks').update({ done: true, completed_at: new Date().toISOString() }).eq('id', op.task_id).eq('user_id', user.id);
          if (error) throw error;
          local = local.map(t => (t.id === op.task_id ? { ...t, done: true } : t));
        } else if (op.op === 'set_day_start') {
          const to = normTime(op.time);
          if (to) {
            const delta = (timeToMinutes(to) ?? 0) - (timeToMinutes(dayStart) ?? 0);
            persistDayStart(to);
            saveProfileStart(to);
            local = shiftTasks(local, delta);
            for (const task of local) {
              await supabase.from('tasks').update({ scheduled_time: task.scheduled_time }).eq('id', task.id).eq('user_id', user.id);
            }
          }
        } else if (op.op === 'shift_day') {
          const delta = Number(op.delta_minutes) || 0;
          const nextStart = shiftClock(dayStart, delta);
          persistDayStart(nextStart);
          saveProfileStart(nextStart);
          local = shiftTasks(local, delta);
          for (const task of local) {
            await supabase.from('tasks').update({ scheduled_time: task.scheduled_time }).eq('id', task.id).eq('user_id', user.id);
          }
        } else if (op.op === 'plan_day') {
          planned = true;
        }
      } catch (e) {
        flash('AI action failed: ' + e.message);
      }
    }

    setTasks(local);
    if (planned) await replanDay(local);
    else await load();
  };

  const sendCommand = async text => {
    const command = (text ?? chatInput).trim();
    if (!command || chatLoading || !user) return;
    const userMsg = { id: crypto.randomUUID(), role: 'user', text: command };
    setChatMessages(v => [...v, userMsg]);
    setChatInput('');
    setChatLoading(true);
    const inferred = inferDayStartChange(command, dayStart);
    try {
      const res = await fetch('/api/ai-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, tasks, goals, today: today(), availableHours: hours, dayStart }),
      });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('AI endpoint is not reachable here.'); }
      if (!res.ok) throw new Error(data.error || 'AI request failed');
      const ops = Array.isArray(data.operations) ? data.operations : [];
      const needsConfirmation = !!data.needs_confirmation;
      const hasScheduleOps = ops.some(o => ['reschedule', 'shift_day', 'set_day_start', 'plan_day', 'create'].includes(o.op));
      setChatMessages(v => [...v, {
        id: crypto.randomUUID(), role: 'bot', text: data.message || 'Done.',
        operations: ops, needsConfirmation, resolved: !needsConfirmation,
      }]);
      if (ops.length && !needsConfirmation) await applyOperations(ops);
      if (!needsConfirmation && inferred && !hasScheduleOps) {
        await applyDayStart(inferred.newStart, inferred.oldStart);
        if (/plan|entire day|rest of (the )?day|intelligently/i.test(command)) await replanDay();
      }
    } catch (error) {
      if (inferred) {
        await applyDayStart(inferred.newStart, inferred.oldStart);
        if (/plan|entire day|rest of (the )?day/i.test(command)) await replanDay();
        setChatMessages(v => [...v, {
          id: crypto.randomUUID(),
          role: 'bot',
          text: `Mission list updated locally — day now starts at ${inferred.newStart}. ${error.message}`,
        }]);
      } else {
        setChatMessages(v => [...v, { id: crypto.randomUUID(), role: 'bot', text: "Couldn't reach the AI — " + error.message }]);
      }
    } finally {
      setChatLoading(false);
    }
  };

  const confirmMessage = async id => {
    const msg = chatMessages.find(m => m.id === id);
    if (!msg) return;
    await applyOperations(msg.operations);
    setChatMessages(v => v.map(m => (m.id === id ? { ...m, resolved: true } : m)));
    flash('Applied.');
  };
  const dismissMessage = id => setChatMessages(v => v.map(m => (m.id === id ? { ...m, resolved: true, dismissed: true } : m)));

  const activeItem = allItems.find(i => i.focusKey === activeFocusId || i.task?.id === activeFocusId);

  if (!authReady) {
    return (
      <div className="shell">
        <main className="auth loading-screen">
          <div className="auth-mark"><Loader2 className="spin" size={22} /></div>
          <h1>StudyBot<span>.</span></h1>
          <p className="muted">Preparing your private study space…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="top-panel">
        <div className="quote-banner">
          <Sparkles size={15} className="quote-icon" />
          <div className="quote">{quote}</div>
          <button type="button" className="icon-button" onClick={refreshQuote} aria-label="Fetch a new kick-start line"><Sparkles size={16} /></button>
        </div>
        <div className="hero-row mt-8">
          <div className="greeting">
            <h1>{tab === 'today' ? 'Good to see you.' : tab === 'chat' ? 'StudyBot AI' : tab === 'goals' ? 'Goals that matter' : 'Focus'}</h1>
            <div className="date-line">{today()} · day starts {dayStart}</div>
          </div>
        </div>
        <div className="mini-stats">
          <div className="stat-chip"><span>TODAY</span><strong>{completionPct}%</strong></div>
          <div className="stat-chip"><span>GATE 2027</span><strong>{daysUntil('2027-02-07')}d</strong></div>
          <div className="stat-chip"><span>UPSC 2027</span><strong>{daysUntil('2027-05-30')}d</strong></div>
        </div>
      </div>

      <div className="content">
        {tab === 'today' && (
          <>
            <div className="between">
              <div className="section-title" style={{ margin: 0 }}>Mission list</div>
              <button type="button" className="soft-button" onClick={() => setShowAddTask(true)}><Plus size={16} />Add</button>
            </div>
            <p className="muted small mt-8" style={{ marginBottom: 10 }}>{completedCount}/{totalCount} blocks complete. Tap the dark clock to start focus on that mission.</p>
            <div className="progress"><span style={{ width: completionPct + '%' }} /></div>

            <div className="task-list mt-12">
              {allItems.map(item => {
                const key = item.focusKey;
                const focusing = running && activeFocusId === key;
                const consumed = focusing ? sessionConsumed : Math.min(1, (focusLog[key] || 0) / sessionLength);
                return (
                  <TaskRow
                    key={item.key}
                    item={item}
                    done={!!item.task?.done}
                    disabled={saving === 'task' || !user}
                    onToggle={toggleItem}
                    onDelete={deleteTask}
                    focusedSeconds={focusLog[key] || 0}
                    focusProgress={consumed}
                    focusing={focusing}
                    onFocusToggle={toggleFocusFor}
                  />
                );
              })}
            </div>
            <p className="small muted mt-8" style={{ textAlign: 'center' }}>Swipe a task left to delete it.</p>
            <button type="button" className="soft-button mt-12" style={{ width: '100%', justifyContent: 'center' }} onClick={loadRoutine}>
              <AlarmClock size={16} />Load routine into today's tracker
            </button>
          </>
        )}

        {tab === 'goals' && (
          <>
            <div className="between">
              <div className="section-title" style={{ margin: 0 }}>Month</div>
              <button type="button" className="soft-button" onClick={() => setShowAddGoal(true)}><Plus size={16} />Add</button>
            </div>
            <div className="goals-list mt-12">
              {goals.length ? goals.map(goal => {
                const target = Math.max(1, Number(goal.target_units || 1));
                const done = Number(goal.completed_units || 0) >= target;
                const pct = done ? 100 : Math.round((Number(goal.completed_units || 0) / target) * 100);
                return (
                  <div className={`goal-card ${goal.color === 'blue' ? 'gate' : ''}`} key={goal.id}>
                    <div className="row" style={{ gap: 10 }}>
                      <button type="button" disabled={saving === goal.id || !user} className={`checkbox-button ${done ? 'checked' : ''}`} aria-pressed={done} onClick={() => toggleGoal(goal)}>
                        {done ? <Check size={18} /> : <span />}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div className="task-name" style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--text-secondary)' : 'inherit' }}>{goal.title}</div>
                        <div className="mini-progress mt-8"><span style={{ width: pct + '%' }} /></div>
                        <div className="small muted mt-8">{done ? 'Completed ✓' : `${goal.completed_units || 0}/${target} · ${pct}%`}</div>
                      </div>
                    </div>
                  </div>
                );
              }) : <div className="empty-state">Add the outcomes you want this month.</div>}
            </div>
          </>
        )}

        {tab === 'focus' && (
          <>
            <div className="grid-2">
              <div className="countdown-card" style={{ color: 'var(--accent-gate)' }}>
                <div className="countdown-label"><Target size={14} />GATE 2027</div>
                <div className="countdown-days">{daysUntil('2027-02-07')}</div>
                <div className="countdown-sub">days left · 07 Feb 2027</div>
              </div>
              <div className="countdown-card" style={{ color: 'var(--accent-upsc)' }}>
                <div className="countdown-label"><Target size={14} />UPSC CSE 2027</div>
                <div className="countdown-days">{daysUntil('2027-05-30')}</div>
                <div className="countdown-sub">days left · 30 May 2027</div>
              </div>
            </div>

            <div className="card mt-16">
              <div className="section-title" style={{ margin: '0 0 8px' }}>How much time do you actually have?</div>
              <div className="row" style={{ gap: 10 }}>
                <Clock size={18} />
                <input type="number" min="1" max="16" value={hours} onChange={e => setHours(e.target.value)} style={{ width: 70 }} />
                <span className="muted small">hours available today</span>
              </div>
              <button type="button" className="primary-button mt-12" style={{ width: '100%' }} onClick={() => replanDay()}>
                <Sparkles size={16} />Build my day
              </button>
            </div>

            <div className="card mt-16">
              <div className="between">
                <div className="section-title" style={{ margin: 0 }}>Focus timer</div>
                <div className="mono" style={{ fontSize: 24, color: 'var(--accent-gate)', fontWeight: 800 }}>
                  {String(Math.floor(timer / 60)).padStart(2, '0')}:{String(timer % 60).padStart(2, '0')}
                </div>
              </div>
              <p className="focus-linked">
                {activeItem ? `Linked to ${activeItem.title}${running ? ' · running' : ' · paused'}` : 'Tap a mission clock to attach this timer to that task.'}
              </p>

              <div className="duration-row mt-12">
                {[15, 25, 45, 60, 90].map(mins => (
                  <button
                    key={mins}
                    type="button"
                    disabled={running}
                    className={`duration-chip ${focusMinutes === mins ? 'active' : ''}`}
                    onClick={() => setFocusDuration(mins)}
                  >
                    {mins}m
                  </button>
                ))}
                <div className="duration-custom">
                  <input
                    type="number"
                    min="1"
                    max="180"
                    disabled={running}
                    value={focusMinutes}
                    onChange={e => setFocusDuration(e.target.value)}
                  />
                  <span className="muted small">min</span>
                </div>
              </div>

              <div className="row mt-12" style={{ gap: 10 }}>
                <button type="button" className="primary-button" style={{ flex: 1 }} onClick={() => {
                  if (!running && timer <= 0) setTimer(focusMinutes * 60);
                  if (!running) sessionStampRef.current = new Date().toISOString();
                  setRunning(v => !v);
                }}>
                  {running ? <Pause size={16} /> : <Play size={16} />}{running ? 'Pause' : 'Start'}
                </button>
                <button type="button" className="soft-button" style={{ flex: 1 }} onClick={() => { setRunning(false); setTimer(focusMinutes * 60); }}>
                  <RotateCcw size={16} />Reset
                </button>
              </div>
            </div>
          </>
        )}

        {tab === 'chat' && (
          <>
            <div className="chat-window">
              {chatMessages.map(m => (
                <div key={m.id} className={`message ${m.role}`}>
                  {m.role === 'bot' ? (
                    <div className="bot-row">
                      <div className="avatar"><MessageCircle size={16} /></div>
                      <div>
                        <div>{m.text}</div>
                        {m.needsConfirmation && !m.resolved && (
                          <div className="row mt-8" style={{ gap: 8 }}>
                            <button type="button" className="primary-button" style={{ minHeight: 36, padding: '6px 10px' }} onClick={() => confirmMessage(m.id)}>Confirm</button>
                            <button type="button" className="soft-button" style={{ minHeight: 36, padding: '6px 10px' }} onClick={() => dismissMessage(m.id)}>Cancel</button>
                          </div>
                        )}
                        {m.dismissed && <div className="small muted mt-8">Cancelled.</div>}
                      </div>
                    </div>
                  ) : m.text}
                </div>
              ))}
              {chatLoading && (
                <div className="message bot">
                  <div className="bot-row">
                    <div className="avatar"><Loader2 size={16} className="spin" /></div>
                    <div className="loading-dots"><span /><span /><span /></div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="quick-row mt-12">
              {QUICK_PROMPTS.map(q => (
                <button key={q} type="button" className="quick-chip" disabled={chatLoading} onClick={() => sendCommand(q)}>{q}</button>
              ))}
            </div>

            <div className="chat-compose">
              <input
                className="chat-input"
                placeholder="Ask StudyBot to plan, reschedule, or complete a task…"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendCommand(); }}
                disabled={chatLoading}
              />
              <button type="button" className="primary-button" style={{ padding: 0 }} disabled={chatLoading || !chatInput.trim()} onClick={() => sendCommand()}>
                <Send size={18} />
              </button>
            </div>
          </>
        )}
      </div>

      <nav className="tabbar">
        <button type="button" className={`tab-button ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>
          <LayoutDashboard className="tab-icon" size={18} /><span>Today</span>
        </button>
        <button type="button" className={`tab-button ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
          <MessageCircle className="tab-icon" size={18} /><span>AI Chat</span>
        </button>
        <button type="button" className={`tab-button ${tab === 'goals' ? 'active' : ''}`} onClick={() => setTab('goals')}>
          <Target className="tab-icon" size={18} /><span>Goals</span>
        </button>
        <button type="button" className={`tab-button ${tab === 'focus' ? 'active' : ''}`} onClick={() => setTab('focus')}>
          <Clock className="tab-icon" size={18} /><span>Focus</span>
        </button>
      </nav>

      {toast && <div className="toast-stack"><div className="toast">{toast}</div></div>}

      {showAddTask && (
        <Sheet title="Add task" onClose={() => setShowAddTask(false)} onSubmit={submitTask}>
          <div className="field full">
            <span>Title</span>
            <input autoFocus type="text" value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Revise Polity notes" />
          </div>
          <div className="form-grid">
            <div className="field">
              <span>Time (optional)</span>
              <input type="time" value={taskForm.time} onChange={e => setTaskForm(f => ({ ...f, time: e.target.value }))} />
            </div>
            <div className="field">
              <span>Priority</span>
              <select value={taskForm.priority} onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="field full">
            <span>Tag</span>
            <select value={taskForm.tag} onChange={e => setTaskForm(f => ({ ...f, tag: e.target.value }))}>
              {TASK_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </Sheet>
      )}

      {showAddGoal && (
        <Sheet title="Add monthly goal" onClose={() => setShowAddGoal(false)} onSubmit={submitGoal}>
          <div className="field full">
            <span>Goal</span>
            <input autoFocus type="text" value={goalForm.title} onChange={e => setGoalForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Finish 6 GATE PYQ sets" />
          </div>
          <div className="field full">
            <span>Target units / chapters</span>
            <input type="number" min="1" value={goalForm.target} onChange={e => setGoalForm(f => ({ ...f, target: e.target.value }))} />
          </div>
        </Sheet>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>);
