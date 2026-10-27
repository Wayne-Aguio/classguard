/* ClassGuard dashboard: plain JavaScript, no build step. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { token: localStorage.getItem('cg_token'), user: null, consents: null, poll: null, view: {} };
  const ACT = {};
  const LOGO = `<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2457d6"/><path d="M6 17h5l3-7 4 13 3-6h5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  /* ---------- helpers ---------- */
  async function api(path, opt = {}) {
    const r = await fetch('/api' + path, {
      method: opt.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && S.user) { logout(); throw new Error('Your session expired. Please sign in again.'); }
    if (!r.ok) throw new Error(j.message || 'Something went wrong.');
    return j;
  }
  async function download(path, name) {
    const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + S.token } });
    if (!r.ok) return toast('Could not download the file.', true);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: name });
    a.click(); URL.revokeObjectURL(a.href);
  }
  const dur = (ms) => { const s = Math.round(ms / 1000); if (s < 60) return s + 's'; const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
  const clock = (t) => t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '–';
  const when = (t) => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–';
  const ago = (t) => { if (!t) return '–'; const s = (Date.now() - t) / 1000; return s < 15 ? 'just now' : s < 90 ? Math.round(s) + 's ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : when(t); };
  const toast = (msg, err) => { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200); };
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  const openDrawer = (html) => { const d = $('#drawer'); d.innerHTML = `<button class="close sm" data-act="closeDrawer">Close</button>${html}`; d.hidden = false; };
  const closeDrawer = () => { $('#drawer').hidden = true; };
  const openModal = (html) => { const m = $('#modal'); m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; const f = m.querySelector('input,select,textarea'); if (f) f.focus(); };
  const closeModal = () => { $('#modal').hidden = true; };
  const LABEL = { focused: 'Focused', away: 'Tab in background', left: 'Left', attended: 'Attended', absent: 'Not joined', no_consent: 'No consent',
    not_started: 'Not started', in_progress: 'In progress', ended: 'Finished', pending: 'To review', cleared: 'Cleared', flagged: 'Flagged', low: 'Low', medium: 'Medium', high: 'High' };
  const pill = (k, extra = '') => `<span class="pill ${k} ${extra}">${LABEL[k] || k}</span>`;
  const empty = (title, text, btn = '') => `<div class="empty"><h3>${title}</h3><p>${text}</p>${btn}</div>`;

  /* ---------- shell + auth ---------- */
  function mount(active, inner) {
    const t = S.user.role === 'teacher';
    const nav = t ? [['classes', 'Classes', '#/classes'], ['exams', 'Exams', '#/exams'], ['privacy', 'Privacy', '#/privacy']] : [['my', 'My classes', '#/my'], ['privacy', 'Privacy', '#/privacy']];
    $('#app').innerHTML = `<div class="shell"><aside class="side"><div class="brand">${LOGO}ClassGuard</div>
      ${nav.map(([k, l, h]) => `<a class="nav ${active === k ? 'on' : ''}" href="${h}">${l}</a>`).join('')}
      <div class="me"><b>${esc(S.user.name)}</b>${t ? 'Teacher' : 'Student'}<br><button class="sm" data-act="logout">Sign out</button></div></aside>
      <main class="main" id="page">${inner}</main></div>`;
  }
  function authView(mode = 'login') {
    $('#app').innerHTML = `<div class="authwrap"><section class="authhero"><div><div class="brand" style="padding:0">${LOGO}ClassGuard</div>
      <h1>See who is in class, and whether they are paying attention.</h1>
      <p>Attendance and focus for Google Meet lessons, and an integrity review for Google and Microsoft Forms exams. Students see exactly what is collected and choose whether to allow it.</p></div>
      <ul><li>Live roster with join, leave and rejoin history</li><li>Tab switch, copy, paste and cut counts for exams</li><li>Never reads your screen, mouse, keyboard or answers</li></ul></section>
      <section class="authform"><form data-submit="${mode}"><h1>${mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
      <div class="seg" style="margin-top:14px"><button type="button" class="${mode === 'login' ? 'on' : ''}" data-act="authMode" data-v="login">Sign in</button><button type="button" class="${mode === 'register' ? 'on' : ''}" data-act="authMode" data-v="register">Register</button></div>
      ${mode === 'register' ? `<label>Your name</label><input name="name" required autocomplete="name">
        <label>I am a</label><select name="role"><option value="student">Student</option><option value="teacher">Teacher</option></select>` : ''}
      <label>Email</label><input name="email" type="email" required autocomplete="email">
      <label>Password</label><input name="password" type="password" required minlength="${mode === 'register' ? 8 : 1}" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
      ${mode === 'register' ? `<div id="invite" hidden><label>School invite code (teachers)</label><input name="invite_code"></div><p class="small muted" style="margin-top:8px">At least 8 characters. Passwords are stored as one-way hashes.</p>` : ''}
      <div class="err" id="autherr" role="alert"></div>
      <button class="primary" style="width:100%;margin-top:6px">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      ${mode === 'login' ? `<p class="demo">Trying the demo? Teacher: <span class="code">teacher@demo.test</span> / <span class="code">teacher123</span></p>` : ''}</form></section></div>`;
    const role = $('select[name=role]'); if (role) role.onchange = () => $('#invite').hidden = role.value !== 'teacher';
  }
  const authDone = (r) => { S.token = r.token; S.user = r.user; localStorage.setItem('cg_token', r.token); location.hash = ''; route(); };
  ACT.authMode = (el) => authView(el.dataset.v);
  ACT.login = async (f) => { try { authDone(await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(f)) })); } catch (e) { $('#autherr').textContent = e.message; } };
  ACT.register = async (f) => { try { authDone(await api('/auth/register', { method: 'POST', body: Object.fromEntries(new FormData(f)) })); } catch (e) { $('#autherr').textContent = e.message; } };
  function logout() { localStorage.removeItem('cg_token'); S.token = S.user = null; clearInterval(S.poll); closeDrawer(); closeModal(); authView(); }
  ACT.logout = logout;
  ACT.closeDrawer = closeDrawer; ACT.closeModal = closeModal;

  /* ---------- teacher: classes ---------- */
  async function classesView() {
    const list = await api('/classes');
    mount('classes', `<div class="head"><div><h1>Classes</h1><div class="sub">Open a class to see who is in the meeting right now.</div></div>
      <button class="primary" data-act="newClass">New class</button></div>
      ${list.length ? `<div class="grid">${list.map(c => `<a class="classcard" href="#/class/${c.id}"><h3>${esc(c.name)}</h3>
        <div class="muted small">Meet <span class="code">${esc(c.meet_code)}</span> · Join code <span class="code">${esc(c.join_code)}</span></div>
        <div class="meta"><span>${c.students} student${c.students === 1 ? '' : 's'}</span><span>${c.sessions} session${c.sessions === 1 ? '' : 's'}</span><span>${c.exams} exam${c.exams === 1 ? '' : 's'}</span>
        ${c.in_meeting ? pill('focused', 'live').replace('Focused', c.in_meeting + ' in class now') : ''}</div></a>`).join('')}</div>`
        : `<div class="card">${empty('Create your first class', 'Link a class to its Google Meet code. Students join with a short code and their attendance appears here.', '<button class="primary" data-act="newClass">New class</button>')}</div>`}`);
  }
  ACT.newClass = () => openModal(`<h2>New class</h2><form data-submit="createClass"><label>Class name</label><input name="name" placeholder="Grade 10 Physics" required>
    <label>Google Meet link or code</label><input name="meet" placeholder="https://meet.google.com/abc-defg-hij" required>
    <p class="small muted" style="margin-top:6px">Use a permanent Meet link so every lesson maps to this class.</p>
    <div class="foot"><button type="button" data-act="closeModal">Cancel</button><button class="primary">Create class</button></div></form>`);
  ACT.createClass = guard(async (f) => { const c = await api('/classes', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); closeModal(); toast('Class created.'); location.hash = '#/class/' + c.id; });

  /* ---------- teacher: live dashboard ---------- */
  const STATUS_FILTER = { all: () => true, in: r => r.status === 'focused' || r.status === 'away', away: r => r.status === 'away', left: r => r.status === 'left', absent: r => r.status === 'absent' || r.status === 'no_consent' };
  function strip(r, d, big) {
    const s = d.session;
    if (!s || !r.segments.length) return `<div class="strip ${big ? 'big' : ''}"></div>`;
    const start = s.started_at, tot = Math.max((s.ended_at || Date.now()) - start, 1), lead = Math.max(0, r.segments[0].from - start);
    return `<div class="strip ${big ? 'big' : ''}">${lead ? `<i class="out" style="width:${lead / tot * 100}%"></i>` : ''}${r.segments.map(g =>
      `<i class="${g.state}" style="width:${(g.to - g.from) / tot * 100}%" title="${g.state === 'out' ? 'Not in meeting' : g.state === 'focused' ? 'Class tab in front' : 'Class tab in background'}, ${clock(g.from)}–${clock(g.to)}"></i>`).join('')}</div>`;
  }
  const legend = `<div class="legend"><span style="--c:var(--focused)">Class tab in front</span><span style="--c:var(--away)">Tab in background</span><span style="--c:var(--left-bg)">Not in meeting</span></div>`;

  async function liveView(id, sid) {
    const url = sid ? `/classes/${id}/sessions/${sid}` : `/classes/${id}/live`;
    const v = S.view = { d: await api(url), f: 'all', q: '', id, sid };
    mount('classes', `<a class="crumb" href="#/classes">← All classes</a><div id="head"></div><div id="stats" class="stats"></div>
      <div class="tools"><input type="search" placeholder="Search students" data-input="search" aria-label="Search students">
      <div class="seg" id="filters">${[['all', 'All'], ['in', 'In class'], ['away', 'Tab away'], ['left', 'Left'], ['absent', 'Not joined']].map(([k, l]) => `<button class="${k === 'all' ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div id="roster"></div>${legend}`);
    paintLive();
    if (!sid) S.poll = setInterval(async () => { try { v.d = await api(url); paintLive(); } catch { /* keep last data */ } }, 5000);
  }
  function paintLive() {
    const { d, f, q, sid } = S.view, s = d.summary, c = d.class;
    const state = !d.session ? '<span class="muted">No session yet</span>' : d.live ? pill('focused', 'live').replace('Focused', 'Live') : `<span class="muted">Ended ${when(d.session.ended_at)}</span>`;
    $('#head').innerHTML = `<div class="head"><div><h1>${esc(c.name)}</h1><div class="sub">${state}
      ${d.session ? `<span>Started ${when(d.session.started_at)}</span>` : ''}<span>Meet <span class="code">${esc(c.meet_code)}</span></span>
      <span>Join code <span class="code">${esc(c.join_code)}</span> <button class="sm" data-act="copy" data-v="${esc(c.join_code)}">Copy</button></span></div></div>
      <div class="actions"><div class="seg"><button class="${sid ? '' : 'on'}" data-act="go" data-v="#/class/${c.id}">Live</button><button class="${sid ? 'on' : ''}" data-act="go" data-v="#/class/${c.id}/sessions">Past sessions</button></div>
      <button data-act="csv" data-v="${sid ? `/classes/${c.id}/report.csv?session=${sid}` : `/classes/${c.id}/report.csv`}" data-n="attendance-${esc(c.meet_code)}.csv">Export CSV</button>
      ${d.live ? '<button data-act="endSession">End session</button>' : ''}<button data-act="classSettings">Settings</button></div></div>`;
    const cards = d.live || !d.session
      ? [['brand', s.in_meeting, 'In class now'], ['focused', s.focused, 'Focused'], ['away', s.away, 'Tab in background'], ['', s.left, 'Left'], ['absent', s.absent + s.no_consent, 'Not joined'], ['', s.avg_focus_pct + '%', 'Average focus']]
      : [['focused', `${s.attended}/${s.enrolled}`, 'Attended'], ['absent', s.enrolled - s.attended, 'Not joined'], ['brand', s.avg_focus_pct + '%', 'Average focus'], ['', dur(d.session.ended_at - d.session.started_at), 'Duration']];
    $('#stats').innerHTML = cards.map(([k, n, l]) => `<div class="stat ${k}"><b>${n}</b><span>${l}</span></div>`).join('');
    const rows = d.students.filter(STATUS_FILTER[f]).filter(r => (r.name + r.email).toLowerCase().includes(q));
    $('#roster').innerHTML = !d.students.length
      ? `<div class="card">${empty('No students yet', `Ask students to register, then join with code <span class="code">${esc(c.join_code)}</span> under "My classes".`)}</div>`
      : !rows.length ? `<div class="card">${empty('No students match', 'Try a different filter or search.')}</div>`
      : `<div class="tablewrap"><table><thead><tr><th>Student</th><th>Status</th><th>Session so far</th><th>First joined</th><th class="num">Rejoins</th><th class="num">Time in class</th><th class="num">Focus</th><th>Last seen</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="click" data-act="student" data-id="${r.id}" tabindex="0"><td class="who"><b>${esc(r.name)}</b><span>${esc(r.email)}</span></td><td>${pill(r.status)}</td><td>${strip(r, d)}</td>
        <td>${clock(r.first_join)}</td><td class="num">${r.rejoins}</td><td class="num">${r.present_ms ? dur(r.present_ms) : '–'}</td><td class="num">${r.present_ms ? r.focus_pct + '%' : '–'}</td>
        <td class="muted">${r.status === 'focused' || r.status === 'away' ? 'now' : r.last_leave ? clock(r.last_leave) : '–'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  ACT.search = (el) => { S.view.q = el.value.toLowerCase(); paintLive(); };
  ACT.filter = (el) => { S.view.f = el.dataset.v; document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b === el)); paintLive(); };
  ACT.go = (el) => { location.hash = el.dataset.v; };
  ACT.copy = (el) => { navigator.clipboard?.writeText(el.dataset.v); toast('Copied ' + el.dataset.v); };
  ACT.csv = (el) => download(el.dataset.v, el.dataset.n);
  const KIND = { join: 'Joined the meeting', rejoin: 'Rejoined the meeting', leave: 'Left the meeting' };
  const REASON = { timeout: 'Connection lost or tab closed', left: 'Closed or left the meeting', session_ended: 'Session ended by teacher' };
  ACT.student = (el) => {
    const { d } = S.view, r = d.students.find(x => x.id == el.dataset.id); if (!r) return;
    openDrawer(`<h2>${esc(r.name)}</h2><div class="muted small" style="margin:-6px 0 10px">${esc(r.email)}</div>${pill(r.status)}
      <div class="kv"><div><b>${r.present_ms ? dur(r.present_ms) : '–'}</b><span>Time in class</span></div><div><b>${r.present_ms ? r.focus_pct + '%' : '–'}</b><span>Class tab in front</span></div><div><b>${r.joins}</b><span>Joins (${r.rejoins} rejoin${r.rejoins === 1 ? '' : 's'})</span></div></div>
      ${strip(r, d, true)}${legend}<h3 style="margin-top:22px">Join and leave history</h3>
      ${r.history.length ? `<ul class="timeline">${r.history.map(h => `<li class="${h.kind}"><b>${KIND[h.kind]}</b> <span class="muted">at ${clock(h.at)}</span>${h.kind === 'leave' && REASON[h.reason] ? `<div class="muted small">${REASON[h.reason]}</div>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No activity in this session.</p>'}
      <div style="margin-top:20px"><button class="danger sm" data-act="removeStudent" data-id="${r.id}" data-n="${esc(r.name)}">Remove from class</button></div>`);
  };
  ACT.removeStudent = guard(async (el) => { if (!confirm(`Remove ${el.dataset.n} from this class?`)) return; await api(`/classes/${S.view.id}/students/${el.dataset.id}`, { method: 'DELETE' }); closeDrawer(); toast('Student removed.'); route(); });
  ACT.endSession = guard(async () => { if (!confirm('End the live session now? Everyone still in the meeting is marked as left.')) return; await api(`/classes/${S.view.id}/sessions/end`, { method: 'POST' }); toast('Session ended.'); route(); });
  ACT.classSettings = () => { const c = S.view.d.class; openModal(`<h2>Class settings</h2><form data-submit="saveClass"><label>Class name</label><input name="name" value="${esc(c.name)}" required>
    <label>Google Meet link or code</label><input name="meet" value="${esc(c.meet_code)}" required>
    <div class="foot" style="justify-content:space-between"><button type="button" class="danger" data-act="deleteClass">Delete class</button><span class="row"><button type="button" data-act="closeModal">Cancel</button><button class="primary">Save changes</button></span></div></form>`); };
  ACT.saveClass = guard(async (f) => { await api('/classes/' + S.view.id, { method: 'PATCH', body: Object.fromEntries(new FormData(f)) }); closeModal(); toast('Class updated.'); route(); });
  ACT.deleteClass = guard(async () => { if (!confirm('Delete this class and all of its attendance and exam data? This cannot be undone.')) return; await api('/classes/' + S.view.id, { method: 'DELETE' }); closeModal(); location.hash = '#/classes'; });

  async function sessionsView(id) {
    const [live, list] = await Promise.all([api(`/classes/${id}/live`), api(`/classes/${id}/sessions`)]);
    S.view = { d: live, id, sid: null };
    mount('classes', `<a class="crumb" href="#/classes">← All classes</a><div id="head"></div>
      ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Length</th><th class="num">Attended</th><th class="num">Average focus</th><th></th></tr></thead><tbody>
      ${list.map(s => `<tr class="click" data-act="go" data-v="#/class/${id}/session/${s.id}"><td>${when(s.started_at)} ${s.ended_at ? '' : pill('focused', 'live').replace('Focused', 'Live')}</td><td>${s.ended_at ? dur(s.ended_at - s.started_at) : 'in progress'}</td>
      <td class="num">${s.attendees} of ${s.enrolled}</td><td class="num">${s.attendees ? s.avg_focus_pct + '%' : '–'}</td><td class="num"><button class="sm" data-act="csv" data-v="/classes/${id}/report.csv?session=${s.id}" data-n="session-${s.id}.csv">CSV</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="card">${empty('No sessions yet', 'A session starts automatically when the first student with the extension opens your Meet.')}</div>`}`);
    renderHead();
  }
  function renderHead() { // header only (used by the sessions list)
    const { d, id } = S.view, c = d.class;
    $('#head').innerHTML = `<div class="head"><div><h1>${esc(c.name)}</h1><div class="sub"><span>Meet <span class="code">${esc(c.meet_code)}</span></span><span>Join code <span class="code">${esc(c.join_code)}</span></span></div></div>
      <div class="actions"><div class="seg"><button data-act="go" data-v="#/class/${id}">Live</button><button class="on" data-act="go" data-v="#/class/${id}/sessions">Past sessions</button></div>
      <button data-act="csv" data-v="/classes/${id}/report.csv" data-n="attendance-${esc(c.meet_code)}.csv">Export all CSV</button></div></div>`;
  }

  /* ---------- teacher: exams ---------- */
  const PLAT = { google: 'Google Forms', microsoft: 'Microsoft Forms' };
  async function examsView() {
    const [list, classes] = await Promise.all([api('/exams'), api('/classes')]);
    S.view = { classes };
    mount('exams', `<div class="head"><div><h1>Exams</h1><div class="sub">Students open the exam link as usual. Monitoring starts when the extension recognises it.</div></div>
      <button class="primary" data-act="newExam">New exam</button></div>
      ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Exam</th><th>Class</th><th>Status</th><th class="num">Attempts</th><th class="num">High risk</th><th class="num">To review</th><th></th></tr></thead><tbody>
      ${list.map(x => `<tr class="click" data-act="go" data-v="#/exam/${x.id}"><td class="who"><b>${esc(x.title)}</b><span>${PLAT[x.platform]}</span></td><td>${esc(x.class_name)}</td><td>${pill(x.is_open ? 'in_progress' : 'closed').replace(/In progress|Closed/, x.is_open ? 'Open' : 'Closed')}</td>
      <td class="num">${x.attempts}</td><td class="num">${x.high_risk}</td><td class="num">${x.to_review}</td><td class="num"><button class="sm" data-act="toggleExam" data-id="${x.id}" data-open="${x.is_open}">${x.is_open ? 'Close' : 'Reopen'}</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="card">${empty('No exams yet', classes.length ? 'Add the link to a Google Form or Microsoft Form to start collecting integrity signals.' : 'Create a class first, then add an exam to it.', classes.length ? '<button class="primary" data-act="newExam">New exam</button>' : '<a class="btn" href="#/classes">Go to classes</a>')}</div>`}`);
  }
  ACT.newExam = () => { const cl = S.view.classes || []; if (!cl.length) return toast('Create a class first.', true);
    openModal(`<h2>New exam</h2><form data-submit="createExam"><label>Class</label><select name="class_id">${cl.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <label>Exam title</label><input name="title" placeholder="Unit 3 quiz" required>
      <label>Form link</label><input name="url" placeholder="https://docs.google.com/forms/d/e/…/viewform" required>
      <p class="small muted" style="margin-top:6px">Google: the full link that ends in /viewform. Microsoft: open the short link first, then copy the address that contains <span class="code">?id=</span>.</p>
      <div class="foot"><button type="button" data-act="closeModal">Cancel</button><button class="primary">Add exam</button></div></form>`); };
  ACT.createExam = guard(async (f) => { const x = await api('/exams', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); closeModal(); toast('Exam added.'); location.hash = '#/exam/' + x.id; });
  ACT.toggleExam = guard(async (el) => { await api('/exams/' + el.dataset.id, { method: 'PATCH', body: { is_open: el.dataset.open !== '1' } }); route(); });

  async function examView(id) {
    const v = S.view = { id, d: await api(`/exams/${id}/attempts`) };
    mount('exams', `<a class="crumb" href="#/exams">← All exams</a><div id="head"></div><div id="stats" class="stats"></div>
      <div class="note">The risk score points you to attempts worth a closer look. It is not proof of cheating: students may paste their own text, or switch tabs for harmless reasons.</div>
      <div id="roster"></div><div class="card" id="how"></div>`);
    paintExam();
    S.poll = setInterval(async () => { try { v.d = await api(`/exams/${id}/attempts`); paintExam(); } catch { /* ignore */ } }, 5000);
  }
  function paintExam() {
    const { d, id } = S.view, x = d.exam, s = d.summary, w = d.weights;
    $('#head').innerHTML = `<div class="head"><div><h1>${esc(x.title)}</h1><div class="sub"><span>${esc(x.class_name)}</span><span>${PLAT[x.platform]}</span>${x.is_open ? pill('in_progress').replace('In progress', 'Open') : pill('closed')}</div></div>
      <div class="actions"><button data-act="toggleExam" data-id="${x.id}" data-open="${x.is_open}">${x.is_open ? 'Close exam' : 'Reopen exam'}</button><button data-act="csv" data-v="/exams/${id}/report.csv" data-n="exam-${id}-report.csv">Export CSV</button><button class="danger" data-act="deleteExam">Delete</button></div></div>`;
    $('#stats').innerHTML = [['brand', `${s.started}/${s.enrolled}`, 'Started'], ['away', s.in_progress, 'In progress'], ['absent', s.high, 'High risk'], ['', s.to_review, 'Waiting for review']].map(([k, n, l]) => `<div class="stat ${k}"><b>${n}</b><span>${l}</span></div>`).join('');
    $('#roster').innerHTML = !d.students.length ? `<div class="card">${empty('No students in this class', 'Students appear here after they join the class.')}</div>`
      : `<div class="tablewrap"><table><thead><tr><th>Student</th><th>Status</th><th>Risk score</th><th class="num">Tab switches</th><th class="num">Time away</th><th class="num">Copy</th><th class="num">Paste</th><th class="num">Cut</th><th>Review</th></tr></thead><tbody>
      ${d.students.map(r => `<tr class="${r.attempt_id ? 'click' : ''}" ${r.attempt_id ? `data-act="attempt" data-id="${r.attempt_id}" tabindex="0"` : ''}><td class="who"><b>${esc(r.name)}</b><span>${esc(r.email)}</span></td><td>${pill(r.state)}</td>
      <td>${r.attempt_id ? `<div class="meter"><div><i class="${r.risk_level}" style="width:${r.risk_score}%"></i></div><b>${r.risk_score}</b></div>` : '–'}</td>
      <td class="num">${r.attempt_id ? r.counts.tab_switch : '–'}</td><td class="num">${r.attempt_id ? dur(r.away_ms) : '–'}</td><td class="num">${r.attempt_id ? r.counts.copy : '–'}</td><td class="num">${r.attempt_id ? r.counts.paste : '–'}</td><td class="num">${r.attempt_id ? r.counts.cut : '–'}</td>
      <td>${r.attempt_id ? (r.risk_level === 'low' && r.review_status === 'pending' ? '<span class="muted">Not needed</span>' : pill(r.review_status)) : ''}</td></tr>`).join('')}</tbody></table></div>`;
    $('#how').innerHTML = `<h3>How the risk score works</h3><p class="muted small">Points add up to a maximum of 100. ${d.levels.medium}+ is medium and ${d.levels.high}+ is high.</p>
      <p class="small">Tab switch ${w.tab_switch} · Clicked into another window ${w.window_blur} · Copy ${w.copy} · Paste ${w.paste} · Cut ${w.cut} · Time away ${w.away_per_minute} per minute (up to ${w.away_cap})</p>`;
  }
  ACT.deleteExam = guard(async () => { if (!confirm('Delete this exam and every recorded attempt?')) return; await api('/exams/' + S.view.id, { method: 'DELETE' }); location.hash = '#/exams'; });
  const EV = { tab_switch: 'Left the exam tab', tab_return: 'Came back to the exam tab', window_blur: 'Clicked into another window', copy: 'Copied (content not recorded)', paste: 'Pasted (content not recorded)', cut: 'Cut (content not recorded)' };
  ACT.attempt = guard(async (el) => {
    const { attempt: a, events, assessment: s } = await api(`/exams/${S.view.id}/attempts/${el.dataset.id}`);
    S.view.attemptId = a.id;
    openDrawer(`<h2>${esc(a.name)}</h2><div class="muted small" style="margin:-6px 0 10px">${esc(a.email)} · started ${when(a.started_at)}</div>
      <div class="meter" style="margin-bottom:6px"><div><i class="${s.level}" style="width:${s.score}%"></i></div><b>${s.score}</b></div>${pill(s.level)} <span class="muted small">risk level</span>
      <h3 style="margin-top:20px">Why this score</h3>${s.reasons.length ? `<ul class="plain small">${s.reasons.map(r => `<li>${r.label}: ${r.count} (+${r.points})</li>`).join('')}</ul>` : '<p class="muted small">Nothing unusual was recorded.</p>'}
      <h3 style="margin-top:20px">Your review</h3><textarea id="note" placeholder="Add a note for your records (optional)">${esc(a.review_note || '')}</textarea>
      <div class="row" style="margin-top:8px"><button class="sm" data-act="review" data-v="cleared">Mark as cleared</button><button class="sm danger" data-act="review" data-v="flagged">Flag for follow-up</button><button class="sm" data-act="review" data-v="pending">Reset</button> ${pill(a.review_status)}</div>
      <h3 style="margin-top:22px">Timeline</h3>${events.length ? `<ul class="timeline">${events.map(e => `<li class="${e.type}">${EV[e.type]}${e.duration_ms ? ` <span class="muted">(${dur(e.duration_ms)} away)</span>` : ''} <span class="muted small">${clock(e.at)}</span></li>`).join('')}</ul>` : '<p class="muted small">No events.</p>'}`);
  });
  ACT.review = guard(async (el) => { await api(`/exams/${S.view.id}/attempts/${S.view.attemptId}`, { method: 'PATCH', body: { review_status: el.dataset.v, review_note: $('#note').value } }); toast('Review saved.'); closeDrawer(); S.view.d = await api(`/exams/${S.view.id}/attempts`); paintExam(); });

  /* ---------- student ---------- */
  const consentPill = (c) => !c ? '<span class="pill pending">Not answered</span>' : c.granted ? '<span class="pill focused">Allowed</span>' : '<span class="pill absent">Not allowed</span>';
  async function myView() {
    const [classes, me] = await Promise.all([api('/student/classes'), api('/me')]); S.consents = me.consents;
    mount('my', `<div class="head"><div><h1>My classes</h1><div class="sub">Join your teacher's class with the code they gave you.</div></div></div>
      ${!me.consents.attendance?.granted ? `<div class="note">Attendance monitoring is off, so your teacher cannot record you as present. <a href="#/privacy">Review your privacy choices</a>.</div>` : ''}
      <div class="card"><h2>Join a class</h2><form class="row" data-submit="joinClass"><input name="join_code" placeholder="Join code, for example PHYS10" maxlength="12" required aria-label="Join code"><button class="primary">Join class</button></form></div>
      <div class="card"><h2>Your classes</h2>${classes.length ? `<div class="tablewrap" style="box-shadow:none"><table><thead><tr><th>Class</th><th>Teacher</th><th>Google Meet</th><th>Right now</th><th></th></tr></thead><tbody>
        ${classes.map(c => `<tr><td><b>${esc(c.name)}</b>${c.open_exams ? `<div class="small muted">${c.open_exams} open exam${c.open_exams > 1 ? 's' : ''}</div>` : ''}</td><td>${esc(c.teacher)}</td><td><span class="code">${esc(c.meet_code)}</span></td>
        <td>${c.in_meeting ? pill(c.focused ? 'focused' : 'away').replace(/Focused|Tab in background/, 'Reporting') : '<span class="muted">Not in class</span>'}</td><td class="num"><button class="sm" data-act="leaveClass" data-id="${c.id}">Leave</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">You have not joined a class yet.</p>'}</div>
      <div class="card"><h2>Set up the browser extension</h2><ol class="steps"><li>In Chrome or Edge, open <span class="code">chrome://extensions</span> and turn on <b>Developer mode</b>.</li><li>Choose <b>Load unpacked</b> and select the <span class="code">extension</span> folder from the ClassGuard download.</li>
      <li>Click the ClassGuard icon, set the server to <span class="code">${esc(location.origin)}</span> and sign in with this account.</li><li>Open your Google Meet class as usual. A small "ClassGuard" badge confirms it is reporting.</li></ol></div>`);
  }
  ACT.joinClass = guard(async (f) => { const r = await api('/student/classes/join', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); toast('Joined ' + r.class.name + '.'); myView(); });
  ACT.leaveClass = guard(async (el) => { if (!confirm('Leave this class? Your teacher will no longer see you in the roster.')) return; await api('/student/classes/' + el.dataset.id, { method: 'DELETE' }); toast('You left the class.'); myView(); });

  /* ---------- privacy (both roles) ---------- */
  async function privacyView() {
    const me = await api('/me'); S.consents = me.consents; const st = S.user.role === 'student';
    mount('privacy', `<div class="head"><div><h1>Privacy</h1><div class="sub">What ClassGuard collects, and your choices.</div></div></div>
      <div class="card"><div class="cols"><div><h3>Collected</h3><ul class="plain small"><li>Whether the class tab was in front, and when you joined, left or rejoined</li><li>For exams: how many times you left the exam tab, for how long, and how many times you copied, pasted or cut</li><li>Your name, email and a hashed password</li></ul></div>
      <div><h3>Never collected</h3><ul class="plain small"><li>Your screen, camera, microphone or other tabs</li><li>Mouse movement or keystrokes</li><li>Your exam answers, or what you copied or pasted</li><li>Browsing history</li></ul></div></div>
      <p class="small muted" style="margin:14px 0 0">Records are deleted automatically after the retention period set by your school.</p></div>
      ${st ? `<div class="card"><h2>Your consent</h2>
        <div class="switch"><div><b>Class attendance and focus</b><div class="small muted">Lets the extension report that you are in your Meet and whether the tab is in front.</div></div><div class="row">${consentPill(me.consents.attendance)}<button class="sm" data-act="consent" data-s="attendance" data-g="${!me.consents.attendance?.granted}">${me.consents.attendance?.granted ? 'Turn off' : 'Allow'}</button></div></div>
        <div class="switch"><div><b>Exam integrity</b><div class="small muted">Counts tab switches and copy, paste and cut on exams your teacher has added.</div></div><div class="row">${consentPill(me.consents.exam)}<button class="sm" data-act="consent" data-s="exam" data-g="${!me.consents.exam?.granted}">${me.consents.exam?.granted ? 'Turn off' : 'Allow'}</button></div></div></div>` : ''}
      <div class="card"><h2>Your data</h2><div class="row"><button data-act="exportMe">Download my data</button><button class="danger" data-act="deleteMe">Delete my account</button></div>
      <p class="small muted" style="margin:10px 0 0">Deleting your account permanently removes ${st ? 'your attendance and exam records' : 'your classes, sessions and exams'}.</p></div>`);
  }
  ACT.consent = guard(async (el) => { await api('/me/consents', { method: 'PUT', body: { scope: el.dataset.s, granted: el.dataset.g === 'true' } }); toast('Choice saved.'); privacyView(); });
  ACT.exportMe = () => download('/me/export', 'my-classguard-data.json');
  ACT.deleteMe = () => openModal(`<h2>Delete your account</h2><p class="muted">This permanently removes your account and everything recorded about you. Enter your password to confirm.</p>
    <form data-submit="confirmDelete"><input type="password" name="password" required aria-label="Password"><div class="foot"><button type="button" data-act="closeModal">Cancel</button><button class="danger">Delete everything</button></div></form>`);
  ACT.confirmDelete = guard(async (f) => { await api('/me', { method: 'DELETE', body: Object.fromEntries(new FormData(f)) }); closeModal(); logout(); toast('Account deleted.'); });

  /* ---------- router + events ---------- */
  async function route() {
    clearInterval(S.poll); closeDrawer();
    if (!S.token) return authView();
    try {
      if (!S.user) S.user = (await api('/me')).user;
      const [a, b, c, d] = location.hash.replace(/^#\/?/, '').split('/');
      if (a === 'privacy') return await privacyView();
      if (S.user.role === 'student') return await myView();
      if (a === 'class' && b) return c === 'sessions' ? await sessionsView(b) : await liveView(b, c === 'session' ? d : null);
      if (a === 'exams') return await examsView();
      if (a === 'exam' && b) return await examView(b);
      return await classesView();
    } catch (e) {
      if (!S.token) return;
      $('#app').innerHTML = `<div class="main"><div class="card">${empty('Something went wrong', esc(e.message), '<a class="btn" href="#/">Back to start</a>')}</div></div>`;
    }
  }
  document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeModal(); } if (e.key === 'Enter' && e.target.matches('tr[data-act]')) ACT[e.target.dataset.act](e.target, e); });
  document.addEventListener('submit', (e) => { const f = e.target.closest('[data-submit]'); if (f) { e.preventDefault(); ACT[f.dataset.submit](f, e); } });
  document.addEventListener('input', (e) => { const el = e.target.closest('[data-input]'); if (el) ACT[el.dataset.input](el, e); });
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
  window.addEventListener('hashchange', route);
  route();
})();
