import React, { Component, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check, Clock, Plus, Sparkles, Target, LayoutDashboard, Brain,
  Play, Pause, RotateCcw, BarChart3, Menu, AlarmClock, X
} from 'lucide-react';
import './styles.css';
import { supabase } from './lib/supabase';

/* ---------------------------------------------------------------
   Date / time helpers
   -----------------------------------------------------------------
   BUG FIX: the old today() used `new Date().toISOString().slice(0,10)`,
   which is the UTC calendar date. In IST (UTC+5:30) that's wrong for
   any local time before 05:30 — exactly when the 04:30 routine block
   starts. That caused tasks logged in the early morning to be saved
   under "yesterday", then disappear once the real date rolled over.
   These helpers use the *local* wall-clock date instead. */
const pad = n => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthStart = () => today().slice(0, 7) + '-01';
const daysUntil = d => Math.max(0, Math.ceil((new Date(d) - new Date()) / 86400000));

/* BUG FIX: Postgres `time` columns come back from Supabase as
   "HH:MM:SS" (e.g. "04:30:00"), but the routine list stores start
   times as "HH:MM" (e.g. "04:30"). Comparing them directly always
   failed after the first insert, so the app could never find the
   already-created task — it kept creating a new duplicate row every
   time you tapped the checkbox, and the checked state never stuck.
   normTime() makes both sides comparable. */
const normTime = t => (t ? String(t).slice(0, 5) : null);

const ROUTINE = [
  ['UPSC', '04:30–07:00', '04:30', 'UPSC', 'High', 'U', 'upsc'],
  ['GATE', '07:00–08:30', '07:00', 'GATE', 'High', 'G', 'gate'],
  ['Supplements', '08:45', '08:45', 'Routine', 'Medium', 'S', 'routine'],
  ['GATE', '09:00–11:00', '09:00', 'GATE', 'High', 'G', 'gate'],
  ['Read / Re-Vision', '11:00–12:00', '11:00', 'Revision', 'High', 'R', 'revision'],
  ['UPSC', '12:00–14:00', '12:00', 'UPSC', 'High', 'U', 'upsc'],
  ['Lunch', '14:00–14:30', '14:00', 'Routine', 'Low', 'L', 'routine'],
  ['DSA', '14:30–17:00', '14:30', 'DSA', 'High', 'D', 'dsa'],
  ['DSA', '18:00–20:00', '18:00', 'DSA', 'High', 'D', 'dsa'],
  ['Current Affairs', '21:00–22:00', '21:00', 'Current Affairs', 'High', 'C', 'ca'],
  ['Bed', '23:00', '23:00', 'Routine', 'Low', 'B', 'routine'],
].map(([title, time, start, tag, priority, icon, tone]) => ({ title, time, start, tag, priority, icon, tone }));

const QUOTES = [
  'You said you wanted a different life. This is the part where you earn it.',
  'Nobody is coming to do the work for you. Start the next block.',
  'Stop negotiating with your excuses. Start the next block.',
  'Your future is built by what you do when nobody is watching.',
  'One focused block is enough to change the direction of today.',
];
const ROUTINE_SOURCE = 'manual';
const TASK_TAGS = ['Personal', 'UPSC', 'GATE', 'DSA', 'Current Affairs', 'Revision', 'Routine'];
const PRIORITIES = ['Low', 'Medium', 'High'];

class AppErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('StudyBot crash', error, info); }
  render() {
    if (this.state.error) {
      return (
        <main className="auth">
          <div className="auth-mark">!</div>
          <h1>StudyBot<span>.</span></h1>
          <p>Something went wrong while loading the dashboard.</p>
          <button className="primary-btn" onClick={() => location.reload()}>Reload StudyBot</button>
        </main>
      );
    }
    return this.props.children;
  }
}

/* Mobile-friendly bottom sheet, used instead of window.prompt() for
   adding tasks/goals — prompt() renders as a tiny, inconsistent
   native dialog on phones and can't hold more than one field. */
function Sheet({ title, onClose, onSubmit, submitLabel = 'Save', children }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        className="sheet"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); onSubmit(); }}
      >
        <div className="sheet-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose}><X /></button>
        </div>
        <div className="sheet-body">{children}</div>
        <div className="sheet-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-btn">{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [goals, setGoals] = useState([]);
  const [tab, setTab] = useState(location.hash === '#planner' ? 'planner' : 'home');
  const [quote, setQuote] = useState(QUOTES[0]);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState('');
  const [timer, setTimer] = useState(1500);
  const [running, setRunning] = useState(false);
  const [hours, setHours] = useState(6);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', priority: 'Medium', tag: 'Personal', time: '' });
  const [goalForm, setGoalForm] = useState({ title: '', target: 1 });

  const completed = tasks.filter(task => task?.done).length;
  const flash = m => { setToast(String(m || 'Something went wrong')); setTimeout(() => setToast(''), 3500); };

  const load = async () => {
    if (!supabase || !user) return;
    try {
      const [a, b] = await Promise.all([
        supabase.from('tasks').select('*').eq('user_id', user.id).eq('task_date', today()).order('scheduled_time'),
        supabase.from('monthly_goals').select('*').eq('user_id', user.id).eq('month_start', monthStart()),
      ]);
      if (a.error) flash(a.error.message);
      setTasks(a.data || []);
      if (b.error) flash(b.error.message);
      setGoals(b.data || []);
    } catch (error) {
      flash(error.message);
    }
  };

  useEffect(() => {
    const sync = () => setTab(location.hash === '#planner' ? 'planner' : 'home');
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let subscription;
    try {
      supabase.auth.getUser().then(({ data, error }) => {
        if (error) console.warn(error);
        setUser(data?.user || null);
      }).catch(error => console.warn(error));
      const listener = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user || null));
      subscription = listener?.data?.subscription;
    } catch (error) {
      console.warn(error);
    }
    return () => subscription?.unsubscribe?.();
  }, []);

  useEffect(() => { load(); }, [user]);

  // Re-check the "today" boundary every minute so a session left open
  // across midnight (or across the old UTC-rollover bug) reloads the
  // right day's tasks automatically instead of silently going stale.
  useEffect(() => {
    let current = today();
    const id = setInterval(() => {
      const now = today();
      if (now !== current) { current = now; load(); }
    }, 60000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTimer(v => (v <= 1 ? (setRunning(false), 0) : v - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const findRoutineTask = r => tasks.find(t => t.title === r.title && normTime(t.scheduled_time) === r.start);

  const ensureTask = async r => {
    if (!supabase || !user) return null;
    const existing = findRoutineTask(r);
    if (existing) return existing;
    try {
      const { data, error } = await supabase.from('tasks').insert({
        user_id: user.id, title: r.title, task_date: today(), scheduled_time: r.start,
        priority: r.priority, tag: r.tag, source: ROUTINE_SOURCE, done: false,
      }).select().single();
      if (error) { flash(error.message); return null; }
      setTasks(v => [...v, data].sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || '')));
      return data;
    } catch (error) {
      flash(error.message);
      return null;
    }
  };

  const toggleTask = async r => {
    if (saving) return;
    setSaving('task');
    let task = findRoutineTask(r);
    if (!task) task = await ensureTask(r);
    if (!task) { setSaving(''); return; }
    const next = !task.done;
    setTasks(v => v.map(t => (t.id === task.id ? { ...t, done: next } : t)));
    try {
      const { error } = await supabase.from('tasks')
        .update({ done: next, completed_at: next ? new Date().toISOString() : null })
        .eq('id', task.id).eq('user_id', user.id);
      if (error) throw error;
      flash(next ? 'Task completed ✓' : 'Task reopened');
    } catch (error) {
      setTasks(v => v.map(t => (t.id === task.id ? { ...t, done: !next } : t)));
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
      user_id: user.id, month_start: monthStart(), title, target_units: target, completed_units: 0, color: 'lime',
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

  const loadRoutine = async () => {
    let failed = false;
    for (const r of ROUTINE) { if (!(await ensureTask(r))) failed = true; }
    if (!failed) flash("Daily routine is ready.");
  };

  const go = n => { location.hash = n === 'planner' ? 'planner' : ''; setTab(n); };

  if (!user) {
    return (
      <main className="auth">
        <div className="auth-mark">SB</div>
        <h1>StudyBot<span>.</span></h1>
        <p>Your personal study operating system.</p>
        {!supabase ? (
          <p className="muted">Supabase environment variables are missing.</p>
        ) : (
          <button
            className="primary-btn"
            onClick={async () => {
              const email = prompt('Enter your email');
              if (email) {
                const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
                flash(error ? error.message : 'Magic link sent');
              }
            }}
          >
            Continue with magic link
          </button>
        )}
        {toast && <div className="toast">{toast}</div>}
      </main>
    );
  }

  return (
    <div className="os-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SB</div>
          <div><strong>StudyBot</strong><span>personal OS</span></div>
        </div>
        <nav>
          <button type="button" className={tab === 'home' ? 'nav-active' : ''} onClick={() => go('home')}>
            <LayoutDashboard />Today
          </button>
          <button type="button" className={tab === 'planner' ? 'nav-active' : ''} onClick={() => go('planner')}>
            <Brain />Planner + AI
          </button>
          <button type="button" onClick={() => { go('home'); setTimeout(() => document.getElementById('goals')?.scrollIntoView({ behavior: 'smooth' }), 80); }}>
            <Target />Goals
          </button>
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <BarChart3 />Top
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button type="button" onClick={() => supabase?.auth.signOut()}><Menu />Sign out</button>
        </div>
      </aside>

      <div className="main-pane">
        <header className="os-header">
          <div>
            <div className="overline">PERSONAL STUDY COMMAND CENTER</div>
            <h1>{tab === 'home' ? 'Good to see you.' : 'Plan the day you actually have.'}</h1>
          </div>
          <button type="button" className="icon-btn" onClick={() => setQuote(QUOTES[Math.floor(Math.random() * QUOTES.length)])}>
            <Sparkles />
          </button>
        </header>

        {tab === 'home' ? (
          <main className="page">
            <section className="mission section">
              <div className="section-head">
                <div>
                  <div className="overline">TODAY · {today()}</div>
                  <h2>Mission list</h2>
                  <p className="muted">Your day in order. Tap the box only when the block is actually done.</p>
                </div>
                <button type="button" className="primary-btn small" onClick={() => setShowAddTask(true)}><Plus />Add</button>
              </div>
              <div className="timeline">
                {ROUTINE.map(r => {
                  const task = findRoutineTask(r);
                  const done = !!task?.done;
                  return (
                    <div className={`timeline-item ${done ? 'done' : ''}`} key={r.title + r.start}>
                      <div className="timeline-time">{r.time}</div>
                      <div className={`timeline-dot ${r.tone}`}>{r.icon}</div>
                      <div className="timeline-body"><strong>{r.title}</strong><span>{r.tag}</span></div>
                      <button
                        type="button"
                        disabled={saving === 'task'}
                        aria-pressed={done}
                        aria-label={done ? `Mark ${r.title} as not done` : `Mark ${r.title} as done`}
                        className={`timeline-check ${done ? 'checked' : ''}`}
                        onClick={() => toggleTask(r)}
                      >
                        {done ? <Check /> : <span />}
                      </button>
                    </div>
                  );
                })}
                {tasks.filter(t => t.source === 'manual' && !ROUTINE.some(r => r.title === t.title && normTime(t.scheduled_time) === r.start)).map(t => (
                  <div className={`timeline-item ${t.done ? 'done' : ''}`} key={t.id}>
                    <div className="timeline-time">{t.scheduled_time ? normTime(t.scheduled_time) : '—'}</div>
                    <div className="timeline-dot routine">{(t.tag || 'P')[0]}</div>
                    <div className="timeline-body"><strong>{t.title}</strong><span>{t.tag}</span></div>
                    <button
                      type="button"
                      disabled={saving === 'task'}
                      aria-pressed={t.done}
                      aria-label={t.done ? `Mark ${t.title} as not done` : `Mark ${t.title} as done`}
                      className={`timeline-check ${t.done ? 'checked' : ''}`}
                      onClick={async () => {
                        if (saving) return;
                        setSaving('task');
                        const next = !t.done;
                        setTasks(v => v.map(x => (x.id === t.id ? { ...x, done: next } : x)));
                        try {
                          const { error } = await supabase.from('tasks')
                            .update({ done: next, completed_at: next ? new Date().toISOString() : null })
                            .eq('id', t.id).eq('user_id', user.id);
                          if (error) throw error;
                          flash(next ? 'Task completed ✓' : 'Task reopened');
                        } catch (error) {
                          setTasks(v => v.map(x => (x.id === t.id ? { ...x, done: !next } : x)));
                          flash('Could not save task: ' + error.message);
                        } finally {
                          setSaving('');
                        }
                      }}
                    >
                      {t.done ? <Check /> : <span />}
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="routine-btn" onClick={loadRoutine}><AlarmClock />Load routine into today's tracker</button>
            </section>

            <section className="motivation-hero">
              <div className="motivation-kicker">READ THIS. THEN WORK.</div>
              <h2>{quote}</h2>
              <div className="motivation-line">No scrolling. No negotiating. Start the next block.</div>
            </section>

            <section className="metric-grid">
              <Metric label="GATE 2027" value={daysUntil('2027-02-07')} sub="days left" tone="gate" />
              <Metric label="UPSC CSE 2027" value={daysUntil('2027-05-30')} sub="days left" tone="upsc" />
              <Metric label="TODAY" value={`${tasks.length ? Math.round((completed / tasks.length) * 100) : 0}%`} sub={`${completed}/${tasks.length} complete`} tone="lime" />
            </section>

            <section className="grid-two" id="goals">
              <section className="card-panel">
                <div className="section-head">
                  <div>
                    <div className="overline">MONTH</div>
                    <h2>Goals that matter</h2>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => setShowAddGoal(true)}><Plus /></button>
                </div>
                {goals.length ? goals.map(goal => {
                  const target = Math.max(1, Number(goal.target_units || 1));
                  const done = Number(goal.completed_units || 0) >= target;
                  const pct = done ? 100 : Math.round((Number(goal.completed_units || 0) / target) * 100);
                  return (
                    <div className={`goal-item ${done ? 'goal-done' : ''}`} key={goal.id}>
                      <div className="goal-title">
                        <button type="button" disabled={saving === goal.id} className={`goal-check ${done ? 'checked' : ''}`} aria-pressed={done} onClick={() => toggleGoal(goal)}>
                          {done ? <Check /> : <span />}
                        </button>
                        <strong>{goal.title}</strong>
                        <span>{done ? 'DONE' : pct + '%'}</span>
                      </div>
                      <div className="goal-bar"><span style={{ width: pct + '%' }} /></div>
                      <div className="goal-meta">{done ? 'Completed ✓' : `${goal.completed_units || 0}/${target} complete`}</div>
                    </div>
                  );
                }) : <div className="empty">Add the outcomes you want this month.</div>}
              </section>
              <section className="card-panel">
                <div className="overline">TODAY'S EXECUTION</div>
                <div className="focus-number">{tasks.length ? Math.round((completed / tasks.length) * 100) : 0}<span>%</span></div>
                <div className="muted">Complete the next block. Then earn the next one.</div>
              </section>
            </section>
          </main>
        ) : (
          <main className="page planner-page">
            <section className="planner-hero">
              <div>
                <div className="overline">STUDYBOT INTELLIGENCE</div>
                <h2>Plan, focus, adapt.</h2>
                <p>Set your real available hours and protect a focused work block.</p>
              </div>
              <button type="button" className="secondary-btn" onClick={() => go('home')}><LayoutDashboard />Dashboard</button>
            </section>
            <section className="planner-grid">
              <section className="card-panel">
                <div className="overline">REAL CAPACITY</div>
                <h2>How much time do you actually have?</h2>
                <div className="hours-input">
                  <Clock />
                  <input type="number" min="1" max="16" value={hours} onChange={e => setHours(e.target.value)} />
                  <span>hours available today</span>
                </div>
                <button type="button" className="primary-btn" onClick={() => flash(`Plan protected for ${hours} focused hours.`)}><Sparkles />Build my day</button>
              </section>
              <section className="card-panel">
                <div className="section-head">
                  <div>
                    <div className="overline">DEEP WORK</div>
                    <h2>Focus timer</h2>
                  </div>
                  <div className="timer-display">{String(Math.floor(timer / 60)).padStart(2, '0')}:{String(timer % 60).padStart(2, '0')}</div>
                </div>
                <div className="timer-actions">
                  <button type="button" className="primary-btn" onClick={() => setRunning(v => !v)}>{running ? <Pause /> : <Play />}{running ? 'Pause' : 'Start'}</button>
                  <button type="button" className="secondary-btn" onClick={() => { setRunning(false); setTimer(1500); }}><RotateCcw />Reset</button>
                </div>
              </section>
            </section>
          </main>
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>

      {showAddTask && (
        <Sheet title="Add task" onClose={() => setShowAddTask(false)} onSubmit={submitTask}>
          <label className="field">
            <span>Title</span>
            <input autoFocus type="text" value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Revise Polity notes" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Time (optional)</span>
              <input type="time" value={taskForm.time} onChange={e => setTaskForm(f => ({ ...f, time: e.target.value }))} />
            </label>
            <label className="field">
              <span>Priority</span>
              <select value={taskForm.priority} onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Tag</span>
            <select value={taskForm.tag} onChange={e => setTaskForm(f => ({ ...f, tag: e.target.value }))}>
              {TASK_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </Sheet>
      )}

      {showAddGoal && (
        <Sheet title="Add monthly goal" onClose={() => setShowAddGoal(false)} onSubmit={submitGoal}>
          <label className="field">
            <span>Goal</span>
            <input autoFocus type="text" value={goalForm.title} onChange={e => setGoalForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Finish 6 GATE PYQ sets" />
          </label>
          <label className="field">
            <span>Target units / chapters</span>
            <input type="number" min="1" value={goalForm.target} onChange={e => setGoalForm(f => ({ ...f, target: e.target.value }))} />
          </label>
        </Sheet>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>);
