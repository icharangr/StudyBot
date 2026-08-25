import React, { Component, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check, Clock, Plus, Sparkles, Target, LayoutDashboard, MessageCircle,
  Play, Pause, RotateCcw, AlarmClock, X, Send, Loader2, LogOut, Trash2,
} from 'lucide-react';
import './styles.css';
import { supabase } from './lib/supabase';

const pad = n => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthStart = () => today().slice(0, 7) + '-01';
const daysUntil = d => Math.max(0, Math.ceil((new Date(d) - new Date()) / 86400000));
const normTime = t => (t ? String(t).slice(0, 5) : null);

const ROUTINE = [
  ['UPSC', '04:30–07:00', '04:30', 'UPSC', 'High', 'U', 'upsc'],
  ['GATE', '07:00–08:30', '07:00', 'GATE', 'High', 'G', 'gate'],
  ['Supplements', '08:45', '08:45', 'Routine', 'Medium', 'S', 'routine'],
  ['GATE', '09:00–11:00', '09:00', 'GATE', 'High', 'G', 'gate'],
  ['Read / Re-Vision', '11:00–12:00', '11:00', 'Revision', 'High', 'R', 'study'],
  ['UPSC', '12:00–14:00', '12:00', 'UPSC', 'High', 'U', 'upsc'],
  ['Lunch', '14:00–14:30', '14:00', 'Routine', 'Low', 'L', 'routine'],
  ['DSA', '14:30–17:00', '14:30', 'DSA', 'High', 'D', 'dsa'],
  ['DSA', '18:00–20:00', '18:00', 'DSA', 'High', 'D', 'dsa'],
  ['Current Affairs', '21:00–22:00', '21:00', 'Current Affairs', 'High', 'C', 'study'],
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
const TAG_TONE = {
  UPSC: 'upsc', GATE: 'gate', DSA: 'dsa', 'Current Affairs': 'study',
  Revision: 'study', Routine: 'routine', Personal: 'college',
};
const QUICK_PROMPTS = ["Plan my day", "What should I do next?", "Move DSA to 8 PM", "Mark my last GATE block done"];

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

function App() {
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [goals, setGoals] = useState([]);
  const [tab, setTab] = useState('today');
  const [quote, setQuote] = useState(QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState('');
  const [timer, setTimer] = useState(1500);
  const [running, setRunning] = useState(false);
  const [hours, setHours] = useState(6);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', priority: 'Medium', tag: 'Personal', time: '' });
  const [goalForm, setGoalForm] = useState({ title: '', target: 1 });

  const [chatMessages, setChatMessages] = useState([
    { id: 'seed', role: 'bot', text: "Hey — I'm your StudyBot AI. Ask me to plan your day, move a block, or mark something done." },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, chatLoading, tab]);

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

  const manualItems = tasks.filter(t => !ROUTINE.some(r => r.title === t.title && normTime(t.scheduled_time) === r.start));
  const allItems = [
    ...ROUTINE.map(r => ({ key: r.title + r.start, title: r.title, time: r.time, tag: r.tag, tone: r.tone, icon: r.icon, routine: r, task: findRoutineTask(r) })),
    ...manualItems.map(t => ({ key: t.id, title: t.title, time: t.scheduled_time ? normTime(t.scheduled_time) : 'Anytime', tag: t.tag, tone: TAG_TONE[t.tag] || 'routine', icon: (t.tag || 'T')[0], routine: null, task: t })),
  ];
  const totalCount = allItems.length;
  const completedCount = allItems.filter(i => i.task?.done).length;
  const completionPct = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

  const toggleItem = async item => {
    if (saving) return;
    setSaving('task');
    let task = item.task;
    if (!task && item.routine) task = await ensureTask(item.routine);
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

  const deleteTask = async id => {
    if (!supabase || !user) return;
    const { error } = await supabase.from('tasks').delete().eq('id', id).eq('user_id', user.id);
    if (error) flash(error.message); else { setTasks(v => v.filter(t => t.id !== id)); flash('Task removed'); }
  };

  const loadRoutine = async () => {
    let failed = false;
    for (const r of ROUTINE) { if (!(await ensureTask(r))) failed = true; }
    if (!failed) flash('Daily routine is ready.');
  };

  const applyOperations = async ops => {
    for (const op of ops) {
      try {
        if (op.op === 'create') {
          await supabase.from('tasks').insert({
            user_id: user.id, title: op.title, task_date: op.task_date || today(),
            scheduled_time: op.time || null, priority: op.priority || 'Medium',
            tag: op.tag || 'Personal', source: 'ai', done: false,
          });
        } else if (op.op === 'update') {
          const patch = {};
          if (op.new_title) patch.title = op.new_title;
          if (op.priority) patch.priority = op.priority;
          if (op.tag) patch.tag = op.tag;
          if (Object.keys(patch).length) await supabase.from('tasks').update(patch).eq('id', op.task_id).eq('user_id', user.id);
        } else if (op.op === 'reschedule') {
          await supabase.from('tasks').update({ task_date: op.task_date, scheduled_time: op.time || null }).eq('id', op.task_id).eq('user_id', user.id);
        } else if (op.op === 'delete') {
          await supabase.from('tasks').delete().eq('id', op.task_id).eq('user_id', user.id);
        } else if (op.op === 'complete') {
          await supabase.from('tasks').update({ done: true, completed_at: new Date().toISOString() }).eq('id', op.task_id).eq('user_id', user.id);
        }
      } catch (e) {
        flash('AI action failed: ' + e.message);
      }
    }
    load();
  };

  const sendCommand = async text => {
    const command = (text ?? chatInput).trim();
    if (!command || chatLoading || !user) return;
    const userMsg = { id: crypto.randomUUID(), role: 'user', text: command };
    setChatMessages(v => [...v, userMsg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await fetch('/api/ai-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, tasks, goals, today: today(), availableHours: hours }),
      });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('AI endpoint is not reachable here (are you running `vite dev` without Vercel? try `vercel dev` or a deployed URL).'); }
      if (!res.ok) throw new Error(data.error || 'AI request failed');
      const ops = Array.isArray(data.operations) ? data.operations : [];
      const needsConfirmation = !!data.needs_confirmation;
      setChatMessages(v => [...v, {
        id: crypto.randomUUID(), role: 'bot', text: data.message || 'Done.',
        operations: ops, needsConfirmation, resolved: !needsConfirmation,
      }]);
      if (ops.length && !needsConfirmation) await applyOperations(ops);
    } catch (error) {
      setChatMessages(v => [...v, { id: crypto.randomUUID(), role: 'bot', text: "Couldn't reach the AI — " + error.message }]);
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

  return (
    <div className="shell">
      <div className="top-panel">
        <div className="between">
          <div className="quote" style={{ margin: 0, flex: 1 }}>{quote}</div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="icon-button" onClick={() => setQuote(QUOTES[Math.floor(Math.random() * QUOTES.length)])}><Sparkles size={16} /></button>
            {user && <button type="button" className="icon-button" onClick={() => supabase?.auth.signOut()}><LogOut size={16} /></button>}
          </div>
        </div>
        <div className="hero-row mt-8">
          <div className="greeting">
            <h1>{tab === 'today' ? 'Good to see you.' : tab === 'chat' ? 'StudyBot AI' : tab === 'goals' ? 'Goals that matter' : 'Focus'}</h1>
            <div className="date-line">{today()}</div>
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
            <p className="muted small mt-8" style={{ marginBottom: 10 }}>{completedCount}/{totalCount} blocks complete. Tap only when it's actually done.</p>
            <div className="progress"><span style={{ width: completionPct + '%' }} /></div>

            <div className="task-list mt-12">
              {allItems.map(item => {
                const done = !!item.task?.done;
                return (
                  <div className={`task-card ${done ? 'done' : ''}`} key={item.key}>
                    <div className="task-icon">{item.icon}</div>
                    <div>
                      <div className="task-name">{item.title}</div>
                      <div className="task-time">{item.time}</div>
                      <div className="pill-row">
                        <span className={`pill cat-${item.tone}`}>{item.tag}</span>
                        {!item.routine && (
                          <button type="button" className="icon-button" style={{ width: 24, height: 24, minHeight: 0 }} onClick={() => deleteTask(item.task.id)}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="check-wrap">
                      <button
                        type="button"
                        disabled={saving === 'task'}
                        aria-pressed={done}
                        aria-label={done ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`}
                        className={`checkbox-button ${done ? 'checked' : ''}`}
                        onClick={() => toggleItem(item)}
                      >
                        {done ? <Check size={18} /> : <span />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
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
                  <div className={`goal-card ${goal.color === 'lime' ? 'gate' : ''}`} key={goal.id}>
                    <div className="row" style={{ gap: 10 }}>
                      <button type="button" disabled={saving === goal.id} className={`checkbox-button ${done ? 'checked' : ''}`} aria-pressed={done} onClick={() => toggleGoal(goal)}>
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
              <button type="button" className="primary-button mt-12" style={{ width: '100%' }} onClick={() => flash(`Plan protected for ${hours} focused hours.`)}>
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
              <div className="row mt-12" style={{ gap: 10 }}>
                <button type="button" className="primary-button" style={{ flex: 1 }} onClick={() => setRunning(v => !v)}>
                  {running ? <Pause size={16} /> : <Play size={16} />}{running ? 'Pause' : 'Start'}
                </button>
                <button type="button" className="soft-button" style={{ flex: 1 }} onClick={() => { setRunning(false); setTimer(1500); }}>
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