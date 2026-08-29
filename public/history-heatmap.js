(() => {
  const FUNCTION_URL = 'https://wvzigkbmlbyjfxpikqhh.supabase.co/functions/v1/studybot-sync';
  const SESSION_KEY = 'studybot-cloud-session-v1';
  const STYLE_ID = 'studybot-history-heatmap-style';
  const ROOT_ID = 'studybot-history-heatmaps';
  let cache = [];
  let lastLoad = 0;

  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dateKey(new Date());
  const monthStart = () => `${today().slice(0, 7)}-01`;
  const addDays = (key, amount) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + amount); return dateKey(d); };
  const monthEnd = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return dateKey(d); };
  const fmtDate = key => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const getToken = () => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } };

  async function queryTasks() {
    const token = getToken();
    if (!token) return [];
    const r = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 'query', table: 'tasks', operation: 'select', values: null, filters: [
        { column: 'task_date', op: 'gte', value: monthStart() },
        { column: 'task_date', op: 'lte', value: monthEnd() }
      ], order: { column: 'scheduled_time', ascending: true }, columns: '*', returnRows: true, single: false, maybeSingle: false })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error(data.error?.message || data.error || `History request failed (${r.status})`);
    return Array.isArray(data.data) ? data.data : Array.isArray(data.rows) ? data.rows : [];
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = `
      #${ROOT_ID}{margin:14px 0 16px;display:grid;gap:12px}
      .sb-history-card{border:1px solid var(--border-card,#c7dff4);border-radius:12px;background:#fff;box-shadow:var(--shadow-card,0 8px 24px rgba(37,99,235,.08));padding:12px}
      .sb-history-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:9px}
      .sb-history-head strong{font-size:.82rem}.sb-history-head span{font-size:.64rem;color:var(--text-muted,#90a8bd)}
      .sb-weekdays,.sb-history-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
      .sb-weekdays span{text-align:center;font-size:.58rem;color:var(--text-muted,#90a8bd)}
      .sb-heat-cell{min-width:0;min-height:43px;padding:4px 2px;border-radius:8px;border:1px solid var(--border-subtle,#d9e9f8);background:#f8fbff;color:var(--text-primary,#17324d);display:grid;place-items:center;gap:2px;line-height:1;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,background .16s ease}
      .sb-heat-cell:active{transform:scale(.96)}.sb-heat-cell:hover{box-shadow:0 4px 12px rgba(37,99,235,.12)}
      .sb-heat-cell.empty{visibility:hidden;cursor:default}.sb-heat-cell.none{background:#fff1f2;border-color:#fecdd3}.sb-heat-cell.partial{background:#fff7ed;border-color:#fed7aa}.sb-heat-cell.complete{background:#f0fdf4;border-color:#bbf7d0}.sb-heat-cell.today{box-shadow:0 0 0 2px #2563eb inset}
      .sb-heat-cell b{font-size:.72rem}.sb-heat-cell small{font-size:.52rem;color:var(--text-secondary,#657e96)}
      .sb-history-legend{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;font-size:.58rem;color:var(--text-secondary,#657e96)}.sb-history-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px;border:1px solid #ddd}
      .sb-history-legend .n{background:#fff1f2}.sb-history-legend .p{background:#fff7ed}.sb-history-legend .c{background:#f0fdf4}
      .sb-history-modal{position:fixed;inset:0;z-index:100;background:rgba(10,36,99,.34);display:grid;place-items:end center;padding:12px}.sb-history-sheet{width:min(520px,100%);max-height:82dvh;overflow:auto;border-radius:16px;background:#fff;border:1px solid var(--border-card,#c7dff4);box-shadow:0 20px 70px rgba(10,36,99,.22);padding:14px;animation:sbHistoryUp .2s ease both}.sb-history-sheet h3{margin:0;font-size:1rem}.sb-history-close{width:40px;height:40px;border-radius:10px;border:1px solid var(--border-subtle,#d9e9f8);background:#f7fbff}.sb-history-summary{margin:7px 0 12px;color:var(--text-secondary,#657e96);font-size:.72rem}.sb-history-task{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:8px;padding:9px;border:1px solid var(--border-subtle,#d9e9f8);border-radius:9px;margin-bottom:7px}.sb-history-task .dot{width:8px;height:8px;border-radius:50%;background:#dc2626}.sb-history-task.done .dot{background:#16a34a}.sb-history-task .title{font-size:.76rem;font-weight:700}.sb-history-task .time{font-size:.61rem;color:var(--text-secondary,#657e96);font-family:"JetBrains Mono",monospace}.sb-history-status{font-size:.61rem;font-weight:700}.sb-history-task.done .sb-history-status{color:#15803d}.sb-history-task:not(.done) .sb-history-status{color:#b91c1c}
      @keyframes sbHistoryUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
      @media(max-width:420px){.sb-heat-cell{min-height:39px}.sb-history-sheet{padding:12px}}
    `;
    document.head.appendChild(s);
  }

  const grouped = tasks => tasks.reduce((m, t) => { const k = String(t.task_date).slice(0,10); (m[k] ||= []).push(t); return m; }, {});
  const stateClass = list => !list.length ? 'none' : list.every(t => t.done) ? 'complete' : list.some(t => t.done) ? 'partial' : 'none';

  function cell(key, list) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = `sb-heat-cell ${stateClass(list)}${key === today() ? ' today' : ''}`;
    b.innerHTML = `<b>${Number(key.slice(-2))}</b><small>${list.filter(t => t.done).length}/${list.length}</small>`;
    b.setAttribute('aria-label', `${fmtDate(key)}: ${list.filter(t => t.done).length} completed of ${list.length} tasks`);
    b.onclick = () => openDay(key, list);
    return b;
  }

  function openDay(key, list) {
    document.querySelector('.sb-history-modal')?.remove();
    const backdrop = document.createElement('div'); backdrop.className = 'sb-history-modal';
    const sheet = document.createElement('div'); sheet.className = 'sb-history-sheet';
    const done = list.filter(t => t.done).length;
    const head = document.createElement('div'); head.className = 'sb-history-head';
    head.innerHTML = `<div><h3>${fmtDate(key)}</h3><div class="sb-history-summary">${done}/${list.length} completed · ${list.length ? Math.round(done / list.length * 100) : 0}%</div></div>`;
    const close = document.createElement('button'); close.className = 'sb-history-close'; close.textContent = '×'; close.setAttribute('aria-label','Close'); close.onclick = () => backdrop.remove(); head.appendChild(close); sheet.appendChild(head);
    if (!list.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'No tasks were recorded for this day.'; sheet.appendChild(empty);
    } else {
      list.slice().sort((a,b) => String(a.scheduled_time||'99:99').localeCompare(String(b.scheduled_time||'99:99'))).forEach(t => {
        const row = document.createElement('div'); row.className = `sb-history-task ${t.done ? 'done' : ''}`;
        const time = t.scheduled_time ? `${String(t.scheduled_time).slice(0,5)}${t.end_time ? ` – ${String(t.end_time).slice(0,5)}` : ''}` : 'Anytime';
        row.innerHTML = `<span class="dot"></span><div><div class="title">${escapeHtml(t.title || 'Untitled')}</div><div class="time">${time}${t.tag ? ` · ${escapeHtml(t.tag)}` : ''}</div></div><span class="sb-history-status">${t.done ? 'Completed' : 'Not completed'}</span>`;
        sheet.appendChild(row);
      });
    }
    backdrop.appendChild(sheet); backdrop.onclick = e => { if (e.target === backdrop) backdrop.remove(); };
    document.body.appendChild(backdrop);
  }

  function escapeHtml(v) { const d = document.createElement('div'); d.textContent = String(v); return d.innerHTML; }

  function build(container, tasks) {
    container.innerHTML = '';
    const byDay = grouped(tasks);
    const monthCard = document.createElement('section'); monthCard.className = 'sb-history-card';
    const monthHead = document.createElement('div'); monthHead.className = 'sb-history-head'; monthHead.innerHTML = `<strong>Monthly history</strong><span>${new Date().toLocaleDateString(undefined,{month:'long',year:'numeric'})}</span>`; monthCard.appendChild(monthHead);
    const wd = document.createElement('div'); wd.className = 'sb-weekdays'; ['S','M','T','W','T','F','S'].forEach(x => { const s=document.createElement('span');s.textContent=x;wd.appendChild(s); }); monthCard.appendChild(wd);
    const grid = document.createElement('div'); grid.className = 'sb-history-grid';
    const first = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getDay();
    for(let i=0;i<first;i++){const e=document.createElement('div');e.className='sb-heat-cell empty';grid.appendChild(e);}
    const days = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
    for(let d=1;d<=days;d++){const key=`${today().slice(0,7)}-${pad(d)}`;grid.appendChild(cell(key,byDay[key]||[]));}
    monthCard.appendChild(grid); monthCard.appendChild(legend()); container.appendChild(monthCard);

    const weekCard = document.createElement('section'); weekCard.className='sb-history-card';
    const weekHead=document.createElement('div');weekHead.className='sb-history-head';weekHead.innerHTML='<strong>Weekly history</strong><span>Last 7 days</span>';weekCard.appendChild(weekHead);
    const weekGrid=document.createElement('div');weekGrid.className='sb-history-grid';
    for(let i=6;i>=0;i--){const key=addDays(today(),-i);const c=cell(key,byDay[key]||[]);weekGrid.appendChild(c);}
    weekCard.appendChild(weekGrid);weekCard.appendChild(legend());container.appendChild(weekCard);
  }

  function legend(){const d=document.createElement('div');d.className='sb-history-legend';d.innerHTML='<span><i class="n"></i>Incomplete</span><span><i class="p"></i>Partial</span><span><i class="c"></i>Complete</span>';return d;}

  async function render() {
    const active = [...document.querySelectorAll('.tab-button.active span')].some(x => x.textContent.trim() === 'Goals');
    const content = document.querySelector('#root .content');
    if (!active || !content) { document.getElementById(ROOT_ID)?.remove(); return; }
    let mount=document.getElementById(ROOT_ID);
    if(!mount){mount=document.createElement('div');mount.id=ROOT_ID;const goalsList=content.querySelector('.goals-list');if(goalsList)goalsList.parentNode.insertBefore(mount,goalsList);else content.appendChild(mount);}
    if(Date.now()-lastLoad>15000){try{cache=await queryTasks();lastLoad=Date.now();}catch(e){mount.innerHTML='';const err=document.createElement('div');err.className='empty-state';err.textContent='Could not load history right now.';mount.appendChild(err);return;}}
    build(mount,cache);
  }

  const observer=new MutationObserver(() => { if(!window.__studybotHistoryScheduled){window.__studybotHistoryScheduled=true;requestAnimationFrame(()=>{window.__studybotHistoryScheduled=false;render();});} });
  observer.observe(document.body,{childList:true,subtree:true});
  setInterval(()=>render(),15000);
  render();
})();
