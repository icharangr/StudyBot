import React, { Component, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check, Clock, Plus, Sparkles, Target, LayoutDashboard, MessageCircle,
  Play, Pause, AlarmClock, X, Send, Loader2, Trash2,
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
const clearedDayKey = () => `studybot-cleared-${today()}`;
const dayStartKey = 'studybot-day-start';
const isDayCleared = () => {
  try { return localStorage.getItem(clearedDayKey()) === '1'; } catch { return false; }
};
const markDayCleared = cleared => {
  try {
    if (cleared) localStorage.setItem(clearedDayKey(), '1');
    else localStorage.removeItem(clearedDayKey());
  } catch { /* ignore */ }
};

const ROUTINE_SEED = [
  ['📚 UPSC', '06:00', '08:30', 'UPSC', 'High', '📚', 'upsc'],
  ['💊 Supplements', '08:45', '09:00', 'Routine', 'Medium', '💊', 'routine'],
  ['⚙️ GATE', '09:00', '11:30', 'GATE', 'High', '⚙️', 'gate'],
  ['📚 UPSC', '12:00', '14:00', 'UPSC', 'High', '📚', 'upsc'],
  ['💻 DSA', '14:30', '16:30', 'DSA', 'High', '💻', 'dsa'],
  ['💻 DSA', '18:00', '20:00', 'DSA', 'High', '💻', 'dsa'],
  ['🗞️ Current Affairs', '21:00', '22:00', 'Current Affairs', 'High', '🗞️', 'study'],
  ['📝 RE-Vision', '22:30', '00:30', 'Revision', 'High', '📝', 'study'],
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
const TAG_EMOJI = {
  UPSC: '📚', GATE: '⚙️', DSA: '💻', 'Current Affairs': '🗞️', Revision: '📝', Routine: '✨', Personal: '🧩',
};
const emojiFor = tag => TAG_EMOJI[tag] || '🎯';
const plainTitle = title => String(title || '').replace(/^[\u{1F000}-\u{1FAFF}\u2600-\u27BF]\uFE0F?\s*/u, '');
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

function formatClockHMS(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function durationFromRange(time, fallback = 25) {
  const text = String(time || '');
  const parts = text.split(/[–-]/).map(v => normTime(v.trim())).filter(Boolean);
  if (parts.length >= 2) {
    const a = timeToMinutes(parts[0]);
    const b = timeToMinutes(parts[1]);
    if (a != null && b != null) {
      const mins = b > a ? b - a : ((b - a) + 1440) % 1440;
      if (mins > 0) return mins;
    }
  }
  return Math.max(1, Number(fallback) || 25);
}

function readFocusLog() {
  try { return JSON.parse(localStorage.getItem(focusStorageKey()) || '{}'); } catch { return {}; }
}

function writeFocusLog(log) {
  try { localStorage.setItem(focusStorageKey(), JSON.stringify(log)); } catch { /* ignore */ }
}

function FocusClock({ progress, active, running, onClick, label }) {
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
      <span className="focus-clock-icon">
        {running ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
      </span>
    </button>
  );
}

function HeatMap({ title, days, history, onSelect, showWeekdays = false }) {
  const byDay = new Map();
  for (const task of history) {
    const list = byDay.get(task.task_date) || [];
    list.push(task);
    byDay.set(task.task_date, list);
  }
  return (
    <section className="heatmap" aria-label={title}>
      <div className="heatmap-head"><strong>{title}</strong><span>🔴 none · 🟠 partial · 🟢 complete</span></div>
      {showWeekdays && <div className="heatmap-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>}
      <div className="heatmap-grid">
        {days.map(day => {
          const list = byDay.get(day.key) || [];
          const future = day.key > today();
          const state = future ? 'purple' : !list.length ? 'red' : list.every(t => t.done) ? 'green' : 'orange';
          return <button type="button" className={`heat-cell ${state}`} key={day.key} onClick={() => onSelect(day.key)} title={`${day.label}: ${future ? 'future day' : !list.length ? 'no tasks' : list.every(t => t.done) ? 'all complete' : 'partially complete'}`}><span>{day.label}</span><b>{day.number}</b></button>;
        })}
      </div>
    </section>
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

function TaskRow({ item, done, disabled, onToggle, onDelete, onReorder, focusedSeconds, focusProgress, focusing, onFocusToggle }) {
  const [dragX, setDragX] = useState(0);
  const cardRef = useRef(null);
  const dragXRef = useRef(0);
  const dragging = useRef(false);
  const onDeleteRef = useRef(onDelete);
  const itemRef = useRef(item);
  onDeleteRef.current = onDelete;
  itemRef.current = item;

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let locked = null;
    let using = null;
    let longPress = null;
    let reordering = false;

    const point = e => {
      const t = e.touches?.[0] || e.changedTouches?.[0] || e;
      return { x: t.clientX, y: t.clientY };
    };
    const down = e => {
      if (e.type.startsWith('pointer') && e.pointerType !== 'mouse') return;
      if (e.target.closest('button')) return;
      const kind = e.type.startsWith('touch') ? 'touch' : 'pointer';
      if (using && using !== kind) return;
      using = kind;
      const p = point(e);
      dragging.current = true;
      locked = null;
      startX = p.x;
      startY = p.y;
      longPress = setTimeout(() => { reordering = true; el.classList.add('reordering'); navigator.vibrate?.(12); }, 450);
    };
    const move = e => {
      if (e.type.startsWith('pointer') && e.pointerType !== 'mouse') return;
      if (!dragging.current) return;
      const kind = e.type.startsWith('touch') ? 'touch' : 'pointer';
      if (using && using !== kind) return;
      const p = point(e);
      const dx = p.x - startX;
      const dy = p.y - startY;
      if (reordering) {
        if (Math.abs(dy) >= 48) { onReorder(itemRef.current, dy < 0 ? -1 : 1); startY = p.y; }
        e.preventDefault();
        return;
      }
      if (!locked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (locked !== 'x') return;
      e.preventDefault();
      const next = Math.min(0, Math.max(dx, -SWIPE_MAX));
      dragXRef.current = next;
      setDragX(next);
    };
    const up = e => {
      if (e?.type?.startsWith('pointer') && e.pointerType !== 'mouse') return;
      if (!dragging.current) return;
      const kind = e?.type?.startsWith('touch') ? 'touch' : 'pointer';
      if (using && kind && using !== kind) return;
      dragging.current = false;
      clearTimeout(longPress);
      el.classList.remove('reordering');
      reordering = false;
      using = null;
      if (locked === 'x' && dragXRef.current <= -SWIPE_TRIGGER) onDeleteRef.current(itemRef.current);
      dragXRef.current = 0;
      setDragX(0);
      locked = null;
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      clearTimeout(longPress);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, []);

  return (
    <div className="task-swipe">
      <div className="task-swipe-action" style={{ opacity: Math.min(1, -dragX / SWIPE_TRIGGER) }}>
        <Trash2 size={18} />
      </div>
      <div
        ref={cardRef}
        className={`task-card ${done ? 'done' : ''} ${focusing ? 'focusing' : ''} ${item.rolled ? 'rolled' : ''}`}
        style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: dragging.current ? 'none' : 'transform .2s ease' }}
      >
        <div className="task-icon">{item.icon}</div>
        <div>
          <div className="task-name">{item.title} <span className="drag-handle" aria-label="Long-press and drag to move this mission">⠿</span></div>
          <div className="task-time">{item.time}{item.durationMinutes ? ` · ${item.durationMinutes}m` : ''}</div>
          <div className="pill-row">
            <span className={`pill cat-${item.tone}`}>{item.tag}</span>
            {item.rolled && <span className="pill rollover-pill">↪ Rolled from yesterday</span>}
            {focusedSeconds > 0 && <span className="focus-time">{formatFocus(focusedSeconds)} focused</span>}
            <button type="button" className="icon-button" style={{ width: 24, height: 24, minHeight: 0 }} onClick={() => onDelete(item)} aria-label={`Delete ${item.title}`}>
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        <div className="check-wrap">
          <FocusClock
            progress={focusProgress}
            active={focusing}
            running={focusing}
            label={focusing ? `Pause focus on ${item.title}` : `Start ${item.durationMinutes || 25}m focus on ${item.title}`}
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
  const [weekHistory, setWeekHistory] = useState([]);
  const [monthHistory, setMonthHistory] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedDayTasks, setSelectedDayTasks] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [tab, setTab] = useState('today');
  const [quote, setQuote] = useState(() => pickKickQuote());
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState('');
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [timer, setTimer] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [hours, setHours] = useState(6);
  const [dayStart, setDayStart] = useState(() => {
    try {
      const saved = localStorage.getItem(dayStartKey);
      return saved === '04:30' ? DEFAULT_DAY_START : (saved || DEFAULT_DAY_START);
    } catch { return DEFAULT_DAY_START; }
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
  const [hydrated, setHydrated] = useState(false);
  const chatEndRef = useRef(null);
  const quoteRef = useRef(quote);
  const activeFocusRef = useRef(null);
  const sessionStampRef = useRef(null);
  const timerTickRef = useRef(Date.now());
  const tasksRef = useRef([]);
  const seededRef = useRef(false);

  quoteRef.current = quote;
  activeFocusRef.current = activeFocusId;
  tasksRef.current = tasks;

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
      const rollover = await supabase.from('tasks')
        .update({ task_date: today(), notes: 'rolled-over' })
        .eq('user_id', user.id).lt('task_date', today()).eq('done', false);
      if (rollover.error) throw rollover.error;
      const now = new Date();
      const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const weekFrom = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
      const monthFrom = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonth = `${previous.getFullYear()}-${pad(previous.getMonth() + 1)}-01`;
      const [a, b, priorGoals] = await Promise.all([
        supabase.from('tasks').select('*').eq('user_id', user.id).eq('task_date', today()).order('scheduled_time'),
        supabase.from('monthly_goals').select('*').eq('user_id', user.id).eq('month_start', monthStart()),
        supabase.from('monthly_goals').select('*').eq('user_id', user.id).eq('month_start', previousMonth),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      if (priorGoals.error) throw priorGoals.error;
      const currentGoals = b.data || [];
      const carryRows = (priorGoals.data || [])
        .filter(goal => Number(goal.completed_units || 0) < Number(goal.target_units || 1))
        .filter(goal => !currentGoals.some(existing => existing.title === goal.title))
        .map(goal => ({
          user_id: user.id, month_start: monthStart(), title: goal.title, category: goal.category,
          target_units: goal.target_units, completed_units: 0, deadline: goal.deadline,
          next_action: goal.next_action, progress: 0, color: 'purple',
        }));
      let carriedGoals = [];
      if (carryRows.length) {
        const carry = await supabase.from('monthly_goals').insert(carryRows).select();
        if (carry.error) throw carry.error;
        carriedGoals = carry.data || [];
      }
      setTasks(a.data || []);
      setGoals([...currentGoals, ...carriedGoals]);
      const history = await supabase.from('tasks').select('task_date,done').eq('user_id', user.id).gte('task_date', monthFrom).order('task_date');
      if (!history.error) {
        setWeekHistory((history.data || []).filter(t => t.task_date >= weekFrom));
        setMonthHistory(history.data || []);
      }
      setHydrated(true);
      try {
        const profile = await supabase.from('profiles').select('day_start').eq('id', user.id).maybeSingle();
        const remoteStart = normTime(profile.data?.day_start);
        if (remoteStart) persistDayStart(remoteStart === '04:30' ? DEFAULT_DAY_START : remoteStart);
      } catch { /* day_start column is optional on older schemas */ }
      const nextLog = { ...readFocusLog() };
      for (const task of a.data || []) {
        const stored = Number(task.focus_seconds || 0);
        if (stored > (nextLog[task.id] || 0)) nextLog[task.id] = stored;
      }
      setFocusLog(nextLog);
      writeFocusLog(nextLog);
    } catch (error) {
      setHydrated(true);
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
    timerTickRef.current = Date.now();
    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - timerTickRef.current) / 1000));
      if (!elapsed) return;
      timerTickRef.current += elapsed * 1000;
      setTimer(v => {
        if (v <= elapsed) {
          setRunning(false);
          return 0;
        }
        return v - elapsed;
      });
      const key = activeFocusRef.current;
      if (!key) return;
      setFocusLog(prev => {
        const next = { ...prev, [key]: (prev[key] || 0) + elapsed };
        writeFocusLog(next);
        return next;
      });
    };
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
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
    const clamped = Math.min(360, Math.max(1, Math.round(Number(mins) || 0)));
    setFocusMinutes(clamped);
    if (!running) setTimer(clamped * 60);
    return clamped;
  };

  const routine = shiftedRoutine(dayStart);

  const findRoutineTask = r => (tasksRef.current || []).find(t => t.title === r.title && normTime(t.scheduled_time) === r.start);

  const rememberTask = data => {
    if (!data) return data;
    const next = [...tasksRef.current.filter(t => t.id !== data.id), data]
      .sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));
    tasksRef.current = next;
    setTasks(next);
    return data;
  };

  const ensureTask = async r => {
    if (!r) return null;
    if (!supabase || !user) return null;
    const existing = findRoutineTask(r);
    if (existing) return existing;

    const row = {
      user_id: user.id,
      title: r.title,
      task_date: today(),
      scheduled_time: r.start,
      priority: r.priority || 'Medium',
      tag: r.tag || 'Personal',
      source: 'manual',
      done: false,
    };

    let { data, error } = await supabase.from('tasks').insert(row).select().single();
    if (error) {
      const lookup = await supabase.from('tasks').select('*')
        .eq('user_id', user.id).eq('task_date', today())
        .eq('title', r.title).eq('scheduled_time', r.start).maybeSingle();
      if (lookup.data) return rememberTask(lookup.data);
      const fallback = await supabase.from('tasks').insert({
        user_id: user.id,
        title: r.title,
        task_date: today(),
        scheduled_time: r.start,
        priority: 'Medium',
        tag: r.tag || 'Personal',
        source: 'manual',
        done: false,
      }).select().single();
      data = fallback.data;
      error = fallback.error;
    }
    if (error || !data) {
      flash(error?.message || 'Could not create this mission in your tracker.');
      return null;
    }
    return rememberTask(data);
  };

  const toItem = (task, template) => {
    const start = normTime(task.scheduled_time) || template?.start;
    const duration = Number(task.duration_minutes)
      || template?.duration
      || durationFromRange(template?.time || task.time, 25);
    const timeLabel = start ? formatRange(start, duration) : 'Anytime';
    return {
      key: task.id || `template:${template?.title}:${template?.start}`,
      title: plainTitle(task.title),
      time: timeLabel,
      start,
      durationMinutes: duration > 0 ? duration : durationFromRange(timeLabel, 25),
      tag: task.tag,
      tone: TAG_TONE[task.tag] || template?.tone || 'routine',
      icon: template?.icon || (task.tag || 'T')[0],
      template: !task.id,
      seed: template || null,
      task: task.id ? task : null,
      focusKey: task.id || `template:${template?.title}:${template?.start}`,
      rolled: task.notes === 'rolled-over',
    };
  };

  const allItems = [...tasks]
    .sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99'))
    .map(task => {
      const template = routine.find(r => r.title === task.title && r.start === normTime(task.scheduled_time))
        || routine.find(r => r.title === task.title);
      return toItem(task, template);
    });

  const totalCount = allItems.length;
  const completedCount = allItems.filter(i => i.task?.done).length;
  const completionPct = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;
  const focusedToday = Object.values(focusLog).reduce((n, s) => n + Number(s || 0), 0);

  const resolveItemTask = async item => {
    if (item.task?.id) return item.task;
    const seed = item.seed
      || routine.find(r => r.title === item.title && r.start === item.start)
      || routine.find(r => r.title === item.title);
    return seed ? ensureTask(seed) : null;
  };

  const toggleFocusFor = async item => {
    const task = await resolveItemTask(item);
    const key = task?.id || item.focusKey;
    if (!key) return;

    const blockMin = Math.min(360, Math.max(1, Number(item.durationMinutes) || durationFromRange(item.time, 25)));
    const blockSeconds = blockMin * 60;
    const already = Number(focusLog[key] || 0);
    const remaining = already >= blockSeconds ? blockSeconds : Math.max(1, blockSeconds - already);

    if (activeFocusId === key && running) {
      setRunning(false);
      persistFocusSeconds(key, focusLog[key] || 0);
      const elapsedMin = Math.max(1, Math.round((blockSeconds - timer) / 60));
      saveStudySession(item, elapsedMin);
      return;
    }

    setFocusMinutes(blockMin);
    setTimer(remaining);
    setActiveFocusId(key);
    sessionStampRef.current = new Date().toISOString();
    setRunning(true);
    flash(`${item.title}: ${blockMin}m focus block`);
  };

  const toggleItem = async item => {
    if (saving) return;
    if (!supabase) return;
    if (!user) { flash('Still connecting — give it a second and tap again.'); return; }
    setSaving('task');
    let task = item.task;
    const previousDone = task?.done ?? false;

    try {
      if (!task) task = await resolveItemTask(item);
      if (!task) throw new Error('This mission is not in your tracker yet. Wait a second and tap again.');

      const next = !previousDone;
      rememberTask({ ...task, done: next });

      const { data, error } = await supabase.from('tasks')
        .update({ done: next, completed_at: next ? new Date().toISOString() : null })
        .eq('id', task.id)
        .eq('user_id', user.id)
        .select('id,done,completed_at')
        .single();

      if (error) throw error;
      rememberTask({ ...task, ...data });
      flash(next ? 'Task completed ✓' : 'Task reopened');
    } catch (error) {
      if (task) rememberTask({ ...task, done: previousDone });
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
    if (error) flash(error.message);
    else {
      markDayCleared(false);
      flash('Task added');
      load();
    }
    setShowAddTask(false);
    setTaskForm({ title: '', priority: 'Medium', tag: 'Personal', time: '' });
  };

  const deleteTask = async id => {
    if (!supabase || !user || !id) return;
    const { error } = await supabase.from('tasks').delete().eq('id', id).eq('user_id', user.id);
    if (error) flash(error.message);
    else {
      const next = tasksRef.current.filter(t => t.id !== id);
      tasksRef.current = next;
      setTasks(next);
      if (!next.length) markDayCleared(true);
      flash(next.length ? 'Task removed' : 'All missions cleared for today.');
    }
  };

  const removeItem = async item => {
    const task = item.task?.id ? item.task : await resolveItemTask(item);
    if (!task?.id) { flash('This mission is not saved yet.'); return; }
    await deleteTask(task.id);
  };

  const reorderTask = async (item, direction) => {
    const current = item.task;
    if (!current?.id) return;
    const ordered = [...tasksRef.current].sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99'));
    const index = ordered.findIndex(t => t.id === current.id);
    const neighbour = ordered[index + direction];
    if (!neighbour) return;
    const currentTime = current.scheduled_time;
    const nextTime = neighbour.scheduled_time;
    const swapped = ordered.map(t => t.id === current.id ? { ...t, scheduled_time: nextTime } : t.id === neighbour.id ? { ...t, scheduled_time: currentTime } : t)
      .sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99'));
    tasksRef.current = swapped;
    setTasks(swapped);
    const [a, b] = await Promise.all([
      supabase.from('tasks').update({ scheduled_time: nextTime }).eq('id', current.id).eq('user_id', user.id),
      supabase.from('tasks').update({ scheduled_time: currentTime }).eq('id', neighbour.id).eq('user_id', user.id),
    ]);
    if (a.error || b.error) { flash('Could not move the mission.'); load(); }
  };

  const inspectDay = async day => {
    setSelectedDay(day);
    setHistoryLoading(true);
    if (!supabase || !user) { setSelectedDayTasks([]); setHistoryLoading(false); return; }
    const { data, error } = await supabase.from('tasks').select('*').eq('user_id', user.id).eq('task_date', day).order('scheduled_time');
    setSelectedDayTasks(error ? [] : (data || []));
    setHistoryLoading(false);
  };

  const dayHistoryPanel = selectedDay && (
    <div className="day-history card">
      <div className="between"><strong>📜 {selectedDay} history</strong><button type="button" className="icon-button" onClick={() => setSelectedDay(null)} aria-label="Close day history"><X size={16} /></button></div>
      {historyLoading ? <div className="small muted mt-8">Loading tasks…</div> : selectedDayTasks.length ? (
        <div className="day-history-list mt-8">{selectedDayTasks.map(task => <div key={task.id} className={`day-history-task ${task.done ? 'done' : ''}`}><span>{emojiFor(task.tag)} {plainTitle(task.title)}</span><small>{formatRange(normTime(task.scheduled_time), 0)} · {task.done ? '✅ done' : '⬜ pending'}</small></div>)}</div>
      ) : <div className="empty-state mt-8">No tasks are available for this day. 🌿</div>}
    </div>
  );

  const loadRoutine = async (quiet = false) => {
    markDayCleared(false);
    let failed = false;
    for (const r of shiftedRoutine(dayStart)) { if (!(await ensureTask(r))) failed = true; }
    if (!quiet && !failed) flash(`Daily routine loaded from ${dayStart}.`);
  };

  useEffect(() => {
    if (!hydrated || !user || seededRef.current) return;
    seededRef.current = true;
    if (!tasksRef.current.length && !isDayCleared()) loadRoutine(true);
  }, [hydrated, user]);

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
    markDayCleared(!local.length);
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
          text: `✅ Mission list updated — your day now starts at ${formatRange(inferred.newStart, 0)}.`,
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
  const calendarDays = (count, start) => Array.from({ length: count }, (_, index) => {
    const d = new Date(start); d.setDate(d.getDate() + index);
    return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, label: count === 7 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index] : String(d.getDate()), number: d.getDate() };
  });
  const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weeklyDays = calendarDays(7, monday);
  const firstOfMonth = new Date(); firstOfMonth.setDate(1); firstOfMonth.setHours(0, 0, 0, 0);
  const monthlyDays = calendarDays(new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0).getDate(), firstOfMonth);

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
            <HeatMap title="📅 This week" days={weeklyDays} history={weekHistory} onSelect={inspectDay} />
            {dayHistoryPanel}
            <div className="between">
              <div className="section-title" style={{ margin: 0 }}>🎯 Mission list</div>
              <button type="button" className="soft-button" onClick={() => setShowAddTask(true)}><Plus size={16} />➕ Add</button>
            </div>
            {allItems.length ? (
              <>
                <p className="muted small mt-8" style={{ marginBottom: 10 }}>{completedCount}/{totalCount} blocks complete. Play starts a focus block for that mission's length.</p>
                <div className="progress"><span style={{ width: completionPct + '%' }} /></div>
                <div className="task-list mt-12">
                  {allItems.map(item => {
                    const key = item.task?.id || item.focusKey;
                    const focusing = running && (activeFocusId === key || activeFocusId === item.focusKey);
                    const blockSeconds = Math.max(60, (item.durationMinutes || focusMinutes) * 60);
                    const consumed = focusing
                      ? Math.min(1, 1 - (timer / blockSeconds))
                      : Math.min(1, (focusLog[key] || 0) / blockSeconds);
                    return (
                      <TaskRow
                        key={item.key}
                        item={item}
                        done={!!item.task?.done}
                        disabled={saving === 'task' || !user}
                        onToggle={toggleItem}
                        onDelete={removeItem}
                        onReorder={reorderTask}
                        focusedSeconds={focusLog[key] || focusLog[item.focusKey] || 0}
                        focusProgress={consumed}
                        focusing={focusing}
                        onFocusToggle={toggleFocusFor}
                      />
                    );
                  })}
                </div>
                <p className="small muted mt-8" style={{ textAlign: 'center' }}>Swipe left to delete · long-press and drag up/down to swap times.</p>
              </>
            ) : (
              <div className="empty-state mt-12">
                <div className="task-name" style={{ marginBottom: 6 }}>No missions for today.</div>
                You cleared the deck. Enjoy the open day — or load your routine when you are ready.
              </div>
            )}
            <button type="button" className="soft-button mt-12" style={{ width: '100%', justifyContent: 'center' }} onClick={() => loadRoutine()}>
              <AlarmClock size={16} />Load routine into today's tracker
            </button>
          </>
        )}

        {tab === 'goals' && (
          <>
            <HeatMap title="🗓️ This month" days={monthlyDays} history={monthHistory} onSelect={inspectDay} showWeekdays />
            {dayHistoryPanel}
            <div className="between">
              <div className="section-title" style={{ margin: 0 }}>🌟 Month</div>
              <button type="button" className="soft-button" onClick={() => setShowAddGoal(true)}><Plus size={16} />➕ Add</button>
            </div>
            <div className="goals-list mt-12">
              {goals.length ? goals.map(goal => {
                const target = Math.max(1, Number(goal.target_units || 1));
                const done = Number(goal.completed_units || 0) >= target;
                const pct = done ? 100 : Math.round((Number(goal.completed_units || 0) / target) * 100);
                return (
                  <div className={`goal-card ${goal.color === 'blue' ? 'gate' : ''} ${goal.color === 'purple' ? 'rolled-goal' : ''}`} key={goal.id}>
                    <div className="row" style={{ gap: 10 }}>
                      <button type="button" disabled={saving === goal.id || !user} className={`checkbox-button ${done ? 'checked' : ''}`} aria-pressed={done} onClick={() => toggleGoal(goal)}>
                        {done ? <Check size={18} /> : <span />}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div className="task-name" style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--text-secondary)' : 'inherit' }}>{goal.title}</div>
                        <div className="mini-progress mt-8"><span style={{ width: pct + '%' }} /></div>
                        <div className="small muted mt-8">{done ? 'Completed ✓' : `${goal.completed_units || 0}/${target} · ${pct}%`}{goal.color === 'purple' ? ' · ↪ carried from last month' : ''}</div>
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
            <div className="card today-focus-hero">
              <div className="countdown-label"><Clock size={16} />Focused today</div>
              <div className="today-focus-time">{formatClockHMS(focusedToday)}</div>
              <div className="countdown-sub">
                {activeItem
                  ? `${running ? 'Running' : 'Paused'} · ${activeItem.title} · ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')} left`
                  : 'Tap play on a mission clock to start a block.'}
              </div>
            </div>

            <div className="task-list mt-16">
              {allItems.filter(item => (focusLog[item.task?.id || item.focusKey] || 0) > 0 || (running && activeFocusId === (item.task?.id || item.focusKey))).length
                ? allItems.filter(item => (focusLog[item.task?.id || item.focusKey] || 0) > 0 || (running && activeFocusId === (item.task?.id || item.focusKey))).map(item => {
                  const key = item.task?.id || item.focusKey;
                  const seconds = focusLog[key] || 0;
                  return (
                    <div className="card" key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div>
                        <div className="task-name">{item.title}</div>
                        <div className="task-time">{item.time}</div>
                      </div>
                      <strong className="mono" style={{ color: '#1553a5' }}>{formatFocus(seconds)}</strong>
                    </div>
                  );
                })
                : <div className="empty-state">No focused minutes yet today. Start a mission clock on Today.</div>}
            </div>
          </>
        )}

        {tab === 'chat' && (
          <>
            <div className="card mb-10">
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
