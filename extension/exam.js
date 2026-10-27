// Runs on Google Forms and Microsoft Forms pages. Only acts if the teacher added this exact
// form as an exam for one of the student's classes, and the student has given consent.
// It counts events. It never reads answers, the clipboard, selected text, the screen, mouse or keys.
(async () => {
  if (window.top !== window) return;
  const send = (m) => new Promise(res => chrome.runtime.sendMessage(m, r => res(chrome.runtime.lastError ? null : r)));

  const match = await send({ kind: 'exam_match', url: location.href });
  if (!match || !match.match) return;
  const examId = match.exam.id;

  // Google shows /formResponse after submitting: mark the attempt finished and stop.
  if (/\/formResponse$/.test(location.pathname)) return void send({ kind: 'exam_finish', exam_id: examId });

  if (!match.consent) {
    const ok = await askConsent(match.exam.title);
    if (!ok) return;
    const r = await send({ kind: 'consent', scope: 'exam', granted: true });
    if (!r || r.error) return;
  }

  // ---- monitoring ----
  let queue = [], hiddenAt = null, blurTimer = null;
  const push = (type, duration_ms) => queue.push({ type, at: Date.now(), ...(duration_ms ? { duration_ms } : {}) });
  async function flush() {
    const events = queue; queue = [];
    const r = await send({ kind: 'exam_events', exam_id: examId, events });
    if (!r || r.error) queue = events.concat(queue).slice(-200); // keep and retry later
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); push('tab_switch'); flush(); }
    else if (hiddenAt) { push('tab_return', Date.now() - hiddenAt); hiddenAt = null; flush(); }
  });
  // Clicking into another window while the exam stays visible (e.g. a second monitor).
  window.addEventListener('blur', () => { blurTimer = setTimeout(() => { if (document.visibilityState === 'visible') push('window_blur'); }, 400); });
  window.addEventListener('focus', () => clearTimeout(blurTimer));
  for (const t of ['copy', 'paste', 'cut']) document.addEventListener(t, () => push(t), true); // counts only
  window.addEventListener('pagehide', flush);
  setInterval(() => { if (queue.length) flush(); }, 10000);

  await flush();            // an empty batch creates the attempt on the server
  badge('Exam integrity monitoring is on');

  // ---- small UI (closed shadow DOM so the page cannot read or restyle it) ----
  function ui(html) {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:auto;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = html;
    document.documentElement.appendChild(host);
    return { host, root };
  }
  function badge(text) {
    const { host, root } = ui(`<style>div{position:fixed;right:12px;bottom:12px;font:12px system-ui,sans-serif;padding:5px 11px;border-radius:999px;background:#0f1b2d;color:#fff;opacity:.88}</style><div>${text}</div>`);
    host.style.pointerEvents = 'none';
  }
  function askConsent(title) {
    return new Promise(resolve => {
      const { host, root } = ui(`<style>
        .bg{position:fixed;inset:0;background:rgba(8,14,26,.6);display:grid;place-items:center;font:14px/1.5 system-ui,sans-serif}
        .box{background:#fff;color:#101828;border-radius:12px;padding:24px;width:min(460px,92vw)}
        h2{margin:0 0 8px;font-size:18px} ul{padding-left:18px;margin:8px 0} p{margin:6px 0}
        .row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
        button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;cursor:pointer}
        button.p{background:#2457d6;border-color:#2457d6;color:#fff}</style>
        <div class="bg"><div class="box" role="dialog" aria-modal="true">
        <h2>This exam uses integrity monitoring</h2>
        <p><b></b> is set up for review by your teacher.</p>
        <p>If you agree, ClassGuard records:</p>
        <ul><li>how many times you leave this tab, and for how long</li><li>how many times you copy, paste or cut</li></ul>
        <p>It never sees your answers, what you copy or paste, your screen, mouse or keyboard. You can withdraw consent any time in the extension.</p>
        <div class="row"><button id="no">No thanks</button><button class="p" id="yes">I agree, continue</button></div></div></div>`);
      root.querySelector('b').textContent = title;
      root.querySelector('#yes').onclick = () => { host.remove(); resolve(true); };
      root.querySelector('#no').onclick = () => { host.remove(); resolve(false); };
    });
  }
})();
