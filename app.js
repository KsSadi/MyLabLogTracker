// ── CONFIG (localStorage) ──
const CFG_KEY = 'mylab_cfg';
let CFG = {};
function loadCfg() {
  try { CFG = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { CFG = {}; }
}
function saveCfg(obj) {
  CFG = { ...CFG, ...obj };
  localStorage.setItem(CFG_KEY, JSON.stringify(CFG));
}
loadCfg();

// sat_off: array of 1-based Saturday numbers that are OFF (e.g. [1,2,3])
// default: all 4 Saturdays are working (empty off list), only Friday off
function getSatOff() { return CFG.sat_off || []; }

const DEFAULT_URL = 'https://codelab.ba-systems.com';
let API   = (CFG.url || DEFAULT_URL).replace(/\/$/, '') + '/api/v4';
let TOKEN = CFG.token || '';
let ME = null, allIssues = [], allProjects = [];
let activeIssueIid = null, activeProjectId = null;
let dashMonthData = null;

// ── THEME ──
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.dataset.theme === 'dark';
  html.dataset.theme = isDark ? 'light' : 'dark';
  document.getElementById('themeBtn').textContent = isDark ? '🌙' : '☀️️';
  localStorage.setItem('theme', html.dataset.theme);
}
(function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.dataset.theme = saved;
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('themeBtn').textContent = saved === 'dark' ? '☀️️' : '🌙';
  });
})();

// ?? GraphQL helper ??
async function gql(query) {
  const GRAPHQL = (CFG.url || DEFAULT_URL).replace(/\/$/, '') + '/api/graphql';
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

function parseDurToSecs(s) {
  if (!s) return 0;
  let secs = 0;
  const d = s.match(/(\d+(?:\.\d+)?)d/i); if (d) secs += parseFloat(d[1]) * 8 * 3600;
  const h = s.match(/(\d+(?:\.\d+)?)h/i); if (h) secs += parseFloat(h[1]) * 3600;
  const m = s.match(/(\d+)m/i);           if (m) secs += parseInt(m[1]) * 60;
  return secs;
}

async function logTimeGQL(pid, iid, duration, date, summary) {
  const proj = allProjects.find(p => String(p.id) === String(pid));
  if (!proj) throw new Error('Project not found');
  const projPath = proj.path_with_namespace;
  const d1 = await gql(`{ project(fullPath: "${projPath}") { issue(iid: "${iid}") { id } } }`);
  const gid = d1?.project?.issue?.id;
  if (!gid) throw new Error('Issue not found via GraphQL');
  if (!parseDurToSecs(duration)) throw new Error('Invalid duration');
  const spentAt = date || new Date().toISOString().slice(0, 10);
  const sum = (summary || duration).replace(/["\n\r]/g, ' ');
  const d2 = await gql(`mutation { timelogCreate(input: { issuableId: "${gid}", spentAt: "${spentAt}", timeSpent: "${duration}", summary: "${sum}" }) { timelog { id spentAt timeSpent } errors } }`);
  if (d2?.timelogCreate?.errors?.length) throw new Error(d2.timelogCreate.errors[0]);
  return d2?.timelogCreate?.timelog;
}

// ── API ──
async function req(path, method='GET', body=null) {
  const res = await fetch(API + path, {
    method,
    headers: { 'PRIVATE-TOKEN': TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
async function reqAll(path) {
  let page = 1, out = [];
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${API}${path}${sep}per_page=100&page=${page}`, { headers: { 'PRIVATE-TOKEN': TOKEN } });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.length) break;
    out = out.concat(data);
    if (data.length < 100) break;
    page++;
  }
  return out;
}

// ── CONNECT ──

// ── PROJECTS ──
async function loadProjects() {
  allProjects = await reqAll('/projects?membership=true&simple=true&order_by=last_activity_at');
  const pf = document.getElementById('projectFilter');
  pf.innerHTML = '<option value="">All Projects</option>';
  allProjects.forEach(p => {
    pf.innerHTML += `<option value="${p.id}">${p.name_with_namespace}</option>`;
  });
  // populate searchable dropdown for create page
  sdPopulate('sdProject', allProjects.map(p => ({ value: String(p.id), label: p.name_with_namespace })));
}

// ── SEARCHABLE DROPDOWN ──
const _sdData = {};
function sdPopulate(id, items) {
  _sdData[id] = items;
  const list = document.getElementById(id + '_list');
  list.innerHTML = items.length
    ? items.map(it => `<div class="sd-opt" data-value="${it.value}" onclick="sdSelect('${id}','${it.value}',this)">${it.label}</div>`).join('')
    : '<div class="sd-empty">No items</div>';
}
function sdToggle(id) {
  const wrap = document.getElementById(id);
  const isOpen = wrap.classList.contains('open');
  document.querySelectorAll('.sd-wrap.open').forEach(w => w.classList.remove('open'));
  if (!isOpen) {
    wrap.classList.add('open');
    const search = document.getElementById(id + '_search');
    if (search) { search.value = ''; sdFilter(id); setTimeout(() => search.focus(), 50); }
  }
}
function sdFilter(id) {
  const q = (document.getElementById(id + '_search').value || '').toLowerCase();
  const opts = document.querySelectorAll(`#${id}_list .sd-opt`);
  let visible = 0;
  opts.forEach(o => {
    const match = o.textContent.toLowerCase().includes(q);
    o.classList.toggle('hidden', !match);
    if (match) visible++;
  });
  let empty = document.querySelector(`#${id}_list .sd-empty`);
  if (!empty) { empty = document.createElement('div'); empty.className = 'sd-empty'; document.getElementById(id + '_list').appendChild(empty); }
  empty.style.display = visible === 0 ? 'block' : 'none';
  empty.textContent = 'No results for "' + document.getElementById(id + '_search').value + '"';
}
// sdHiddenId: maps sd wrapper id → hidden input id
const _sdHidden = { sdProject: 'createProject', sdMlIssue: 'mlIssue', sdMlProject: 'mlProject', sdQcProject: 'qcProject', sdBulkProject: 'bulkProject', sdSummaryProject: 'summaryProject' };
function sdSelect(id, value, el) {
  const item = (_sdData[id] || []).find(i => i.value === value);
  if (!item) return;
  document.getElementById(id + '_label').textContent = item.label;
  document.getElementById(id + '_label').className = 'sd-selected-text';
  const hiddenId = _sdHidden[id] || id.replace('sd', 'create');
  document.getElementById(hiddenId).value = value;
  document.querySelectorAll(`#${id}_list .sd-opt`).forEach(o => o.classList.remove('selected'));
  if (el) el.classList.add('selected');
  document.getElementById(id).classList.remove('open');
}
function sdReset(id, placeholder) {
  const lbl = document.getElementById(id + '_label');
  if (lbl) { lbl.textContent = placeholder; lbl.className = 'sd-placeholder'; }
  const hiddenId = _sdHidden[id] || id.replace('sd', 'create');
  const hidden = document.getElementById(hiddenId);
  if (hidden) hidden.value = '';
  document.querySelectorAll(`#${id}_list .sd-opt`).forEach(o => o.classList.remove('selected'));
}
document.addEventListener('click', e => {
  if (!e.target.closest('.sd-wrap')) document.querySelectorAll('.sd-wrap.open').forEach(w => w.classList.remove('open'));
});

// ── LABELS ──
function updateLabels() {
  updateTimeLabel();
  updateLogLabel();
}
function updateLogLabel() {
  const d = new Date(_logYear, _logMonth, 1);
  const now = new Date();
  const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('logMonthLabel').textContent = label;
  document.getElementById('logNextBtn').style.visibility =
    (_logYear === now.getFullYear() && _logMonth === now.getMonth()) ? 'hidden' : 'visible';
}

// ── DASHBOARD ──
async function loadDashboard() {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('dashGreet').textContent = `${greet}, ${ME?.name?.split(' ')[0] || ''} 👋`;
  document.getElementById('dashDate').textContent = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Load open issues for KPI + recent list
  let open = gc('openIssues');
  if (!open) { open = await reqAll(`/issues?assignee_username=${ME.username}&state=opened&scope=all`); sc('openIssues', open); }
  document.getElementById('kpiOpen').textContent = open.length;

  // Recent 8 open issues
  const recent = open.slice(0, 8);
  document.getElementById('dashIssues').innerHTML = recent.length ? recent.map(i => {
    const proj = i.references?.full?.split('#')[0] || i.web_url.split('/-/')[0].split('/').slice(-2).join('/');
    const labels = (i.labels||[]).map(l=>`<span class="chip" style="background:var(--surface3);color:var(--text2);border:1px solid var(--border2);font-size:10px;padding:1px 6px">${l}</span>`).join('');
    return `<div class="dash-issue-row" onclick="window.open('${i.web_url}','_blank')">
      <div class="dash-issue-num">#${i.iid}</div>
      <div><div class="dash-issue-title">${i.title}</div><div class="dash-issue-proj" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${proj}${labels ? '<span style="color:var(--border2)">·</span>'+labels : ''}</div></div>
    </div>`;
  }).join('') : '<div class="empty"><div class="eicon">✕</div><p>No open issues</p></div>';

  // Monthly log for KPI
  await loadMonthlyLogData();
}

// ── CACHE (sessionStorage + memory) ──
const CACHE_NS = 'mylab_v1_';
const _mem = {}; // memory cache for this tab session

function sc(key, val) {
  // set: memory + sessionStorage
  _mem[key] = val;
  try { sessionStorage.setItem(CACHE_NS + key, JSON.stringify({ m: new Date().getMonth(), d: val })); } catch {}
}
function gc(key) {
  // get: memory first, then sessionStorage
  if (_mem[key] !== undefined) return _mem[key];
  try {
    const raw = sessionStorage.getItem(CACHE_NS + key);
    if (!raw) return null;
    const { m, d } = JSON.parse(raw);
    if (m !== new Date().getMonth()) { sessionStorage.removeItem(CACHE_NS + key); return null; }
    _mem[key] = d;
    return d;
  } catch { return null; }
}
function cacheClear() {
  Object.keys(_mem).forEach(k => delete _mem[k]);
  Object.keys(sessionStorage).filter(k => k.startsWith(CACHE_NS)).forEach(k => sessionStorage.removeItem(k));
}

// ── SHARED: build dayMap from notes (single source of truth) ──
let _cachedDayMap = null;

async function fetchIssueTimelogs(issue) {
  // timelogs API not supported on this GitLab version — notes are the source of truth
  return [];
}

async function buildDayMap(year, month) {
  const now = new Date();
  if (year === undefined)  year  = now.getFullYear();
  if (month === undefined) month = now.getMonth();
  const cacheKey = `daymap_${year}_${month}`;
  const hit = gc(cacheKey);
  if (hit) return hit;

  // Fetch issues updated on or after the start of the target month.
  // This catches current-month issues and past-month issues that were later updated.
  const monthStart = new Date(year, month, 1).toISOString();
  const issues = await reqAll(`/issues?assignee_username=${ME.username}&state=all&scope=all&updated_after=${monthStart}`);

  // Fetch both notes and per-issue timelogs in parallel
  const results = await Promise.all(issues.map(async (issue) => {
    const proj = issue.references?.full?.split('#')[0] || issue.web_url.split('/-/')[0].split('/').slice(-2).join('/');
    const [notesData, timelogs] = await Promise.all([
      fetchTimeNotes(issue),
      fetchIssueTimelogs(issue)
    ]);
    return { issue, proj, notes: notesData.notes, timelogs };
  }));

  const dayMap = {};

  for (const { issue, proj, notes, timelogs } of results) {
    // Per-date accumulator for this issue — timelogs API is authoritative source
    // timelogs entries have exact spent_at; notes are fallback for entries without timelog API support
    const tlDates = new Set(); // track which dates timelogs covered
    const dateMap = {}; // dateStr -> secs

    // 1. Timelogs API entries (GitLab UI / direct API entries)
    for (const tl of timelogs) {
      if (!tl.dateStr) continue;
      const [ty, tm] = tl.dateStr.split('-').map(Number);
      if (ty !== year || tm !== month + 1) continue;
      dateMap[tl.dateStr] = (dateMap[tl.dateStr] || 0) + tl.secs;
      tlDates.add(tl.dateStr);
    }

    // 2. Notes entries — only add for dates NOT already covered by timelogs (avoid double-count)
    for (const note of notes) {
      const p = parseTimeNote(note.body);
      if (!p) continue;
      const [ny, nm] = p.dateStr.split('-').map(Number);
      if (ny !== year || nm !== month + 1) continue;
      if (tlDates.has(p.dateStr)) continue; // timelogs already has this date
      dateMap[p.dateStr] = (dateMap[p.dateStr] || 0) + p.secs;
    }

    for (const [dateStr, secs] of Object.entries(dateMap)) {
      if (!dayMap[dateStr]) dayMap[dateStr] = [];
      const ex = dayMap[dateStr].find(e => e.iid === issue.iid && e.pid === issue.project_id);
      if (ex) ex.secs += secs;
      else dayMap[dateStr].push({ iid: issue.iid, title: issue.title, url: issue.web_url, proj, pid: issue.project_id, secs });
    }
  }

  sc(cacheKey, dayMap);
  return dayMap;
}

async function loadMonthlyLogData() {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const todayDate = now.getDate();
  const dayMap = await buildDayMap();

  let totalSecs = 0, workedDays = 0, missingDays = 0;
  for (let d = 1; d <= todayDate; d++) {
    const dateObj = new Date(year, month, d);
    const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const daySecs = (dayMap[key] || []).reduce((s, e) => s + e.secs, 0);
    if (daySecs > 0) { totalSecs += daySecs; workedDays++; }
    else if (!isWeekend(dateObj, d, year, month)) missingDays++;
  }

  // Update Dashboard KPIs
  document.getElementById('kpiMonth').textContent   = fmtH(totalSecs);
  document.getElementById('kpiDays').textContent    = workedDays;
  document.getElementById('kpiMissing').textContent = missingDays;

  // This week's bar chart
  const weekBars = [];
  for (let back = 6; back >= 0; back--) {
    const d = new Date(now); d.setDate(now.getDate() - back);
    if (d.getMonth() !== month || d.getDate() > todayDate) continue;
    const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const daySecs = (dayMap[key] || []).reduce((s, e) => s + e.secs, 0);
    const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    const isOff = isWeekend(d, d.getDate(), year, month);
    weekBars.push({ dateStr, daySecs, isOff });
  }
  const maxSecs = Math.max(...weekBars.map(b => b.daySecs), 1);
  document.getElementById('dashWeek').innerHTML = weekBars.map(b => {
    const pct = Math.round((b.daySecs / maxSecs) * 100);
    const isMissing = !b.isOff && b.daySecs === 0;
    return `<div class="day-row">
      <div class="day-date">${b.dateStr}</div>
      <div class="day-bar-wrap">
        <div class="day-bar" style="width:${pct}%;background:${isMissing?'var(--red)':(b.isOff&&b.daySecs===0)?'var(--border2)':'var(--blue)'}"></div>
      </div>
      <div class="day-hours">${b.daySecs > 0 ? fmtH(b.daySecs) : (isMissing ? '<span style="color:var(--red);font-size:11px">—</span>' : '')}</div>
    </div>`;
  }).join('');
}

// ── MY ISSUES ──
async function loadMyIssues() {
  if (!ME) return;
  const state = document.getElementById('stateFilter').value;
  document.getElementById('issuesList').innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  try {
    const cacheKey = `issues_${state}`;
    allIssues = gc(cacheKey);
    if (!allIssues) { allIssues = await reqAll(`/issues?assignee_username=${ME.username}&state=${state}&scope=all`); sc(cacheKey, allIssues); }
    renderIssues(allIssues);
    // Fetch time_stats in background and update chips
    allIssues.forEach(async (issue) => {
      try {
        const detail = await req(`/projects/${issue.project_id}/issues/${issue.iid}`);
        const ts = detail.time_stats;
        const t = ts?.human_time_spent || (ts?.total_time_spent > 0 ? fmtH(ts.total_time_spent) : null);
        const el = document.getElementById(`time-chip-${issue.project_id}-${issue.iid}`);
        if (el && t) el.textContent = '⏱ ' + t;
      } catch {}
    });
    const n = allIssues.filter(i => i.state === 'opened').length;
    const b = document.getElementById('issueCount');
    b.style.display = n > 0 ? '' : 'none';
    b.textContent = n;
  } catch(e) {
    document.getElementById('issuesList').innerHTML = `<div class="empty"><div class="eicon">⚠️</div><p>${e.message}</p></div>`;
  }
}

function renderIssues(issues) {
  const q    = document.getElementById('searchInput').value.toLowerCase();
  const proj = document.getElementById('projectFilter').value;
  let list   = issues;
  if (q)    list = list.filter(i => i.title.toLowerCase().includes(q) || String(i.iid).includes(q));
  if (proj) list = list.filter(i => String(i.project_id) === proj);
  if (!list.length) {
    document.getElementById('issuesList').innerHTML = '<div class="empty"><div class="eicon">✕</div><p>No issues found</p></div>';
    return;
  }
  document.getElementById('issuesList').innerHTML = list.map(issue => {
    const pname   = issue.references?.full?.split('#')[0] || issue.web_url.split('/-/')[0].split('/').slice(-2).join('/');
    const ts = issue.time_stats;
    const timeTxt = ts?.human_time_spent || (ts?.total_time_spent > 0 ? fmtH(ts.total_time_spent) : null);
    const isOpen  = issue.state === 'opened';
    return `<div class="issue-card">
      <div class="ic-top">
        <div class="ic-num">#${issue.iid}</div>
        <div class="ic-body">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div class="ic-title" onclick="window.open('${issue.web_url}','_blank')">${issue.title}</div>
            <span class="chip chip-purple" id="time-chip-${issue.project_id}-${issue.iid}" style="flex-shrink:0">${timeTxt ? '⏱ ' + timeTxt : ''}</span>
          </div>
          <div class="ic-meta">
            <span class="chip chip-blue">🔍 ${pname}</span>
            ${(issue.labels||[]).map(l=>`<span class="chip" style="background:var(--surface3);color:var(--text2);border:1px solid var(--border2)">${l}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="ic-actions">
        <button class="btn btn-ghost btn-sm" onclick="openTimeModal(${issue.project_id},${issue.iid},'${issue.title.replace(/'/g,"\\'")}')">⏱ Log Time</button>
        ${isOpen ? `<button class="btn btn-danger btn-sm" onclick="openCloseModal(${issue.project_id},${issue.iid})">✕ Close</button>` : ''}
        <a href="${issue.web_url}" target="_blank" style="margin-left:auto"><button class="btn btn-ghost btn-sm">← View</button></a>
      </div>
    </div>`;
  }).join('');
}

// ── MISSING DAY LOG ──
function openMissingLogOnIssue(dateStr, pid, iid) {
  openMissingLog(dateStr);
  // pre-select the issue in searchable dropdown
  setTimeout(() => {
    const val = `${pid}::${iid}`;
    // try in existing sdData first
    let item = (_sdData['sdMlIssue'] || []).find(i => i.value === val);
    if (!item) {
      // issue may be closed — find in allIssues and inject
      const found = (allIssues || []).find(i => String(i.project_id) === String(pid) && String(i.iid) === String(iid));
      if (found) {
        item = { value: val, label: `#${found.iid} — ${found.title}` };
        (_sdData['sdMlIssue'] = _sdData['sdMlIssue'] || []).push(item);
        const list = document.getElementById('sdMlIssue_list');
        const opt = document.createElement('div');
        opt.className = 'sd-opt';
        opt.dataset.value = val;
        opt.textContent = item.label;
        opt.onclick = function() { sdSelect('sdMlIssue', val, this); };
        list.appendChild(opt);
      }
    }
    if (item) {
      const el = document.querySelector(`#sdMlIssue_list [data-value="${val}"]`);
      sdSelect('sdMlIssue', val, el);
    }
  }, 50);
}
function openMissingLog(dateStr) {
  // populate date display
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'long' });
  document.getElementById('mlDate').textContent = label;
  document.getElementById('mlDateVal').value = dateStr;
  // populate searchable issue dropdown (open issues)
  const open = (allIssues || []).filter(i => i.state === 'opened');
  sdPopulate('sdMlIssue', open.map(i => {
    const proj = i.references?.full?.split('#')[0] || i.web_url.split('/-/')[0].split('/').slice(-2).join('/');
    return { value: `${i.project_id}::${i.iid}`, label: `#${i.iid} — ${i.title} (${proj})` };
  }));
  sdReset('sdMlIssue', '— Select an open issue —');
  // populate searchable project dropdown
  sdPopulate('sdMlProject', (allProjects || []).map(p => ({ value: String(p.id), label: p.name_with_namespace })));
  sdReset('sdMlProject', '— Select a project —');
  // reset fields
  document.getElementById('mlDuration').value = '';
  document.getElementById('mlDuration2').value = '';
  document.getElementById('mlSummary').value = '';
  document.getElementById('mlTitle').value = '';
  document.getElementById('mlDesc').value = '';
  document.getElementById('mlClose').checked = false;
  mlSwitchTab(1);
  document.getElementById('missingLogModal').classList.add('open');
}
function mlSwitchTab(n) {
  document.getElementById('mlPane1').style.display = n === 1 ? 'block' : 'none';
  document.getElementById('mlPane2').style.display = n === 2 ? 'block' : 'none';
  document.getElementById('mlTab1').classList.toggle('active', n === 1);
  document.getElementById('mlTab2').classList.toggle('active', n === 2);
}
async function submitMissingLog() {
  const dateStr     = document.getElementById('mlDateVal').value;
  const isNew       = document.getElementById('mlPane2').style.display !== 'none';
  const shouldClose = document.getElementById('mlClose').checked;
  try {
    if (!isNew) {
      // existing issue
      const val     = document.getElementById('mlIssue').value;
      const dur     = document.getElementById('mlDuration').value.trim();
      const summary = document.getElementById('mlSummary').value.trim();
      if (!val) return toast('Select an issue', true);
      if (!dur) return toast('Enter a duration', true);
      const [pid, iid] = val.split('::');
      await logTimeGQL(pid, iid, dur, dateStr, summary);
      if (shouldClose) await req(`/projects/${pid}/issues/${iid}`, 'PUT', { state_event: 'close' });
      toast(`✓ Logged ${dur} on ${dateStr}${shouldClose ? ' · closed' : ''}`);
    } else {
      // new issue
      const pid   = document.getElementById('mlProject').value;
      const title = document.getElementById('mlTitle').value.trim();
      const desc  = document.getElementById('mlDesc').value.trim();
      const dur   = document.getElementById('mlDuration2').value.trim();
      if (!pid)   return toast('Select a project', true);
      if (!title) return toast('Enter a title', true);
      const body  = { title, description: desc };
      if (ME) body.assignee_ids = [ME.id];
      const issue = await req(`/projects/${pid}/issues`, 'POST', body);
      if (dur) await logTimeGQL(pid, issue.iid, dur, dateStr, title);
      if (shouldClose) await req(`/projects/${pid}/issues/${issue.iid}`, 'PUT', { state_event: 'close' });
      toast(`✓ Created #${issue.iid}${dur ? ' · ' + dur + ' logged on ' + dateStr : ''}${shouldClose ? ' · closed' : ''}`);
    }
    closeModal('missingLogModal');
    cacheClear();
    loadMonthlyLog();
  } catch(e) { toast('Error: ' + e.message, true); }
}

// ── QUICK CREATE FAB ──
function openQuickCreate() {
  sdPopulate('sdQcProject', (allProjects || []).map(p => ({ value: String(p.id), label: p.name_with_namespace })));
  sdReset('sdQcProject', '— Select a project —');
  document.getElementById('qcTitle').value = '';
  document.getElementById('qcDesc').value = '';
  document.getElementById('qcDuration').value = '';
  document.getElementById('qcDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('qcSummary').value = '';
  document.getElementById('qcClose').checked = false;
  document.getElementById('quickCreateModal').classList.add('open');
  setTimeout(() => document.getElementById('qcTitle').focus(), 100);
}
async function submitQuickCreate() {
  const pid   = document.getElementById('qcProject').value;
  const title = document.getElementById('qcTitle').value.trim();
  const dur     = document.getElementById('qcDuration').value.trim();
  const date    = document.getElementById('qcDate').value;
  const summary = document.getElementById('qcSummary').value.trim();
  const shouldClose = document.getElementById('qcClose').checked;
  if (!pid)   return toast('Select a project', true);
  if (!title) return toast('Enter a title', true);
  const desc = document.getElementById('qcDesc').value.trim();
  try {
    const body = { title };
    if (desc) body.description = desc;
    if (ME) body.assignee_ids = [ME.id];
    const issue = await req(`/projects/${pid}/issues`, 'POST', body);
    if (dur) await logTimeGQL(pid, issue.iid, dur, date, summary || title);
    if (shouldClose) await req(`/projects/${pid}/issues/${issue.iid}`, 'PUT', { state_event: 'close' });
    toast(`✓ #${issue.iid} created${dur ? ' · ' + dur + ' logged on ' + date : ''}${shouldClose ? ' · closed' : ''}`);
    closeModal('quickCreateModal');
    cacheClear();
    loadDashboard();
  } catch(e) { toast('Error: ' + e.message, true); }
}

// ── QUICK LOG FAB ──
function openQuickLog() {
  const sel = document.getElementById('quickIssue');
  const open = allIssues.filter(i => i.state === 'opened');
  sel.innerHTML = '<option value="">— Select an open issue —</option>' +
    open.map(i => {
      const proj = i.references?.full?.split('#')[0] || i.web_url.split('/-/')[0].split('/').slice(-2).join('/');
      return `<option value="${i.project_id}::${i.iid}">#${i.iid} — ${i.title} (${proj})</option>`;
    }).join('');
  document.getElementById('quickDuration').value = '';
  document.getElementById('quickDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('quickSummary').value = '';
  document.getElementById('quickClose').checked = false;
  document.getElementById('quickLogModal').classList.add('open');
  setTimeout(() => document.getElementById('quickDuration').focus(), 100);
}
async function submitQuickLog() {
  const val     = document.getElementById('quickIssue').value;
  const dur     = document.getElementById('quickDuration').value.trim();
  const date    = document.getElementById('quickDate').value;
  const summary = document.getElementById('quickSummary').value.trim();
  if (!val) return toast('Select an issue', true);
  if (!dur) return toast('Enter a duration', true);
  const [pid, iid] = val.split('::');
  const shouldClose = document.getElementById('quickClose').checked;
  try {
    await logTimeGQL(pid, iid, dur, date, summary);
    if (shouldClose) {
      await req(`/projects/${pid}/issues/${iid}`, 'PUT', { state_event: 'close' });
      toast(`✓ Logged ${dur} on ${date} · issue closed`);
    } else {
      toast(`✓ Logged ${dur} on ${date}${summary ? ' · summary added' : ''}`);
    }
    closeModal('quickLogModal');
    cacheClear();
    loadDashboard();
  } catch(e) { toast('Error: ' + e.message, true); }
}

// ── TIME MODAL ──
function openTimeModal(pid, iid, title) {
  activeProjectId = pid; activeIssueIid = iid;
  document.getElementById('timeModalIssue').textContent = `#${iid} — ${title}`;
  document.getElementById('timeInput').value = '';
  document.getElementById('timeDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('timeSummaryInput').value = '';
  document.getElementById('timeModal').classList.add('open');
  setTimeout(() => document.getElementById('timeInput').focus(), 100);
}
async function submitTime() {
  const duration = document.getElementById('timeInput').value.trim();
  if (!duration) return toast('Enter a duration', true);
  try {
    const _tDate = document.getElementById('timeDate')?.value || new Date().toISOString().slice(0,10);
    const _tSum = document.getElementById('timeSummaryInput')?.value.trim() || '';
    await logTimeGQL(activeProjectId, activeIssueIid, duration, _tDate, _tSum);
    toast('✓ Logged ' + duration + ' on ' + _tDate);
    document.getElementById('timeInput').value = '';
    document.getElementById('timeSummaryInput').value = '';
    closeModal('timeModal');
    cacheClear();
    loadMyIssues();
    loadDashboard();
  } catch(e) { toast('Error: ' + e.message, true); }
}

// ── CLOSE MODAL ──
function openCloseModal(pid, iid) {
  activeProjectId = pid; activeIssueIid = iid;
  document.getElementById('closeTimeInput').value = '';
  document.getElementById('closeDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('closeModal').classList.add('open');
}
async function confirmClose() {
  const t    = document.getElementById('closeTimeInput').value.trim();
  const date = document.getElementById('closeDate').value || new Date().toISOString().slice(0, 10);
  try {
    if (t) await logTimeGQL(activeProjectId, activeIssueIid, t, date, '');
    await req(`/projects/${activeProjectId}/issues/${activeIssueIid}`, 'PUT', { state_event: 'close' });
    toast('✓ Issue closed');
    closeModal('closeModal');
    cacheClear();
    loadMyIssues();
    loadDashboard();
  } catch(e) { toast('Error: ' + e.message, true); }
}

// ── NEW LOG ENTRY PAGE ──
function nleSwitchTab(n) {
  document.getElementById('nlePane1').style.display = n === 1 ? 'block' : 'none';
  document.getElementById('nlePane2').style.display = n === 2 ? 'block' : 'none';
  document.getElementById('nleTab1').classList.toggle('active', n === 1);
  document.getElementById('nleTab2').classList.toggle('active', n === 2);
  if (n === 2) initBulkMode();
}

// ── BULK ENTRY ──
let _bulkRowCount = 0;
function initBulkMode() {
  sdPopulate('sdBulkProject', (allProjects || []).map(p => ({ value: String(p.id), label: p.name_with_namespace })));
  if (document.getElementById('bulkRowList').children.length === 0) {
    addBulkRow(); addBulkRow();
  }
}
function addBulkRow() {
  _bulkRowCount++;
  const id = 'br_' + _bulkRowCount;
  const num = document.getElementById('bulkRowList').children.length + 1;
  const today = new Date().toISOString().slice(0, 10);
  const meName = ME ? (ME.name || ME.username) : 'Me';
  const div = document.createElement('div');
  div.className = 'bulk-card';
  div.id = id;
  div.innerHTML = `
    <div class="bulk-card-head">
      <span class="bulk-row-num">${num}</span>
      <input type="text" class="form-input" placeholder="Issue title… *" id="${id}_title" style="font-size:14px;font-weight:600">
      <span id="${id}_badge"></span>
      <button class="bulk-remove-btn" onclick="removeBulkRow('${id}')">✕ Remove</button>
    </div>
    <div class="bulk-card-body">
      <div class="form-group">
        <label class="form-label">Description <span style="color:var(--text3);font-weight:400">(optional)</span></label>
        <textarea class="form-input" id="${id}_desc" placeholder="Steps, context, links…"></textarea>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Time Spent</label>
            <input type="text" class="form-input" placeholder="2h / 1h30m / 45m" id="${id}_dur">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Date</label>
            <input type="date" class="form-input" id="${id}_date" value="${today}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Work Summary <span style="color:var(--text3);font-weight:400">(optional)</span></label>
          <input type="text" class="form-input" placeholder="What did you work on?" id="${id}_summary">
        </div>
      </div>
    </div>
    <div class="bulk-card-foot">
      <label class="bulk-check-item">
        <input type="checkbox" id="${id}_assign" checked style="accent-color:var(--blue)">
        <span>Assign to ${meName}</span>
      </label>
      <label class="bulk-check-item">
        <input type="checkbox" id="${id}_close" style="accent-color:var(--red)">
        <span style="color:var(--red)">Close after creating</span>
      </label>
    </div>`;
  document.getElementById('bulkRowList').appendChild(div);
}
function removeBulkRow(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
  if (document.getElementById('bulkRowList').children.length === 0) addBulkRow();
}
function resetBulkForm() {
  document.getElementById('bulkRowList').innerHTML = '';
  _bulkRowCount = 0;
  sdReset('sdBulkProject', '— Select a project —');
  addBulkRow(); addBulkRow();
}
async function submitBulk() {
  const pid = document.getElementById('bulkProject').value;
  if (!pid) return toast('Select a project', true);
  const rows = document.querySelectorAll('#bulkRowList .bulk-card');
  let submitted = 0, failed = 0;
  for (const row of rows) {
    const id      = row.id;
    const title   = document.getElementById(id + '_title').value.trim();
    const desc    = document.getElementById(id + '_desc').value.trim();
    const dur     = document.getElementById(id + '_dur').value.trim();
    const durDate = document.getElementById(id + '_date')?.value || new Date().toISOString().slice(0, 10);
    const summary = document.getElementById(id + '_summary').value.trim();
    const assign  = document.getElementById(id + '_assign').checked;
    const close   = document.getElementById(id + '_close').checked;
    if (!title) continue;
    const badge = document.getElementById(id + '_badge');
    try {
      const body = { title };
      if (desc) body.description = desc;
      if (assign && ME) body.assignee_ids = [ME.id];
      const issue = await req(`/projects/${pid}/issues`, 'POST', body);
      if (dur) await logTimeGQL(pid, issue.iid, dur, durDate, summary || title);
      if (close) await req(`/projects/${pid}/issues/${issue.iid}`, 'PUT', { state_event: 'close' });
      row.style.opacity = '0.55';
      row.style.pointerEvents = 'none';
      row.style.borderColor = 'var(--green)';
      badge.innerHTML = `<span class="bulk-status ok">✓ #${issue.iid}${close?' · closed':''}</span>`;
      submitted++;
    } catch(e) {
      row.style.borderColor = 'var(--red)';
      badge.innerHTML = `<span class="bulk-status err">✕ Failed</span>`;
      failed++;
    }
  }
  if (submitted === 0 && failed === 0) return toast('No rows to submit — add titles first', true);
  toast(`✓ ${submitted} issue${submitted!==1?'s':''} created${failed?' · '+failed+' failed':''}`);
  cacheClear();
  if (failed === 0) setTimeout(() => resetBulkForm(), 2000);
}

let _assignMe = true;

function initCreatePage() {
  if (ME) {
    const initial = (ME.name || ME.username || '?')[0].toUpperCase();
    document.getElementById('assigneeAvatar').textContent = initial;
    document.getElementById('assigneeName').textContent = ME.name || ME.username;
  }
  if (document.getElementById('timeEntryList').children.length === 0) addTimeRow();
  updateTimeSummary();
}

function toggleAssignee() {
  _assignMe = !_assignMe;
  document.getElementById('assigneeMe').style.opacity = _assignMe ? '1' : '0.4';
  document.getElementById('assigneeToggle').textContent = _assignMe ? '✕ Remove' : '+ Assign me';
}

let _rowCount = 0;
function addTimeRow() {
  _rowCount++;
  const id = 'ter_' + _rowCount;
  const today = new Date().toISOString().slice(0, 10);
  const div = document.createElement('div');
  div.className = 'time-entry-row';
  div.id = id;
  div.innerHTML = `
    <input type="text" placeholder="2h30m / 1h" oninput="updateTimeSummary()" class="ter-dur" id="${id}_dur">
    <input type="date" class="ter-date" id="${id}_date" value="${today}">
    <input type="text" placeholder="What did you work on? (optional)" id="${id}_summary">
    <button class="ter-remove" onclick="removeTimeRow('${id}')" title="Remove">×</button>`;
  document.getElementById('timeEntryList').appendChild(div);
  div.querySelector('.ter-dur').focus();
  updateTimeSummary();
}

function removeTimeRow(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
  updateTimeSummary();
  if (document.getElementById('timeEntryList').children.length === 0) addTimeRow();
}

function parseSecsFromStr(s) {
  if (!s) return 0;
  let secs = 0;
  const d = s.match(/(\d+(?:\.\d+)?)d/i); if (d) secs += parseFloat(d[1]) * 8 * 3600;
  const h = s.match(/(\d+(?:\.\d+)?)h/i); if (h) secs += parseFloat(h[1]) * 3600;
  const m = s.match(/(\d+)m/i);           if (m) secs += parseInt(m[1]) * 60;
  return secs;
}

function updateTimeSummary() {
  const rows = document.querySelectorAll('.ter-dur');
  let total = 0;
  rows.forEach(r => { total += parseSecsFromStr(r.value.trim()); });
  const sumEl = document.getElementById('timeSummary');
  const valEl = document.getElementById('timeSummaryVal');
  const closeOpt = document.getElementById('nleCloseOpt');
  if (total > 0) {
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
    valEl.textContent = m > 0 ? `${h}h ${m}m` : `${h}h`;
    sumEl.style.display = 'flex';
    if (closeOpt) closeOpt.style.display = 'block';
  } else {
    sumEl.style.display = 'none';
    if (closeOpt) closeOpt.style.display = 'none';
  }
}

function resetCreateForm() {
  document.getElementById('createProject').value = '';
  // reset searchable dropdown display
  const lbl = document.getElementById('sdProject_label');
  if (lbl) { lbl.textContent = '— Select a project —'; lbl.className = 'sd-placeholder'; }
  document.querySelectorAll('#sdProject_list .sd-opt').forEach(o => o.classList.remove('selected'));
  document.getElementById('createTitle').value = '';
  document.getElementById('createDesc').value = '';
  document.getElementById('timeEntryList').innerHTML = '';
  const cb = document.getElementById('createAndClose'); if (cb) cb.checked = false;
  document.getElementById('nleCloseOpt').style.display = 'none';
  document.getElementById('timeSummary').style.display = 'none';
  _rowCount = 0;
  _assignMe = true;
  document.getElementById('assigneeMe').style.opacity = '1';
  document.getElementById('assigneeToggle').textContent = '✕ Remove';
  addTimeRow();
}

async function createIssue() {
  const pid   = document.getElementById('createProject').value;
  const title = document.getElementById('createTitle').value.trim();
  const desc  = document.getElementById('createDesc').value.trim();
  const shouldClose = document.getElementById('createAndClose')?.checked;
  if (!pid)   return toast('Select a project', true);
  if (!title) return toast('Enter a title', true);
  const body = { title, description: desc };
  if (_assignMe && ME) body.assignee_ids = [ME.id];
  try {
    const issue = await req(`/projects/${pid}/issues`, 'POST', body);
    // log time entries sequentially
    const rows = document.querySelectorAll('#timeEntryList .time-entry-row');
    let loggedAny = false;
    for (const row of rows) {
      const dur     = row.querySelector('.ter-dur').value.trim();
      const date    = row.querySelector('input[type="date"]').value;
      const summary = row.querySelector('input[type="text"]:not(.ter-dur)').value.trim();
      if (!dur) continue;
      await logTimeGQL(pid, issue.iid, dur, date, summary);
      // summary passed via GraphQL timelogCreate
      loggedAny = true;
    }
    // close if requested
    if (shouldClose) {
      await req(`/projects/${pid}/issues/${issue.iid}`, 'PUT', { state_event: 'close' });
      toast(`✓ Created #${issue.iid}${loggedAny?' · time logged':''} · closed`);
    } else {
      toast(`✓ Created #${issue.iid}${loggedAny?' · time logged':''}`);
    }
    resetCreateForm();
    cacheClear();
    showPage('issues'); loadMyIssues();
  } catch(e) { toast('Error: ' + e.message, true); }
}

// ── SHARED TIME HELPERS ──
function parseTimeNote(body) {
  const m = body.match(/added (.+?) of time spent at (\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  let secs = 0; const t = m[1];
  const mo = t.match(/(\d+)mo/); if (mo) secs += +mo[1] * 4 * 5 * 8 * 3600; // 1mo = 4w
  const w  = t.match(/(\d+)w/);  if (w)  secs += +w[1]  * 5 * 8 * 3600;
  const d  = t.match(/(\d+)d/);  if (d)  secs += +d[1]  * 8 * 3600;
  const h  = t.match(/(\d+)h/);  if (h)  secs += +h[1]  * 3600;
  const mi = t.match(/(\d+)m(?!o)/); if (mi) secs += +mi[1] * 60;
  return { dateStr: m[2], secs };
}
async function fetchTimeNotes(issue) {
  try {
    const notes = await reqAll(`/projects/${issue.project_id}/issues/${issue.iid}/notes`);
    const proj  = issue.references?.full?.split('#')[0] || issue.web_url.split('/-/')[0].split('/').slice(-2).join('/');
    return { issue, proj, notes: notes.filter(n => n.body?.includes('time spent')) };
  } catch { return { issue, proj: '', notes: [] }; }
}
function getSatNum(d, year, month) {
  // returns which Saturday number (1-4) the given date is, or 0 if not Saturday
  const dateObj = new Date(year, month, d);
  if (dateObj.getDay() !== 6) return 0;
  let cnt = 0;
  for (let x = 1; x <= d; x++) if (new Date(year, month, x).getDay() === 6) cnt++;
  return cnt;
}
function isWeekend(dateObj, d, year, month) {
  const day = dateObj.getDay();
  if (day === 5) return true; // Friday always off
  if (day === 6) {
    const satNum = getSatNum(d, year, month);
    return getSatOff().includes(satNum); // off if user marked it off
  }
  return false;
}

// ── MONTHLY LOG ──
const _logNow = new Date();
let _logYear = _logNow.getFullYear();
let _logMonth = _logNow.getMonth();

function changeLogMonth(delta) {
  _logMonth += delta;
  if (_logMonth > 11) { _logMonth = 0; _logYear++; }
  if (_logMonth < 0)  { _logMonth = 11; _logYear--; }
  // hide next button if we're already on current month
  const now = new Date();
  document.getElementById('logNextBtn').style.visibility =
    (_logYear === now.getFullYear() && _logMonth === now.getMonth()) ? 'hidden' : 'visible';
  cacheClear();
  loadMonthlyLog();
}

async function loadMonthlyLog() {
  if (!ME) return;
  document.getElementById('logTable').innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  const now = new Date();
  const year = _logYear, month = _logMonth;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDate = (year === now.getFullYear() && month === now.getMonth()) ? now.getDate() : daysInMonth;

  try {
    const dayMap = await buildDayMap(_logYear, _logMonth); // use selected month

    let totalSecs = 0, worked = 0, missing = 0, rows = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const wkend   = isWeekend(dateObj, d, year, month);
      const future  = d > todayDate;
      const today   = d === todayDate;
      if (future) continue;
      const key      = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const entries  = dayMap[key] || [];
      const daySecs  = entries.reduce((s, e) => s + e.secs, 0);
      const dateFmt  = dateObj.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short' });

      if (entries.length === 0) {
        if (wkend) rows += `<tr class="lweekend"><td class="ldate">${dateFmt}</td><td colspan="2" style="color:var(--text3);font-style:italic">Weekend</td><td></td><td></td></tr>`;
        else { missing++; rows += `<tr class="lmissing"><td class="ldate">${dateFmt}</td><td colspan="2"><span style="color:var(--red);font-style:italic">— missing —</span></td><td></td><td style="text-align:right;white-space:nowrap"><button class="log-missing-btn" onclick="openMissingLog('${key}')">+ Log Time</button></td></tr>`; }
      } else {
        totalSecs += daySecs;
        worked++;
        // target: working Saturday = 7h, other workdays = 8h, off day = no target
        const satNum     = getSatNum(d, year, month);
        const isWorkSat  = satNum > 0 && !getSatOff().includes(satNum);
        const targetSecs = wkend ? 0 : (isWorkSat ? (CFG.sat_hours ?? 7)*3600 : (CFG.day_hours ?? 8)*3600);
        const shortfall   = targetSecs > 0 && daySecs < targetSecs;
        const overtime    = targetSecs > 0 && daySecs > targetSecs;
        const deficit     = shortfall ? targetSecs - daySecs : 0;
        const extra       = overtime  ? daySecs - targetSecs : 0;
        const fmtDef = s => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?(m>0?`${h}h ${m}m`:`${h}h`):`${m}m`; };
        const timeBadge   = shortfall
          ? `<span class="lshort" title="Target: ${fmtH(targetSecs)} | Short by ${fmtDef(deficit)}">▾ ${fmtDef(deficit)} short</span>`
          : overtime
            ? `<span class="lover" title="Target: ${fmtH(targetSecs)} | Extra: ${fmtDef(extra)}">▴ ${fmtDef(extra)} extra</span>`
            : `<span class="lok">✓</span>`;
        const cls = today ? 'ldata ltoday' : 'ldata';
        entries.forEach((e, idx) => {
          const dc = idx === 0 ? `<td class="ldate" rowspan="${entries.length}">${dateFmt}</td>` : '';
          const ac = idx === 0 ? `<td rowspan="${entries.length}" style="text-align:right;white-space:nowrap;vertical-align:middle"><button class="log-missing-btn" onclick="openMissingLogOnIssue('${key}','${e.project_id}','${e.iid}')">+ Log Time</button></td>` : '';
          // single entry: show total+badge in time cell; multi entry: show per-entry time, total in DAY TOTAL row
          const timeTd = entries.length === 1
            ? `<td class="ltime" style="white-space:nowrap">${fmtH(daySecs)} ${timeBadge}</td>`
            : `<td style="color:var(--text3);font-size:13px;text-align:right">${fmtH(e.secs)}</td>`;
          rows += `<tr class="${cls}">${dc}<td style="color:var(--text3);font-size:13px">${e.proj}</td><td><a class="llink" href="${e.url}" target="_blank">#${e.iid}</a> <span style="color:var(--text)">${e.title}</span></td>${timeTd}${ac}</tr>`;
        });
        if (entries.length > 1) rows += `<tr class="ldaytotal"><td></td><td></td><td style="color:var(--text3);font-size:12px;font-weight:700;text-align:right">DAY TOTAL</td><td class="ltime" style="white-space:nowrap">${fmtH(daySecs)} ${timeBadge}</td><td></td></tr>`;
      }
    }

    document.getElementById('logTable').innerHTML = `
      <div class="log-bar">
        <div class="log-bar-item"><div class="log-bar-label">Total Hours</div><div class="log-bar-value" style="color:var(--blue)">${fmtH(totalSecs)}</div></div>
        <div class="log-bar-item"><div class="log-bar-label">Days Worked</div><div class="log-bar-value" style="color:var(--green)">${worked}</div></div>
        <div class="log-bar-item"><div class="log-bar-label">Missing Days</div><div class="log-bar-value" style="color:${missing>0?'var(--red)':'var(--green)'}">${missing}</div></div>
      </div>
      <div class="table-card">
        <table class="ltable">
          <thead><tr><th>Date</th><th>Project</th><th>Issue</th><th style="text-align:right">Time</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    sc('render_log', document.getElementById('logTable').innerHTML);
    updateLogLabel();
  } catch(e) {
    document.getElementById('logTable').innerHTML = `<div class="empty"><div class="eicon">⚠️</div><p>${e.message}</p></div>`;
  }
}

// ── TIME REPORT ──
const _timeNow = new Date();
let _timeYear  = _timeNow.getFullYear();
let _timeMonth = _timeNow.getMonth();

function changeTimeMonth(delta) {
  _timeMonth += delta;
  if (_timeMonth > 11) { _timeMonth = 0; _timeYear++; }
  if (_timeMonth < 0)  { _timeMonth = 11; _timeYear--; }
  const now = new Date();
  document.getElementById('timeNextBtn').style.visibility =
    (_timeYear === now.getFullYear() && _timeMonth === now.getMonth()) ? 'hidden' : 'visible';
  cacheClear();
  loadTimeReport();
}

function updateTimeLabel() {
  const d = new Date(_timeYear, _timeMonth, 1);
  const now = new Date();
  document.getElementById('timeMonthLabel').textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('timeNextBtn').style.visibility =
    (_timeYear === now.getFullYear() && _timeMonth === now.getMonth()) ? 'hidden' : 'visible';
}

async function loadTimeReport() {
  if (!ME) return;
  document.getElementById('timeList').innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  const year = _timeYear, month = _timeMonth;
  const monthStart = new Date(year, month, 1).toISOString();
  try {
    const issues  = await reqAll(`/issues?assignee_username=${ME.username}&state=all&scope=all&updated_after=${monthStart}`);
    document.getElementById('timeList').innerHTML = '<div class="loading"><span class="spinner"></span>Parsing notes…</div>';
    const results = await Promise.all(issues.map(fetchTimeNotes));
    const map = {};
    for (const { issue, proj, notes } of results) {
      const key = `${issue.project_id}-${issue.iid}`;
      for (const note of notes) {
        const p = parseTimeNote(note.body);
        if (!p) continue;
        const [ny, nm] = p.dateStr.split('-').map(Number);
        if (ny !== year || nm !== month + 1) continue;
        if (!map[key]) map[key] = { issue, proj, secs: 0, last: p.dateStr };
        map[key].secs += p.secs;
        if (p.dateStr > map[key].last) map[key].last = p.dateStr;
      }
    }
    // Group by project
    const projMap = {};
    for (const { proj, secs } of Object.values(map)) {
      if (!projMap[proj]) projMap[proj] = 0;
      projMap[proj] += secs;
    }
    const projEntries = Object.entries(projMap).sort((a, b) => b[1] - a[1]);
    const monthSec = projEntries.reduce((s, [, v]) => s + v, 0);

    document.getElementById('statMonth').textContent  = fmtH(monthSec);
    document.getElementById('statIssues').textContent = projEntries.length;
    sc('stat_month', fmtH(monthSec));
    sc('stat_issues', String(projEntries.length));
    updateTimeLabel();

    if (!projEntries.length) {
      document.getElementById('timeList').innerHTML = '<div class="empty"><div class="eicon">📅</div><p>No time logged this month</p></div>';
      return;
    }
    const maxProjSec = projEntries[0][1];
    document.getElementById('timeList').innerHTML = `
      <div class="table-card">
      <table class="dtable">
        <thead><tr><th>Project</th><th>Hours This Month</th><th style="width:40%"></th></tr></thead>
        <tbody>${projEntries.map(([proj, secs]) => {
          const pct = Math.round((secs / maxProjSec) * 100);
          return `<tr>
            <td style="font-weight:600;color:var(--text)">${proj}</td>
            <td style="color:var(--purple);font-weight:800;font-size:16px;white-space:nowrap">${fmtH(secs)}</td>
            <td>
              <div style="height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:var(--blue);border-radius:4px;transition:width .4s"></div>
              </div>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    sc('render_time', document.getElementById('timeList').innerHTML);
  } catch(e) {
    document.getElementById('timeList').innerHTML = `<div class="empty"><div class="eicon">⚠️</div><p>${e.message}</p></div>`;
  }
}

// ── UTILS ──
function loadTimeReportIfNeeded() {
  const html = gc('render_time');
  if (html) {
    document.getElementById('statMonth').textContent  = gc('stat_month')  || '—';
    document.getElementById('statIssues').textContent = gc('stat_issues') || '—';
    document.getElementById('timeList').innerHTML = html;
    updateTimeLabel();
  } else {
    loadTimeReport();
  }
}
function loadMonthlyLogIfNeeded() {
  const html = gc('render_log');
  if (html) {
    document.getElementById('logTable').innerHTML = html;
  } else {
    loadMonthlyLog();
  }
}

function fmtH(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : (m > 0 ? `${m}m` : '0m');
}
const PAGE_URLS = { dashboard: '/dashboard', issues: '/issues', create: '/create', log: '/log', time: '/time', summary: '/summary', assistant: '/assistant' };
const URL_PAGES = Object.fromEntries(Object.entries(PAGE_URLS).map(([k,v]) => [v, k]));

function showPage(name, pushUrl = true) {
  document.documentElement.removeAttribute('data-initial-page');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
  if (pushUrl) history.pushState({ page: name }, '', PAGE_URLS[name] || '/dashboard');
  if (name === 'time')      { updateLabels(); loadTimeReportIfNeeded(); }
  if (name === 'log')       { updateLabels(); loadMonthlyLogIfNeeded(); }
  if (name === 'issues')    loadMyIssues();
  if (name === 'summary')   initSummaryPage();
  if (name === 'dashboard') loadDashboard();
  if (name === 'create')    initCreatePage();
  if (name === 'assistant') initAssistantPage();
  const fab = document.getElementById('aiFab');
  if (fab) fab.style.display = name === 'assistant' ? 'none' : 'flex';
}

function initAssistantPage() {
  if (_aiHistory.length === 0) {
    aiMsgBox().innerHTML = '';
    appendAiMsg('assistant', craftyGreeting());
  } else {
    renderAiHistory();
  }
  setTimeout(() => document.getElementById('aiPageInput')?.focus(), 100);
}
window.addEventListener('popstate', e => {
  const name = e.state?.page || URL_PAGES[location.pathname] || 'dashboard';
  showPage(name, false);
});
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function toast(msg, err=false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});
// ── KEYBOARD HINT ──
function toggleKbd(e) {
  e.stopPropagation();
  const p = document.getElementById('kbdPopup');
  const isOpen = p.style.display !== 'none';
  p.style.display = isOpen ? 'none' : 'block';
  document.getElementById('kbdBtn').style.color = isOpen ? 'var(--text3)' : 'var(--blue)';
  document.getElementById('kbdBtn').style.borderColor = isOpen ? 'var(--border2)' : 'var(--blue)';
}
document.addEventListener('click', () => {
  const p = document.getElementById('kbdPopup');
  if (p && p.style.display !== 'none') {
    p.style.display = 'none';
    document.getElementById('kbdBtn').style.color = 'var(--text3)';
    document.getElementById('kbdBtn').style.borderColor = 'var(--border2)';
  }
});

// ── SUMMARY ──
let _summaryInited = false;
let _summaryOpenIssues = [];
let _summaryAssignees = []; // [{key, name}]
let _summaryCheckedKeys = new Set();

function initSummaryPage() {
  if (!_summaryInited) {
    sdPopulate('sdSummaryProject', allProjects.map(p => ({ value: String(p.id), label: p.name_with_namespace })));
    _summaryInited = true;
  }
}

function summaryAssigneeKey(a) { return a ? String(a.id) : '__unassigned__'; }
function summaryAssigneeName(a) { return a ? a.name : 'Unassigned'; }

async function loadSummary() {
  const pid = document.getElementById('summaryProject').value;
  if (!pid) return toast('Select a product first', true);
  const btn = document.getElementById('summaryGetBtn');
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;border-color:rgba(255,255,255,.4);border-top-color:#fff;margin-right:6px"></span> Loading…'; btn.disabled = true;
  document.getElementById('summaryBody').style.display = 'none';
  document.getElementById('summaryEmpty').innerHTML = '<div class="loading"><span class="spinner"></span>Fetching issues…</div>';
  try {
    const openIssues = await reqAll(`/projects/${pid}/issues?state=opened`);

    _summaryOpenIssues = openIssues;

    const byKey = new Map();
    openIssues.forEach(i => {
      (i.assignees && i.assignees.length ? i.assignees : [null]).forEach(a => {
        const key = summaryAssigneeKey(a);
        if (!byKey.has(key)) byKey.set(key, summaryAssigneeName(a));
      });
    });
    _summaryAssignees = [...byKey.entries()].map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    _summaryCheckedKeys = new Set(_summaryAssignees.map(a => a.key)); // all selected by default

    const today = new Date().toISOString().slice(0, 10);
    const overdueCount = openIssues.filter(i => i.due_date && i.due_date < today).length;
    const unassignedCount = openIssues.filter(i => !i.assignees || !i.assignees.length).length;

    document.getElementById('summaryKpiOpen').textContent = openIssues.length;
    document.getElementById('summaryKpiAssignees').textContent = _summaryAssignees.filter(a => a.key !== '__unassigned__').length;
    document.getElementById('summaryKpiOverdue').textContent = overdueCount;
    document.getElementById('summaryKpiUnassigned').textContent = unassignedCount;
    document.getElementById('summaryAiBody').innerHTML = '<span style="color:var(--text3)">Click "Generate AI Summary" to get an AI write-up of the open issues below.</span>';

    renderSummaryAssignees();
    renderSummaryByAssignee();

    document.getElementById('summaryEmpty').innerHTML = '';
    document.getElementById('summaryBody').style.display = 'block';
  } catch (e) {
    document.getElementById('summaryEmpty').innerHTML = `<div class="sd-empty" style="display:block">Error: ${esc(e.message)}</div>`;
  }
  btn.innerHTML = orig; btn.disabled = false;
}

function renderSummaryAssignees() {
  const el = document.getElementById('summaryAssigneeList');
  el.innerHTML = _summaryAssignees.length
    ? _summaryAssignees.map(a => {
        const checked = _summaryCheckedKeys.has(a.key);
        return `<label class="chip ${checked ? 'chip-blue' : 'chip-gray'}" style="cursor:pointer;user-select:none">
          <input type="checkbox" ${checked ? 'checked' : ''} onchange="summaryToggleAssignee('${a.key}')" style="margin-right:4px">${esc(a.name)}
        </label>`;
      }).join('')
    : '<span style="color:var(--text3);font-size:13px">No open issues</span>';
}

function summaryToggleAssignee(key) {
  if (_summaryCheckedKeys.has(key)) _summaryCheckedKeys.delete(key);
  else _summaryCheckedKeys.add(key);
  renderSummaryAssignees();
  renderSummaryByAssignee();
}

function summarySetAllAssignees(all) {
  _summaryCheckedKeys = all ? new Set(_summaryAssignees.map(a => a.key)) : new Set();
  renderSummaryAssignees();
  renderSummaryByAssignee();
}

function summaryFilteredIssues() {
  return _summaryOpenIssues.filter(i => {
    const keys = (i.assignees && i.assignees.length ? i.assignees : [null]).map(summaryAssigneeKey);
    return keys.some(k => _summaryCheckedKeys.has(k));
  });
}

function renderSummaryByAssignee() {
  const el = document.getElementById('summaryByAssignee');
  const groups = _summaryAssignees.filter(a => _summaryCheckedKeys.has(a.key)).map(a => {
    const issues = _summaryOpenIssues.filter(i =>
      (i.assignees && i.assignees.length ? i.assignees : [null]).some(x => summaryAssigneeKey(x) === a.key)
    );
    return { ...a, issues };
  }).filter(g => g.issues.length);

  if (!groups.length) { el.innerHTML = '<div class="sd-empty" style="display:block">No open issues for the selected assignees 🎉</div>'; return; }

  el.innerHTML = groups.map(g => `
    <div style="padding:12px 0;border-bottom:1px solid var(--border2)">
      <div style="font-weight:700;font-size:13px;margin-bottom:6px">${esc(g.name)} <span style="color:var(--text3);font-weight:500">[${g.issues.length} Issue${g.issues.length === 1 ? '' : 's'}]</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${g.issues.map(i => `<a href="${i.web_url}" target="_blank" class="ai-link" style="font-size:12px">#${i.iid}</a>`).join('')}
      </div>
    </div>`).join('');
}

function copySummaryByAssignee() {
  const groups = _summaryAssignees.filter(a => _summaryCheckedKeys.has(a.key)).map(a => {
    const issues = _summaryOpenIssues.filter(i =>
      (i.assignees && i.assignees.length ? i.assignees : [null]).some(x => summaryAssigneeKey(x) === a.key)
    );
    return { ...a, issues };
  }).filter(g => g.issues.length);

  if (!groups.length) return toast('No open issues for the selected assignees', true);

  const pid = document.getElementById('summaryProject').value;
  const proj = allProjects.find(p => String(p.id) === String(pid));
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const lines = [
    `Project Name : ${proj?.name || ''}`,
    '',
    `Assignee Summary ${dateStr} at ${timeStr}`,
    '',
    ...groups.map((g, idx) => `${idx + 1}.${g.name} — ${g.issues.length} Open Issue${g.issues.length === 1 ? '' : 's'} (${g.issues.map(i => '#' + i.iid).join(', ')})`)
  ];
  const text = lines.join('\n');

  navigator.clipboard?.writeText(text).then(() => {
    const btn = document.getElementById('summaryCopyBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">✓</span> Copied';
    setTimeout(() => btn.innerHTML = orig, 1200);
  }).catch(() => toast('Copy failed', true));
}

async function generateAiSummary() {
  const issues = summaryFilteredIssues();
  const aiBody = document.getElementById('summaryAiBody');
  const btn = document.getElementById('summaryAiBtn');
  if (!issues.length) { aiBody.innerHTML = '<span style="color:var(--text3)">No open issues for the selected assignees.</span>'; return; }
  if (!aiConfigured()) { toast('Add an AI API key in Settings (S)', true); return; }

  const pid = document.getElementById('summaryProject').value;
  const proj = allProjects.find(p => String(p.id) === String(pid));
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const byAssignee = {};
  issues.forEach(i => {
    (i.assignees && i.assignees.length ? i.assignees : [null]).forEach(a => {
      const name = summaryAssigneeName(a);
      (byAssignee[name] = byAssignee[name] || []).push(`#${i.iid} ${i.title}`);
    });
  });
  const listText = Object.entries(byAssignee)
    .map(([name, items]) => `${name} [${items.length} Issue${items.length === 1 ? '' : 's'}]:\n${items.join('\n')}`)
    .join('\n\n');

  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="btn-icon">✦</span> Generating…'; btn.disabled = true;
  aiBody.innerHTML = '<div class="loading"><span class="spinner"></span>Generating…</div>';
  try {
    const text = await aiCall(
      `You are a project assistant. Date: ${today}. Product: "${proj?.name}".\n\nOpen issues grouped by assignee:\n\n${listText}\n\nWrite a short, clear summary (3-6 sentences) describing the overall state of work: total open issues, common themes/areas, and anything urgent or blocking. Do not just repeat the raw list.`
    ) || '';
    aiBody.innerHTML = text ? mdToHtml(text) : '<span style="color:var(--text3)">No summary returned.</span>';
  } catch (e) {
    aiBody.innerHTML = `<span style="color:var(--red)">AI error: ${esc(e.message)}</span>`;
  }
  btn.innerHTML = orig; btn.disabled = false;
}

// ── AI (GEMINI) ──
// ── AI PROVIDER ROUTER ──
function aiProvider() { return CFG.ai_provider || 'gemini'; }
function aiConfigured() { return aiProvider() === 'groq' ? !!CFG.groq_key : !!CFG.gemini_key; }

// Single entry point for all AI calls — routes to the configured provider.
async function aiCall(prompt) {
  return aiProvider() === 'groq' ? groqCall(prompt) : geminiCall(prompt);
}

async function geminiCall(prompt) {
  const key = CFG.gemini_key;
  if (!key) { toast('Add Gemini API key in Settings (S)', true); return null; }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CFG.gemini_model||'gemini-2.5-flash-lite'}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.statusText); }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function groqCall(prompt) {
  const key = CFG.groq_key;
  if (!key) { toast('Add Groq API key in Settings (S)', true); return null; }
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CFG.groq_model || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) { let e; try { e = await res.json(); } catch {} throw new Error(e?.error?.message || res.statusText); }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function aiGenerateIssue(titleId = 'qcTitle', descId = 'qcDesc', btnId = 'aiGenBtn') {
  const titleEl = document.getElementById(titleId);
  const hint = titleEl.value.trim();
  if (!hint) return toast('Type a brief idea first, then click AI Generate', true);
  const btn = document.getElementById(btnId);
  const orig = btn.textContent;
  btn.textContent = '✦ Generating…'; btn.disabled = true;
  try {
    const result = await aiCall(
      `You are a software project manager. Based on this brief idea, generate a clear issue title and a short description (2-4 sentences max).\n\nIdea: "${hint}"\n\nRespond in this exact JSON format:\n{"title":"...","description":"..."}`
    );
    const json = JSON.parse(result.match(/\{[\s\S]*\}/)[0]);
    titleEl.value = json.title || hint;
    const descEl = descId && document.getElementById(descId);
    if (descEl) descEl.value = json.description || '';
  } catch(e) { toast('AI error: ' + e.message, true); }
  btn.textContent = orig; btn.disabled = false;
}

// AI Chat state
const AI_STORE = 'crafty_chat_v1';
let _aiHistory = [];
try { _aiHistory = JSON.parse(localStorage.getItem(AI_STORE)) || []; } catch { _aiHistory = []; }

// Which chat view is active — the floating modal (if open) or the full page.
function aiOnPage() {
  return !document.getElementById('aiChatModal')?.classList.contains('open')
    && document.getElementById('page-assistant')?.classList.contains('active');
}
function aiMsgBox()    { return document.getElementById(aiOnPage() ? 'aiPageMessages' : 'aiChatMessages'); }
function aiInputEl()   { return document.getElementById(aiOnPage() ? 'aiPageInput'    : 'aiChatInput'); }
function aiSendBtnEl() { return document.getElementById(aiOnPage() ? 'aiPageSendBtn'  : 'aiSendBtn'); }
function aiMicBtnEl()  { return document.getElementById(aiOnPage() ? 'aiPageMicBtn'   : 'aiMicBtn'); }

function saveAiHistory() {
  try { localStorage.setItem(AI_STORE, JSON.stringify(_aiHistory.slice(-60))); } catch {}
}

function fmtAiTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Lightweight, safe markdown → HTML (bold, italic, code, links, bullets).
function mdToHtml(src) {
  let s = esc(src || '');
  const stash = [];
  const keep = html => { stash.push(html); return `${stash.length - 1}`; };
  s = s.replace(/```([\s\S]*?)```/g, (m, c) => keep(`<pre class="ai-pre"><code>${c.replace(/^\n/, '')}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (m, c) => keep(`<code class="ai-code">${c}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => keep(`<a href="${u}" target="_blank" class="ai-link">${t}</a>`));
  s = s.replace(/(https?:\/\/[^\s<]+)/g, u => keep(`<a href="${u}" target="_blank" class="ai-link">${u}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  s = s.replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>');
  s = s.replace(/^[ \t]*[-*] +/gm, '• ');
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/(\d+)/g, (m, i) => stash[+i]);
  return s;
}

function aiCopy(btn) {
  const raw = btn.closest('.ai-row')?.dataset.raw || '';
  navigator.clipboard?.writeText(raw).then(() => { btn.textContent = '✓ copied'; setTimeout(() => btn.textContent = '⧉ copy', 1200); });
}

// Build (but don't store) a message bubble. Returns the content element (for streaming).
function renderAiBubble(role, text, ts) {
  const box = aiMsgBox();
  const isUser = role === 'user';
  const row = document.createElement('div');
  row.className = 'ai-row';
  row.dataset.raw = text;
  row.style.cssText = `display:flex;flex-direction:column;align-items:${isUser ? 'flex-end' : 'flex-start'};gap:3px`;
  const bubble = document.createElement('div');
  bubble.style.cssText = `max-width:82%;padding:10px 14px;border-radius:${isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};background:${isUser ? 'var(--blue)' : 'var(--surface2)'};color:${isUser ? '#fff' : 'var(--text)'};font-size:13px;line-height:1.55;word-wrap:break-word`;
  bubble.innerHTML = isUser ? esc(text).replace(/\n/g, '<br>') : mdToHtml(text);
  const meta = document.createElement('div');
  meta.className = 'ai-meta';
  meta.innerHTML = `<span>${fmtAiTime(ts)}</span>${isUser ? '' : '<button class="ai-copy" onclick="aiCopy(this)">⧉ copy</button>'}`;
  row.appendChild(bubble);
  row.appendChild(meta);
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  return bubble;
}

function renderAiHistory() {
  const box = aiMsgBox();
  box.innerHTML = '';
  _aiHistory.forEach(m => renderAiBubble(m.role, m.text, m.ts));
  box.scrollTop = box.scrollHeight;
}

function craftyGreeting() {
  const _parts = (ME?.name || '').trim().split(/\s+/).filter(Boolean);
  const _first = _parts.length ? _parts[_parts.length - 1] : 'boss';
  const _lines = [
    `Hey ${_first}! ☕ I'm Crafty 🛠️ — you sip your coffee, I'll handle the boring stuff. What's the mission? 🚀`,
    `${_first}! 🙌 Crafty here. Just tell me what to do and consider it done. Where do we start? ✨`,
    `Crafty reporting for duty, ${_first}! 🫡 What do you need today? 😎`,
    `Oh hey ${_first}! 😄 It's Crafty — I've got the issues covered, just point me at one. 🔥`,
    `${_first} has entered the chat! 😏 Crafty at your service — the tickets are mine to handle. Fire away! 🎯`
  ];
  return _lines[Math.floor(Math.random() * _lines.length)];
}

function openAiChat() {
  if (!aiConfigured()) {
    toast('Add an AI provider key in Settings (S) first', true);
    openSettings();
    return;
  }
  document.getElementById('aiChatModal').classList.add('open');
  if (_aiHistory.length === 0) appendAiMsg('assistant', craftyGreeting());
  else renderAiHistory();
  setTimeout(() => aiInputEl().focus(), 100);
}

function clearAiChat() {
  if (_aiHistory.length && !confirm('Start a new chat? This clears the current conversation.')) return;
  _aiHistory = [];
  saveAiHistory();
  aiMsgBox().innerHTML = '';
  appendAiMsg('assistant', craftyGreeting());
  aiInputEl().focus();
}

function appendAiMsg(role, text) {
  const ts = Date.now();
  _aiHistory.push({ role, text, ts });
  saveAiHistory();
  renderAiBubble(role, text, ts);
}

// Append an assistant message with a typewriter/streaming effect.
function appendAiMsgStream(text) {
  const ts = Date.now();
  _aiHistory.push({ role: 'assistant', text, ts });
  saveAiHistory();
  const bubble = renderAiBubble('assistant', '', ts);
  const box = aiMsgBox();
  const step = Math.max(3, Math.round(text.length / 90));
  let i = 0;
  (function tick() {
    i = Math.min(text.length, i + step);
    bubble.innerHTML = mdToHtml(text.slice(0, i)) + (i < text.length ? '<span class="ai-cursor">▋</span>' : '');
    box.scrollTop = box.scrollHeight;
    if (i < text.length) setTimeout(tick, 16);
    else bubble.innerHTML = mdToHtml(text);
  })();
}

function showAiTyping() {
  const box = aiMsgBox();
  const div = document.createElement('div');
  div.id = 'aiTypingIndicator';
  div.style.cssText = 'display:flex;justify-content:flex-start';
  div.innerHTML = `<div style="padding:12px 16px;border-radius:14px 14px 14px 4px;background:var(--surface2)"><span class="typing-dots"><span></span><span></span><span></span></span></div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function hideAiTyping() {
  const el = document.getElementById('aiTypingIndicator');
  if (el) el.remove();
}

// Voice input via browser speech recognition.
let _aiRecog = null;
function aiVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice input not supported in this browser', true); return; }
  const btn = aiMicBtnEl();
  const input = aiInputEl();
  if (_aiRecog) { _aiRecog.stop(); return; }
  const r = _aiRecog = new SR();
  r.lang = 'en-US'; r.interimResults = true; r.continuous = false;
  const baseVal = input.value;
  btn.classList.add('recording'); btn.style.color = 'var(--red)';
  r.onresult = e => {
    let txt = '';
    for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
    input.value = (baseVal ? baseVal + ' ' : '') + txt;
  };
  r.onerror = () => toast('Voice input error', true);
  r.onend = () => { btn.classList.remove('recording'); btn.style.color = ''; _aiRecog = null; input.focus(); };
  r.start();
}

// Quick stat card injected into the chat (live snapshot, not stored).
async function craftyStats() {
  if (!TOKEN || !ME) { toast('Connect first', true); return; }
  const box = aiMsgBox();
  showAiTyping();
  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const dayMap = await buildDayMap(now.getFullYear(), now.getMonth());
    const wd = (now.getDay() + 6) % 7; const mon = new Date(now); mon.setDate(now.getDate() - wd);
    const weekFrom = mon.toISOString().slice(0, 10);
    const monthFrom = todayStr.slice(0, 8) + '01';
    let todaySec = 0, weekSec = 0, monthSec = 0; const proj = {};
    for (const [date, entries] of Object.entries(dayMap)) {
      for (const e of entries) {
        if (date === todayStr) todaySec += e.secs;
        if (date >= weekFrom && date <= todayStr) weekSec += e.secs;
        if (date >= monthFrom && date <= todayStr) { monthSec += e.secs; const k = e.proj || projName(e.pid); proj[k] = (proj[k] || 0) + e.secs; }
      }
    }
    const top = Object.entries(proj).sort((a, b) => b[1] - a[1]).slice(0, 3);
    hideAiTyping();
    const kpi = (label, val) => `<div style="flex:1;text-align:center;background:var(--surface);border-radius:10px;padding:8px 4px"><div style="font-size:16px;font-weight:800;color:var(--blue)">${val}</div><div style="font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:var(--text3);margin-top:2px">${label}</div></div>`;
    const projRows = top.length
      ? top.map(([p, s]) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;gap:8px"><span style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p)}</span><b style="flex-shrink:0">${fmtH(s)}</b></div>`).join('')
      : '<div style="font-size:12px;color:var(--text3)">No time logged this month yet.</div>';
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;justify-content:flex-start';
    div.innerHTML = `<div style="max-width:90%;width:100%;padding:12px 14px;border-radius:14px;background:var(--surface2);border:1px solid var(--border2)">
        <div style="font-weight:700;margin-bottom:8px">📊 Your time at a glance</div>
        <div style="display:flex;gap:6px;margin-bottom:10px">${kpi('Today', fmtH(todaySec))}${kpi('This week', fmtH(weekSec))}${kpi('This month', fmtH(monthSec))}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--text3);margin-bottom:2px">Top projects · this month</div>
        ${projRows}
      </div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  } catch(e) { hideAiTyping(); appendAiMsg('assistant', '⚠️ Could not load stats: ' + e.message); }
}

async function aiChatSend() {
  const input = aiInputEl();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  appendAiMsg('user', text);
  const btn = aiSendBtnEl();
  btn.textContent = '…'; btn.disabled = true;
  showAiTyping();

  // Build context about current user's data
  const today = new Date().toISOString().slice(0,10);
  const projList = (allProjects||[]).slice(0,60).map(p => `${p.id}: ${p.name_with_namespace}`).join('\n') || 'none loaded';
  const _open = (allIssues||[]).filter(i=>i.state==='opened');
  const openIssues = _open.map(i=>`#${i.iid} (project ${i.project_id}) "${i.title}"${i.due_date?` [due ${i.due_date}]`:''}`).join('\n') || 'none loaded';
  const dueSoon = _open.filter(i=>i.due_date && i.due_date <= today).map(i=>`#${i.iid} "${i.title}" (due ${i.due_date})`);
  const dueLine = dueSoon.length ? `\n⚠️ Overdue / due today: ${dueSoon.join('; ')}.` : '';
  const _nameParts = (ME?.name || '').trim().split(/\s+/).filter(Boolean);
  const _addr = _nameParts.length ? _nameParts[_nameParts.length - 1] : 'there';
  const context = `You are Crafty 🛠️, the friendly AI assistant for the WebCrafter team's Codelab (GitLab) personal dashboard. If asked your name, you're Crafty. The user's full name is ${ME?.name || 'a developer'}. Do NOT use their name in every message — that feels robotic. Only use it occasionally when it feels natural (e.g. a greeting or a friendly nudge), like a real person would. When you do use it, use "${_addr}" (their last name), never their first name.
Today is ${today} (${new Date().toLocaleDateString('en-US',{weekday:'long'})}). Use this for any relative dates ("today", "yesterday", etc).${dueLine}
You may format replies with simple markdown (bold, lists, links, code).

You can PERFORM actions for the user. When — and only when — the user clearly asks to create an issue or log/add time, respond with ONLY a fenced code block tagged "action" containing a single JSON object (no other text). Otherwise reply normally in plain language.

Available projects (id: name):
${projList}

User's open issues:
${openIssues}

ACTION FORMATS:
1) Create an issue (optionally with time entries / closing it):
\`\`\`action
{"action":"create_issue","project_id":123,"title":"...","description":"...","close":false,"time":[{"duration":"2h","date":"YYYY-MM-DD","summary":"..."}]}
\`\`\`
("time" is optional; omit or use [] if no time. "close" optional, default false. "description" optional.)

2) Log time on an existing issue:
\`\`\`action
{"action":"log_time","project_id":123,"issue_iid":45,"duration":"1h30m","date":"YYYY-MM-DD","summary":"..."}
\`\`\`

3) Close an existing issue:
\`\`\`action
{"action":"close_issue","project_id":123,"issue_iid":45}
\`\`\`
4) Reopen a closed issue:
\`\`\`action
{"action":"reopen_issue","project_id":123,"issue_iid":45}
\`\`\`
5) Add a comment/note to an issue:
\`\`\`action
{"action":"comment_issue","project_id":123,"issue_iid":45,"comment":"..."}
\`\`\`
6) Edit an issue's title and/or description:
\`\`\`action
{"action":"edit_issue","project_id":123,"issue_iid":45,"title":"...","description":"..."}
\`\`\`
7) Set/change an issue's due date:
\`\`\`action
{"action":"set_due_date","project_id":123,"issue_iid":45,"due_date":"YYYY-MM-DD"}
\`\`\`
8) Add labels to an issue (comma-separated):
\`\`\`action
{"action":"add_label","project_id":123,"issue_iid":45,"labels":"bug,urgent"}
\`\`\`
9) Assign an issue. "assignee" = "me", "none" (to unassign), or a person's name/username (the app resolves the name):
\`\`\`action
{"action":"assign_issue","project_id":123,"issue_iid":45,"assignee":"Shahin"}
\`\`\`
13) Remove labels from an issue (comma-separated):
\`\`\`action
{"action":"remove_label","project_id":123,"issue_iid":45,"labels":"bug"}
\`\`\`
14) Set the time estimate on an issue:
\`\`\`action
{"action":"set_estimate","project_id":123,"issue_iid":45,"estimate":"4h"}
\`\`\`
15) Set the milestone on an issue (the app resolves the milestone name to its id):
\`\`\`action
{"action":"set_milestone","project_id":123,"issue_iid":45,"milestone":"Sprint 1"}
\`\`\`
16) Log time on SEVERAL issues at once:
\`\`\`action
{"action":"bulk_log_time","items":[{"project_id":123,"issue_iid":12,"duration":"2h","date":"YYYY-MM-DD","summary":"..."},{"project_id":123,"issue_iid":15,"duration":"1h"}]}
\`\`\`
17) Create SEVERAL issues at once (all in one project):
\`\`\`action
{"action":"bulk_create_issues","project_id":123,"issues":[{"title":"...","description":"...","close":false,"time":[{"duration":"2h"}]},{"title":"..."}]}
\`\`\`

READ ACTIONS (to look up info — including issues NOT assigned to the user — that isn't in the lists above). These run automatically and return data to you; you then answer the user in plain language. Use them when the user asks about an issue you don't already have details for:
10) Get one issue's full details (when you know the project + issue number):
\`\`\`action
{"action":"lookup_issue","project_id":123,"issue_iid":45}
\`\`\`
11) Search issues across all accessible projects by text or number:
\`\`\`action
{"action":"search_issues","query":"login bug"}
\`\`\`
11b) List/count issues with filters — by project, by who they're assigned to (person's name or username), and/or state. Use this for questions like "how many issues are assigned to <person> in <project>" or "what's open in <project>":
\`\`\`action
{"action":"list_issues","project_id":123,"assignee":"Shahin","state":"opened"}
\`\`\`
(All fields optional. state = "opened" | "closed" | "all". Omit project_id to search across all projects. Omit assignee for everyone. The app resolves a person's display name to their account automatically.)
12) Summarize the user's own logged work (for standups / "what did I do"). period = "today" | "week" | "month":
\`\`\`action
{"action":"work_summary","period":"week"}
\`\`\`
18) Time report broken down BY PROJECT (how many hours per project). period = "week" | "month":
\`\`\`action
{"action":"time_report","period":"month"}
\`\`\`

Rules: pick project_id from the list above by matching the project name the user mentions. For write actions the app shows the user a confirmation before doing anything. Read actions (lookup/search/list/work_summary/time_report) run silently — use search_issues if you don't know which project an issue belongs to. Duration format examples: "2h", "30m", "1h30m", "1d" (1d=8h). If the user hasn't given enough info for a WRITE action (e.g. which project, or a title), DO NOT emit it — ask a short clarifying question instead.
LANGUAGE: Always reply in the SAME language/script the user wrote in — if they write Bangla, reply in Bangla; if Banglish (Bangla in English letters), reply in Banglish; if English, English.
STANDUP: When the user asks for a standup / daily update, run work_summary then format the reply as a clean, copy-ready bullet list (one line per task with the time). Keep normal replies concise.`;

  const history = _aiHistory.slice(-10).map(m => `${m.role==='user'?'User':'Assistant'}: ${m.text}`).join('\n');
  const prompt = `${context}\n\nConversation:\n${history}\nUser: ${text}\nAssistant:`;

  try {
    let convo = prompt;
    let handled = false;
    // Allow up to a few read-action rounds before producing a final answer.
    for (let round = 0; round < 4; round++) {
      const reply = await aiCall(convo);
      const action = parseAiAction(reply);
      if (action && (action.action === 'lookup_issue' || action.action === 'search_issues' || action.action === 'list_issues' || action.action === 'work_summary' || action.action === 'time_report')) {
        const data = await runAiReadAction(action);
        convo = `${convo} ${reply}\n\nTool result (${action.action}):\n${data}\n\nNow answer the user in plain language using this data. Do not emit another action unless you need more data.\nAssistant:`;
        continue;
      }
      hideAiTyping();
      if (action) showAiActionPreview(action);
      else appendAiMsgStream(reply);
      handled = true;
      break;
    }
    if (!handled) { hideAiTyping(); appendAiMsg('assistant', 'Hmm, I couldn\'t complete that lookup. Could you rephrase?'); }
  } catch(e) { hideAiTyping(); appendAiMsg('assistant', '⚠️ Error: ' + e.message); }
  btn.textContent = 'Send'; btn.disabled = false;
  aiInputEl().focus();
}

// Read-only lookups the AI can run on its own (no confirmation needed).
async function runAiReadAction(a) {
  try {
    if (a.action === 'lookup_issue') {
      const i = await req(`/projects/${a.project_id}/issues/${a.issue_iid}`);
      const ts = i.time_stats || {};
      return JSON.stringify({
        iid: i.iid, project: projName(i.project_id), title: i.title, state: i.state,
        description: (i.description||'').slice(0,800), author: i.author?.name,
        assignees: (i.assignees||[]).map(x=>x.name), labels: i.labels,
        time_spent: ts.human_time_spent || null, time_estimate: ts.human_time_estimate || null,
        due_date: i.due_date, created_at: i.created_at, web_url: i.web_url
      });
    }
    if (a.action === 'work_summary') {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const dayMap = await buildDayMap(now.getFullYear(), now.getMonth());
      let from;
      const period = a.period || 'week';
      if (period === 'today') from = todayStr;
      else if (period === 'week') { const wd = (now.getDay() + 6) % 7; const mon = new Date(now); mon.setDate(now.getDate() - wd); from = mon.toISOString().slice(0, 10); }
      else { from = todayStr.slice(0, 8) + '01'; }
      const agg = {}; let total = 0;
      for (const [date, entries] of Object.entries(dayMap)) {
        if (date < from || date > todayStr) continue;
        for (const e of entries) { const k = `#${e.iid} ${e.title}`; agg[k] = (agg[k] || 0) + e.secs; total += e.secs; }
      }
      const entries = Object.entries(agg).sort((x, y) => y[1] - x[1]).map(([k, s]) => ({ work: k, time: fmtH(s) }));
      return JSON.stringify({ period, from, to: todayStr, total: fmtH(total), entries });
    }
    if (a.action === 'time_report') {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const dayMap = await buildDayMap(now.getFullYear(), now.getMonth());
      const period = a.period === 'week' ? 'week' : 'month';
      let from;
      if (period === 'week') { const wd = (now.getDay() + 6) % 7; const mon = new Date(now); mon.setDate(now.getDate() - wd); from = mon.toISOString().slice(0, 10); }
      else from = todayStr.slice(0, 8) + '01';
      const byProj = {}; let total = 0;
      for (const [date, entries] of Object.entries(dayMap)) {
        if (date < from || date > todayStr) continue;
        for (const e of entries) { const k = e.proj || projName(e.pid); byProj[k] = (byProj[k] || 0) + e.secs; total += e.secs; }
      }
      const by_project = Object.entries(byProj).sort((x, y) => y[1] - x[1]).map(([p, s]) => ({ project: p, time: fmtH(s) }));
      return JSON.stringify({ period, from, to: todayStr, total: fmtH(total), by_project });
    }
    if (a.action === 'list_issues') {
      let assigneeUser = (a.assignee || '').trim();
      let resolved = null;
      if (assigneeUser) {
        try {
          const users = await req(`/users?search=${encodeURIComponent(assigneeUser)}`);
          if (Array.isArray(users) && users.length) { assigneeUser = users[0].username; resolved = `${users[0].name} (@${users[0].username})`; }
        } catch {}
      }
      const params = [];
      const state = a.state || 'all';
      if (state !== 'all') params.push(`state=${state}`);
      if (assigneeUser) params.push(`assignee_username=${encodeURIComponent(assigneeUser)}`);
      if (a.query) params.push(`search=${encodeURIComponent(a.query)}`);
      const path = a.project_id
        ? `/projects/${a.project_id}/issues?${params.join('&')}`
        : `/issues?scope=all&${params.join('&')}`;
      const list = await reqAll(path);
      const top = list.slice(0, 25).map(i => ({
        iid: i.iid, project: projName(i.project_id), title: i.title, state: i.state,
        assignees: (i.assignees||[]).map(x=>x.name), web_url: i.web_url
      }));
      return JSON.stringify({
        count: list.length, project: a.project_id ? projName(a.project_id) : 'all projects',
        assignee_filter: resolved || assigneeUser || null, state, results: top
      });
    }
    // search_issues
    const found = await reqAll(`/issues?scope=all&state=all&search=${encodeURIComponent(a.query||'')}`);
    const top = found.slice(0, 12).map(i => ({
      iid: i.iid, project_id: i.project_id, project: projName(i.project_id),
      title: i.title, state: i.state, assignees: (i.assignees||[]).map(x=>x.name), web_url: i.web_url
    }));
    return JSON.stringify({ count: found.length, results: top });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
}

// ── AI ACTIONS (preview → confirm → execute) ──
let _pendingAiAction = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function parseAiAction(reply) {
  if (!reply) return null;
  // Look for a fenced ```action block, else any JSON object containing "action"
  let raw = null;
  const fenced = reply.match(/```(?:action|json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1];
  else if (/"action"\s*:/.test(reply)) { const m = reply.match(/\{[\s\S]*\}/); if (m) raw = m[0]; }
  if (!raw) return null;
  const KNOWN = ['create_issue','log_time','close_issue','reopen_issue','comment_issue','edit_issue','set_due_date','add_label','remove_label','assign_issue','set_estimate','set_milestone','bulk_log_time','bulk_create_issues','lookup_issue','search_issues','list_issues','work_summary','time_report'];
  try {
    const obj = JSON.parse(raw.trim());
    if (obj && KNOWN.includes(obj.action)) return obj;
  } catch {}
  return null;
}

function projName(pid) {
  const p = (allProjects||[]).find(x => String(x.id) === String(pid));
  return p ? p.name_with_namespace : `project ${pid}`;
}

function aiEditVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function showAiActionPreview(a) {
  _pendingAiAction = a;
  const box = aiMsgBox();
  const today = new Date().toISOString().slice(0, 10);
  const issueRef = `#${esc(a.issue_iid)} · ${esc(projName(a.project_id))}`;
  let icon = '⚙️', title = 'Action', body = '';
  if (a.action === 'create_issue') {
    const times = (a.time||[]).filter(t=>t&&t.duration);
    icon = '📝'; title = 'Create Issue';
    body = `<div class="ai-prow"><b>Project:</b> ${esc(projName(a.project_id))}</div>
      <label class="ai-plabel">Title</label><input class="ai-edit" id="aiEdit_title" value="${esc(a.title||'')}">
      <label class="ai-plabel">Description</label><textarea class="ai-edit" id="aiEdit_desc" rows="2">${esc(a.description||'')}</textarea>
      ${times.length?`<div class="ai-prow" style="margin-top:6px"><b>Time:</b> ${times.map(t=>`${esc(t.duration)}${t.date?` @ ${esc(t.date)}`:''}${t.summary?` — ${esc(t.summary)}`:''}`).join('<br>')}</div>`:''}
      <label class="ai-prow" style="display:flex;align-items:center;gap:7px;margin-top:7px;cursor:pointer"><input type="checkbox" id="aiEdit_close" ${a.close?'checked':''} style="width:14px;height:14px;accent-color:var(--red)"> Close issue after creating</label>`;
  } else if (a.action === 'log_time') {
    icon = '⏱'; title = 'Log Time';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>
      <label class="ai-plabel">Duration</label><input class="ai-edit" id="aiEdit_duration" value="${esc(a.duration||'')}">
      <label class="ai-plabel">Date</label><input class="ai-edit" type="date" id="aiEdit_date" value="${esc(a.date||today)}">
      <label class="ai-plabel">Summary</label><input class="ai-edit" id="aiEdit_summary" value="${esc(a.summary||'')}">`;
  } else if (a.action === 'comment_issue') {
    icon = '💬'; title = 'Add Comment';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>
      <label class="ai-plabel">Comment</label><textarea class="ai-edit" id="aiEdit_comment" rows="2">${esc(a.comment||'')}</textarea>`;
  } else if (a.action === 'edit_issue') {
    icon = '✏️'; title = 'Edit Issue';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>
      <label class="ai-plabel">Title</label><input class="ai-edit" id="aiEdit_title" value="${esc(a.title||'')}">
      <label class="ai-plabel">Description</label><textarea class="ai-edit" id="aiEdit_desc" rows="2">${esc(a.description||'')}</textarea>`;
  } else if (a.action === 'set_due_date') {
    icon = '📅'; title = 'Set Due Date';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>
      <label class="ai-plabel">Due date</label><input class="ai-edit" type="date" id="aiEdit_due" value="${esc(a.due_date||today)}">`;
  } else if (a.action === 'add_label') {
    icon = '🏷'; title = 'Add Labels';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>
      <label class="ai-plabel">Labels (comma-separated)</label><input class="ai-edit" id="aiEdit_labels" value="${esc(a.labels||'')}">`;
  } else if (a.action === 'assign_issue') {
    icon = '👤'; title = 'Assign Issue';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>
      <label class="ai-plabel">Assign to (a name, "me", or "none" to unassign)</label><input class="ai-edit" id="aiEdit_assignee" value="${esc(a.assignee || a.assign || 'me')}">`;
  } else if (a.action === 'remove_label') {
    icon = '🏷'; title = 'Remove Labels';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>
      <label class="ai-plabel">Labels to remove (comma-separated)</label><input class="ai-edit" id="aiEdit_labels" value="${esc(a.labels||'')}">`;
  } else if (a.action === 'set_estimate') {
    icon = '⏳'; title = 'Set Time Estimate';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>
      <label class="ai-plabel">Estimate (e.g. 4h, 1d)</label><input class="ai-edit" id="aiEdit_estimate" value="${esc(a.estimate||'')}">`;
  } else if (a.action === 'set_milestone') {
    icon = '🎯'; title = 'Set Milestone';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>
      <label class="ai-plabel">Milestone name</label><input class="ai-edit" id="aiEdit_milestone" value="${esc(a.milestone||'')}">`;
  } else if (a.action === 'bulk_log_time') {
    icon = '⏱'; title = `Log Time · ${(a.items||[]).length} issues`;
    const rows = (a.items||[]).map(t => `<div class="ai-prow">• #${esc(t.issue_iid)} ${esc(projName(t.project_id))} — <b>${esc(t.duration||'')}</b>${t.date?` @ ${esc(t.date)}`:''}${t.summary?` — ${esc(t.summary)}`:''}</div>`).join('');
    body = `<div style="font-size:12px">${rows || 'No entries'}</div>`;
  } else if (a.action === 'bulk_create_issues') {
    icon = '📝'; title = `Create ${(a.issues||[]).length} issues`;
    const rows = (a.issues||[]).map((iss, n) => { const tm = (iss.time||[]).filter(t=>t&&t.duration); return `<div class="ai-prow">${n+1}. <b>${esc(iss.title||'')}</b>${tm.length?` · ${tm.map(t=>esc(t.duration)).join(', ')}`:''}${iss.close?' · close':''}</div>`; }).join('');
    body = `<div class="ai-prow"><b>Project:</b> ${esc(projName(a.project_id))}</div><div style="font-size:12px;margin-top:4px">${rows || 'No issues'}</div>`;
  } else if (a.action === 'reopen_issue') {
    icon = '🔄'; title = 'Reopen Issue';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>`;
  } else { // close_issue
    icon = '✓'; title = 'Close Issue';
    body = `<div class="ai-prow"><b>Issue:</b> ${issueRef}</div>`;
  }
  const div = document.createElement('div');
  div.id = 'aiActionPreview';
  div.style.cssText = 'display:flex;justify-content:flex-start';
  div.innerHTML = `<div style="max-width:90%;width:100%;padding:12px 14px;border-radius:14px;background:var(--surface2);border:1px solid var(--blue)">
      <div style="font-weight:700;margin-bottom:8px">${icon} ${title}</div>
      <div style="font-size:12px;line-height:1.6">${body}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" style="flex:1;padding:7px" onclick="confirmAiAction()">✓ Confirm</button>
        <button class="btn" style="flex:1;padding:7px" onclick="cancelAiAction()">✕ Cancel</button>
      </div>
    </div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function cancelAiAction() {
  _pendingAiAction = null;
  const el = document.getElementById('aiActionPreview'); if (el) el.remove();
  appendAiMsg('assistant', 'Okay, cancelled. Anything else?');
}

async function confirmAiAction() {
  const a = _pendingAiAction;
  if (!a) return;
  _pendingAiAction = null;
  const today = new Date().toISOString().slice(0, 10);
  const el = document.getElementById('aiActionPreview');
  // read any edited values before removing the preview
  const ed = {
    title: aiEditVal('aiEdit_title'), desc: document.getElementById('aiEdit_desc')?.value ?? a.description,
    duration: aiEditVal('aiEdit_duration'), date: aiEditVal('aiEdit_date'), summary: aiEditVal('aiEdit_summary'),
    comment: document.getElementById('aiEdit_comment')?.value ?? a.comment,
    due: aiEditVal('aiEdit_due'), labels: aiEditVal('aiEdit_labels'),
    assignee: aiEditVal('aiEdit_assignee'), estimate: aiEditVal('aiEdit_estimate'), milestone: aiEditVal('aiEdit_milestone'),
    close: document.getElementById('aiEdit_close')?.checked
  };
  if (el) el.remove();
  showAiTyping();
  const base = `/projects/${a.project_id}/issues/${a.issue_iid}`;
  try {
    if (a.action === 'create_issue') {
      const body = { title: ed.title || a.title, description: ed.desc || '' };
      if (ME) body.assignee_ids = [ME.id];
      const issue = await req(`/projects/${a.project_id}/issues`, 'POST', body);
      let logged = 0;
      for (const t of (a.time||[])) {
        if (!t || !t.duration) continue;
        await logTimeGQL(a.project_id, issue.iid, t.duration, t.date || today, t.summary || '');
        logged++;
      }
      if (ed.close) await req(`/projects/${a.project_id}/issues/${issue.iid}`, 'PUT', { state_event: 'close' });
      hideAiTyping();
      appendAiMsg('assistant', `✅ Created issue #${issue.iid}${logged?` · ${logged} time entr${logged>1?'ies':'y'} logged`:''}${ed.close?' · closed':''}.${issue.web_url?`\n${issue.web_url}`:''}`);
    } else if (a.action === 'log_time') {
      const dur = ed.duration || a.duration;
      await logTimeGQL(a.project_id, a.issue_iid, dur, ed.date || a.date || today, ed.summary || a.summary || '');
      hideAiTyping();
      appendAiMsg('assistant', `✅ Logged ${dur} on issue #${a.issue_iid}.`);
    } else if (a.action === 'comment_issue') {
      await req(`${base}/notes`, 'POST', { body: ed.comment || a.comment || '' });
      hideAiTyping();
      appendAiMsg('assistant', `✅ Comment added to #${a.issue_iid}.`);
    } else if (a.action === 'edit_issue') {
      const body = {};
      if (ed.title || a.title) body.title = ed.title || a.title;
      body.description = ed.desc || '';
      await req(base, 'PUT', body);
      hideAiTyping();
      appendAiMsg('assistant', `✅ Updated issue #${a.issue_iid}.`);
    } else if (a.action === 'set_due_date') {
      const due = ed.due || a.due_date;
      await req(base, 'PUT', { due_date: due });
      hideAiTyping();
      appendAiMsg('assistant', `✅ Due date for #${a.issue_iid} set to ${due}.`);
    } else if (a.action === 'add_label') {
      const labels = ed.labels || a.labels || '';
      await req(base, 'PUT', { add_labels: labels });
      hideAiTyping();
      appendAiMsg('assistant', `✅ Labels added to #${a.issue_iid}: ${labels}.`);
    } else if (a.action === 'assign_issue') {
      const who = (ed.assignee || a.assignee || a.assign || 'me').trim();
      if (who.toLowerCase() === 'none' || who === '') {
        await req(base, 'PUT', { assignee_ids: [] });
        hideAiTyping();
        appendAiMsg('assistant', `✅ Unassigned #${a.issue_iid}.`);
      } else if (who.toLowerCase() === 'me') {
        await req(base, 'PUT', { assignee_ids: [ME.id] });
        hideAiTyping();
        appendAiMsg('assistant', `✅ Assigned #${a.issue_iid} to you.`);
      } else {
        const users = await req(`/users?search=${encodeURIComponent(who)}`);
        if (!Array.isArray(users) || !users.length) throw new Error(`No user found matching "${who}"`);
        const u = users[0];
        await req(base, 'PUT', { assignee_ids: [u.id] });
        hideAiTyping();
        appendAiMsg('assistant', `✅ Assigned #${a.issue_iid} to ${u.name} (@${u.username}).`);
      }
    } else if (a.action === 'remove_label') {
      const labels = ed.labels || a.labels || '';
      await req(base, 'PUT', { remove_labels: labels });
      hideAiTyping();
      appendAiMsg('assistant', `✅ Removed labels from #${a.issue_iid}: ${labels}.`);
    } else if (a.action === 'set_estimate') {
      const est = ed.estimate || a.estimate || '';
      await req(`${base}/time_estimate?duration=${encodeURIComponent(est)}`, 'POST');
      hideAiTyping();
      appendAiMsg('assistant', `✅ Estimate for #${a.issue_iid} set to ${est}.`);
    } else if (a.action === 'set_milestone') {
      const name = ed.milestone || a.milestone || '';
      const ms = await req(`/projects/${a.project_id}/milestones?search=${encodeURIComponent(name)}`);
      if (!Array.isArray(ms) || !ms.length) throw new Error(`No milestone found matching "${name}"`);
      await req(base, 'PUT', { milestone_id: ms[0].id });
      hideAiTyping();
      appendAiMsg('assistant', `✅ Milestone for #${a.issue_iid} set to "${ms[0].title}".`);
    } else if (a.action === 'bulk_log_time') {
      let ok = 0, fail = 0;
      for (const t of (a.items||[])) {
        if (!t || !t.duration || !t.issue_iid) { fail++; continue; }
        try { await logTimeGQL(t.project_id || a.project_id, t.issue_iid, t.duration, t.date || today, t.summary || ''); ok++; }
        catch { fail++; }
      }
      hideAiTyping();
      appendAiMsg('assistant', `✅ Logged time on ${ok} issue${ok!==1?'s':''}${fail?` · ${fail} failed`:''}.`);
    } else if (a.action === 'bulk_create_issues') {
      const created = [];
      for (const iss of (a.issues||[])) {
        if (!iss || !iss.title) continue;
        const body = { title: iss.title, description: iss.description || '' };
        if (ME) body.assignee_ids = [ME.id];
        const issue = await req(`/projects/${a.project_id}/issues`, 'POST', body);
        for (const t of (iss.time||[])) { if (t && t.duration) await logTimeGQL(a.project_id, issue.iid, t.duration, t.date || today, t.summary || ''); }
        if (iss.close) await req(`/projects/${a.project_id}/issues/${issue.iid}`, 'PUT', { state_event: 'close' });
        created.push('#' + issue.iid);
      }
      hideAiTyping();
      appendAiMsg('assistant', `✅ Created ${created.length} issues: ${created.join(', ')}.`);
    } else if (a.action === 'reopen_issue') {
      await req(base, 'PUT', { state_event: 'reopen' });
      hideAiTyping();
      appendAiMsg('assistant', `✅ Reopened issue #${a.issue_iid}.`);
    } else { // close_issue
      await req(base, 'PUT', { state_event: 'close' });
      hideAiTyping();
      appendAiMsg('assistant', `✅ Closed issue #${a.issue_iid}.`);
    }
    cacheClear();
  } catch(e) {
    hideAiTyping();
    appendAiMsg('assistant', '⚠️ Failed: ' + e.message);
  }
  aiInputEl().focus();
}

// ── SETTINGS ──
function updateSatLabel(n) {
  const checked = document.getElementById('sat'+n+'off').checked;
  const badge = document.getElementById('satBadge'+n);
  const label = document.getElementById('satLabel'+n);
  badge.textContent = checked ? 'OFF' : 'ON';
  badge.style.color = checked ? 'var(--red)' : 'var(--green)';
  label.style.borderColor = checked ? 'var(--red)' : 'var(--border2)';
  label.style.background  = checked ? 'rgba(239,68,68,.06)' : 'var(--surface2)';
}

function openSettings() {
  document.getElementById('cfgUrl').value   = CFG.url   || DEFAULT_URL;
  document.getElementById('cfgToken').value = CFG.token || '';
  const off = getSatOff();
  [1,2,3,4].forEach(n => {
    document.getElementById('sat'+n+'off').checked = off.includes(n);
    updateSatLabel(n);
  });
  document.getElementById('cfgSatHours').value  = CFG.sat_hours ?? 7;
  document.getElementById('cfgDayHours').value  = CFG.day_hours ?? 8;
  document.getElementById('cfgGeminiKey').value   = CFG.gemini_key   || '';
  document.getElementById('cfgGeminiModel').value = CFG.gemini_model || 'gemini-2.5-flash-lite';
  document.getElementById('cfgAiProvider').value  = CFG.ai_provider  || 'gemini';
  document.getElementById('cfgGroqKey').value     = CFG.groq_key     || '';
  document.getElementById('cfgGroqModel').value   = CFG.groq_model   || 'llama-3.3-70b-versatile';
  aiProviderToggle();
  document.getElementById('settingsModal').classList.add('open');
  setTimeout(() => document.getElementById(CFG.token ? 'cfgUrl' : 'cfgToken').focus(), 100);
}

function aiProviderToggle() {
  const p = document.getElementById('cfgAiProvider').value;
  document.getElementById('cfgGeminiBlock').style.display = p === 'groq' ? 'none' : '';
  document.getElementById('cfgGroqBlock').style.display   = p === 'groq' ? '' : 'none';
  document.getElementById('cfgGeminiKeyWrap').style.display = p === 'groq' ? 'none' : '';
  document.getElementById('cfgGroqKeyWrap').style.display   = p === 'groq' ? '' : 'none';
}
function togglePw(id, btn) {
  const el = document.getElementById(id);
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
}
async function saveSettings() {
  const url   = document.getElementById('cfgUrl').value.trim();
  const token = document.getElementById('cfgToken').value.trim();
  if (!token) return toast('Token is required', true);
  const sat_off   = [1,2,3,4].filter(n => document.getElementById('sat'+n+'off').checked);
  const sat_hours  = parseFloat(document.getElementById('cfgSatHours').value) || 7;
  const day_hours  = parseFloat(document.getElementById('cfgDayHours').value) || 8;
  const gemini_key   = document.getElementById('cfgGeminiKey').value.trim();
  const gemini_model = document.getElementById('cfgGeminiModel').value;
  const ai_provider  = document.getElementById('cfgAiProvider').value;
  const groq_key     = document.getElementById('cfgGroqKey').value.trim();
  const groq_model   = document.getElementById('cfgGroqModel').value;
  saveCfg({ url: url || DEFAULT_URL, token, sat_off, sat_hours, day_hours, gemini_key, gemini_model, ai_provider, groq_key, groq_model });
  API   = (CFG.url || DEFAULT_URL).replace(/\/$/, '') + '/api/v4';
  TOKEN = CFG.token;
  closeModal('settingsModal');
  cacheClear();
  ME = null; allIssues = []; allProjects = [];
  document.getElementById('userInfo').innerHTML = '<span class="user-pill-name">Connecting…</span>';
  const curPage = URL_PAGES[location.pathname] || 'dashboard';
  await connect(curPage);
  startAutoRefresh();
}

document.addEventListener('keydown', e => {
  const active = document.querySelector('.modal-overlay.open');
  if (active) { if (e.key === 'Escape') active.classList.remove('open'); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'n' || e.key === 'N') openQuickCreate();
  if (e.key === 'l' || e.key === 'L') openQuickLog();
  if (e.key === 's' || e.key === 'S') openSettings();
});
const REFRESH_INTERVAL = 3 * 60 * 1000; // 3 minutes
let _refreshTimer = null;
let _ringTimer = null;

const RING_CIRC = 138.2; // 2 * PI * r (r = 22)
let _ringInterval = null;
let _ringStart = 0;

// Drives the ring fill with setInterval + setAttribute.
// setInterval (unlike requestAnimationFrame) keeps running in background tabs.
function startRingAnimation() {
  const p = document.getElementById('refreshProgress');
  if (!p) return;
  if (_ringInterval) { clearInterval(_ringInterval); _ringInterval = null; }
  p.setAttribute('stroke', '#4fc3f7');
  p.setAttribute('stroke-dashoffset', String(RING_CIRC)); // start empty
  _ringStart = Date.now();
  _ringInterval = setInterval(() => {
    const el = document.getElementById('refreshProgress');
    if (!el) return;
    const elapsed = Date.now() - _ringStart;
    const progress = Math.min(elapsed / REFRESH_INTERVAL, 1);
    el.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - progress)).toFixed(2));
    if (progress >= 1) { clearInterval(_ringInterval); _ringInterval = null; }
  }, 100); // update 10x/sec — smooth and visible
}

function setRing(color, offset) {
  const p = document.getElementById('refreshProgress');
  if (!p) return;
  if (_ringInterval) { clearInterval(_ringInterval); _ringInterval = null; }
  p.setAttribute('stroke', color);
  p.setAttribute('stroke-dashoffset', String(offset));
}

function startAutoRefresh() {
  if (_refreshTimer) clearInterval(_refreshTimer);
  startRingAnimation();
  _refreshTimer = setInterval(async () => {
    setRing('var(--yellow)', 0); // full ring = refreshing
    cacheClear();
    try {
      await Promise.all([loadMyIssues(), loadDashboard()]);
    } catch {
      // refresh failed (e.g. bad token) — keep the ring cycling anyway
    }
    startRingAnimation();
  }, REFRESH_INTERVAL);
}

window.onload = async () => {
  cacheClear();
  // Ring always animates, independent of connection state
  startRingAnimation();
  const initPage = URL_PAGES[location.pathname] || 'dashboard';
  if (!CFG.token) { openSettings(); }
  else { await connect(initPage); }
  startAutoRefresh();
};

async function connect(initPage = 'dashboard') {
  try {
    ME = await req('/user');
    document.getElementById('userInfo').innerHTML =
      `<img src="${ME.avatar_url}" style="width:26px;height:26px;border-radius:50%"><span class="user-pill-name">${ME.name}</span>`;
    await loadProjects();
    showPage(initPage, false);
    history.replaceState({ page: initPage }, '', PAGE_URLS[initPage] || '/dashboard');
    await Promise.all([loadMyIssues(), loadDashboard()]);
    updateLabels();
  } catch(e) {
    toast('Connection failed: ' + e.message, true);
  }
}
