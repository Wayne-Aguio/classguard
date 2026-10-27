// Makes the demo students behave like the Chrome extension: joins, tab switches, leaves, rejoins.
// Run after "npm run seed" with the server running, then watch the teacher dashboard.
//   BASE=http://localhost:3000 npm run simulate
const BASE = process.env.BASE || 'http://localhost:3000';
const CODE = 'abc-defg-hij';
const names = ['ana', 'ben', 'carla', 'diego', 'elise', 'farid', 'gwen'];

async function call(path, token, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body)
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

(async () => {
  const bots = [];
  for (const n of names) {
    const r = await call('/api/auth/login', null, { email: `${n}@demo.test`, password: 'student123' });
    if (!r.token) { console.error(`Could not sign in ${n}. Did you run "npm run seed"? (server running at ${BASE}?)`); process.exit(1); }
    bots.push({ n, token: r.token, inCall: Math.random() < 0.7, focused: true, bias: 0.55 + Math.random() * 0.4 });
  }
  console.log(`Simulating ${bots.length} students in ${CODE}. Press Ctrl+C to stop.`);

  const tick = async () => {
    for (const b of bots) {
      if (b.inCall && Math.random() < 0.03) {               // drops out (stops sending heartbeats)
        b.inCall = false; console.log(`${b.n} leaves`); continue;
      }
      if (!b.inCall) {
        if (Math.random() < 0.12) { b.inCall = true; b.focused = true; console.log(`${b.n} (re)joins`); } else continue;
      }
      if (Math.random() < 0.25) b.focused = Math.random() < b.bias; // switches tab or comes back
      const r = await call('/api/ext/presence', b.token, { meet_code: CODE, focused: b.focused });
      if (r.error) console.log(`${b.n}: ${r.error}`);
    }
  };
  tick();
  setInterval(tick, 5000);
})();
