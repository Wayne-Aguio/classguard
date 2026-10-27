// Service worker: the only place that talks to the ClassGuard server.
// Content scripts send it small messages; it adds the sign-in token and forwards them.
const DEFAULT_SERVER = 'http://localhost:3000';
const tabs = new Map();      // tabId -> { code, focused, t }  (Meet tabs we are tracking)
const ignored = new Map();   // meet code -> time until which we skip it (not one of the student's classes)

async function config() {
  return chrome.storage.local.get({ server: DEFAULT_SERVER, token: null });
}

async function api(path, method = 'GET', body) {
  const { server, token } = await config();
  if (!token) throw { error: 'not_signed_in' };
  const res = await fetch(server.replace(/\/$/, '') + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) await chrome.storage.local.remove('token');
  if (!res.ok) throw { status: res.status, ...json };
  return json;
}

// If a student has the same Meet open in two tabs, "focused" means at least one is in front.
function aggregate(code) {
  const now = Date.now();
  let any = false, focused = false;
  for (const v of tabs.values()) {
    if (v.code === code && now - v.t < 40000) { any = true; focused ||= v.focused; }
  }
  return { any, focused };
}

async function presence(code, leaving) {
  const agg = aggregate(code);
  const res = await api('/ext/presence', 'POST', { meet_code: code, focused: agg.focused, leaving: !!leaving });
  await chrome.storage.session.set({ last: { cls: res.class, state: res.state, at: Date.now() } });
  return { ok: true, state: res.state, cls: res.class };
}

async function handle(msg, sender) {
  const tabId = sender.tab?.id;
  switch (msg.kind) {
    case 'meet': {
      if ((ignored.get(msg.code) || 0) > Date.now()) return { error: 'no_class' };
      if (msg.type === 'leave') {
        tabs.delete(tabId);
        if (aggregate(msg.code).any) return { ok: true };
        return presence(msg.code, true).catch(() => ({ ok: true }));
      }
      tabs.set(tabId, { code: msg.code, focused: !!msg.focused, t: Date.now() });
      try { return await presence(msg.code, false); }
      catch (e) {
        if (e.error === 'no_class') ignored.set(msg.code, Date.now() + 5 * 60000);
        throw e;
      }
    }
    case 'exam_match': return api('/ext/exam/match', 'POST', { url: msg.url });
    case 'exam_events': return api('/ext/exam/events', 'POST', { exam_id: msg.exam_id, events: msg.events });
    case 'exam_finish': return api('/ext/exam/finish', 'POST', { exam_id: msg.exam_id });
    case 'consent': return api('/me/consents', 'PUT', { scope: msg.scope, granted: msg.granted });
    default: return { error: 'unknown' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse).catch(e => sendResponse({ error: e.error || 'failed', status: e.status }));
  return true; // keep the channel open for the async reply
});

// Tab closed without a chance to say goodbye: tell the server if it was the last tab for that Meet.
chrome.tabs.onRemoved.addListener((tabId) => {
  const t = tabs.get(tabId);
  if (!t) return;
  tabs.delete(tabId);
  if (!aggregate(t.code).any) presence(t.code, true).catch(() => {});
});
