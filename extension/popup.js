const root = document.getElementById('root');
const DEFAULT_SERVER = 'http://localhost:3000';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function call(path, method = 'GET', body) {
  const { server, token } = await chrome.storage.local.get({ server: DEFAULT_SERVER, token: null });
  const res = await fetch(server.replace(/\/$/, '') + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && token) await chrome.storage.local.remove('token');
  if (!res.ok) throw new Error(json.message || 'Could not reach the server.');
  return json;
}

async function init() {
  const { token } = await chrome.storage.local.get({ token: null });
  if (!token) return signIn();
  try { main(await call('/ext/status')); } catch (e) { signIn(e.message); }
}

async function signIn(error = '') {
  const { server } = await chrome.storage.local.get({ server: DEFAULT_SERVER });
  root.innerHTML = `<h2>Sign in</h2><p class="muted small">Use the same account as on the ClassGuard website.</p>
    <form id="f"><label>Server address</label><input type="url" name="server" value="${esc(server)}" required>
    <label>Email</label><input type="email" name="email" required autocomplete="username">
    <label>Password</label><input type="password" name="password" required autocomplete="current-password">
    <div class="err" id="err">${esc(error)}</div><button class="p">Sign in</button></form>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await chrome.storage.local.set({ server: f.server.trim() });
      const r = await call('/auth/login', 'POST', { email: f.email, password: f.password });
      if (r.user.role !== 'student') throw new Error('The extension is for student accounts.');
      await chrome.storage.local.set({ token: r.token });
      init();
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

const chip = (c) => !c ? '<span class="pill off">Not answered</span>' : c.granted ? '<span class="pill ok">Allowed</span>' : '<span class="pill off">Not allowed</span>';

async function main(st) {
  const needConsent = !st.consents.attendance;               // first run: ask once
  if (needConsent) return consent(st);
  const { strictCall } = await chrome.storage.local.get({ strictCall: false });
  const { last } = await chrome.storage.session.get('last');
  const live = last && Date.now() - last.at < 60000;
  root.innerHTML = `<div class="row"><div><b>${esc(st.user.name)}</b><div class="muted small">${esc(st.user.email)}</div></div><button class="link" id="out">Sign out</button></div>
    <div class="box"><div class="row"><b>Right now</b>${live ? `<span class="pill ${last.state === 'focused' ? 'ok' : 'warn'}">${last.state === 'focused' ? 'Tab in front' : 'Tab in background'}</span>` : '<span class="pill off">Not in a class</span>'}</div>
      <div class="muted small" style="margin-top:6px">${live ? 'Reporting to ' + esc(last.cls) : st.classes.length ? 'Open your class in Google Meet to start.' : 'Join a class on the ClassGuard website first.'}</div></div>
    <div class="box"><div class="row"><span>Class attendance and focus</span>${chip(st.consents.attendance)}</div>
      <div class="row" style="margin-top:8px"><span>Exam integrity</span>${chip(st.consents.exam)}</div>
      <p style="margin:10px 0 0"><button class="link" id="change">Change my choices</button></p></div>
    <label class="opt"><input type="checkbox" id="strict" ${strictCall ? 'checked' : ''}><span>Only count me while I am in the call, not the lobby (English Meet only; experimental)</span></label>
    <p class="small muted">ClassGuard never reads your screen, mouse, keyboard, chat or answers.</p>`;
  document.getElementById('out').onclick = async () => { await chrome.storage.local.remove('token'); init(); };
  document.getElementById('change').onclick = () => consent(st);
  document.getElementById('strict').onchange = (e) => chrome.storage.local.set({ strictCall: e.target.checked });
}

function consent(st) {
  const a = st.consents.attendance?.granted ?? true, x = st.consents.exam?.granted ?? true;
  root.innerHTML = `<h2>Your privacy choices</h2><p class="small muted">You decide what ClassGuard may record. You can change this at any time.</p>
    <div class="box"><b class="small">Recorded</b><ul><li>When you join, leave or rejoin your Meet class</li><li>Whether the class tab is in front</li><li>On exams: tab switches, time away, and how many times you copy, paste or cut</li></ul>
    <b class="small">Never recorded</b><ul><li>Your screen, camera or microphone</li><li>Mouse or keyboard activity</li><li>Your answers, or what you copy or paste</li></ul></div>
    <label class="opt"><input type="checkbox" id="a" ${a ? 'checked' : ''}><span><b>Class attendance and focus</b><br>Your teacher sees if you are in class and whether the tab is in front.</span></label>
    <label class="opt"><input type="checkbox" id="x" ${x ? 'checked' : ''}><span><b>Exam integrity</b><br>Counts tab switches and copy, paste and cut on exams your teacher added.</span></label>
    <div class="err" id="err"></div><button class="p" id="save">Save my choices</button>`;
  document.getElementById('save').onclick = async () => {
    try {
      await call('/me/consents', 'PUT', { scope: 'attendance', granted: document.getElementById('a').checked });
      await call('/me/consents', 'PUT', { scope: 'exam', granted: document.getElementById('x').checked });
      init();
    } catch (e) { document.getElementById('err').textContent = e.message; }
  };
}

init();
