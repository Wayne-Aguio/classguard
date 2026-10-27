// Runs on meet.google.com. It only answers two questions:
//   1. Is this a meeting page (the URL contains a meeting code)?
//   2. Is this tab in front right now (tab visible AND window focused)?
// It does not read the mouse, keyboard, screen, chat, captions, or who is in the call.
(() => {
  const m = location.pathname.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:$|[/?])/i);
  if (!m) return;
  const code = m[1].toLowerCase();
  const front = () => document.visibilityState === 'visible' && document.hasFocus();

  // Optional "in-call detection" (off by default): only checks that a "Leave call" button exists.
  // Useful because Meet keeps the same URL on the lobby and "You left the meeting" screens.
  const inCall = () => !!document.querySelector('button[aria-label^="Leave call"], [data-tooltip^="Leave call"]');

  let strict = false, wasIn = false, badge;
  chrome.storage.local.get({ strictCall: false }, (s) => { strict = !!s.strictCall; });
  chrome.storage.onChanged.addListener((c) => { if (c.strictCall) strict = !!c.strictCall.newValue; });

  const show = (text, tone) => {
    if (!badge) {
      const host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = '<style>div{font:12px system-ui,sans-serif;padding:4px 10px;border-radius:999px;background:#0f1b2d;color:#fff;opacity:.85}b{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px}</style><div><b></b><span></span></div>';
      document.documentElement.appendChild(host);
      badge = { host, dot: root.querySelector('b'), text: root.querySelector('span') };
    }
    badge.text.textContent = text;
    badge.dot.style.background = tone;
    badge.host.style.display = text ? 'block' : 'none';
  };

  function send(type) {
    chrome.runtime.sendMessage({ kind: 'meet', type, code, focused: front() }, (r) => {
      if (chrome.runtime.lastError || !r) return;
      if (r.ok) show('ClassGuard: attendance on', r.state === 'focused' ? '#4fd49a' : '#f3b34a');
      else if (r.error === 'consent_required') show('ClassGuard: open the extension to give consent', '#b3a0ff');
      else if (r.error === 'not_signed_in' || r.status === 401) show('ClassGuard: sign in from the extension', '#b3a0ff');
      else if (r.error === 'no_class') show('', '');
    });
  }

  function tick() {
    if (!strict) { wasIn = true; return send('beat'); }
    const now = inCall();
    if (now) send('beat');
    else if (wasIn) { send('leave'); show('', ''); }
    wasIn = now;
  }

  ['visibilitychange'].forEach(ev => document.addEventListener(ev, tick));
  ['focus', 'blur'].forEach(ev => window.addEventListener(ev, tick));
  window.addEventListener('pagehide', () => send('leave'));
  setInterval(tick, 15000);
  setInterval(() => { if (strict && inCall() !== wasIn) tick(); }, 3000);
  tick();
})();
