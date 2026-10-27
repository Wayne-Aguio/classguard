// Creates demo accounts, past class sessions and an exam so the dashboard has something to show.
//   Teacher:  teacher@demo.test / teacher123
//   Students: ana@demo.test, ben@demo.test, ... / student123
const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const risk = require('../server/risk');

if (db.prepare("SELECT 1 FROM users WHERE email='teacher@demo.test'").get()) {
  console.log('Demo data already exists. Delete data/classguard.db to start fresh.');
  process.exit(0);
}

const now = Date.now(), MIN = 60000;
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const addUser = (name, email, role, pw) =>
  db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(name, email, hashPassword(pw), role, now).lastInsertRowid;

db.transaction(() => {
  const teacher = addUser('Ms. Rivera', 'teacher@demo.test', 'teacher', 'teacher123');
  const classId = db.prepare('INSERT INTO classes(teacher_id,name,meet_code,join_code,created_at) VALUES(?,?,?,?,?)')
    .run(teacher, 'Grade 10 Physics', 'abc-defg-hij', 'PHYS10', now).lastInsertRowid;

  const people = [
    ['Ana Santos', 'ana', { focus: 0.95, leave: 0.02, absent: 0 }],
    ['Ben Reyes', 'ben', { focus: 0.75, leave: 0.1, absent: 0.1 }],
    ['Carla Lim', 'carla', { focus: 0.9, leave: 0.05, absent: 0 }],
    ['Diego Cruz', 'diego', { focus: 0.45, leave: 0.25, absent: 0.1 }],
    ['Elise Tan', 'elise', { focus: 0.85, leave: 0.04, absent: 0.05 }],
    ['Farid Ali', 'farid', { focus: 0.6, leave: 0.15, absent: 0.2 }],
    ['Gwen Ocampo', 'gwen', { focus: 0.92, leave: 0.03, absent: 0 }],
    ['Hugo Dela Cruz', 'hugo', { focus: 0.7, leave: 0.12, absent: 0.15 }]
  ].map(([name, slug, p]) => ({ id: addUser(name, `${slug}@demo.test`, 'student', 'student123'), p }));

  const cons = db.prepare('INSERT INTO consents(user_id,scope,version,granted,created_at) VALUES(?,?,1,?,?)');
  const enr = db.prepare('INSERT INTO enrollments(class_id,student_id,created_at) VALUES(?,?,?)');
  people.forEach(({ id }, i) => {
    enr.run(classId, id, now);
    cons.run(id, 'attendance', i === 7 ? 0 : 1, now);   // Hugo has declined, to show the "No consent" state
    cons.run(id, 'exam', 1, now);
  });

  // ---- three past sessions ----
  const att = db.prepare('INSERT INTO attendance_events(session_id,student_id,kind,reason,at) VALUES(?,?,?,?,?)');
  const foc = db.prepare('INSERT INTO focus_events(session_id,student_id,state,at) VALUES(?,?,?,?)');
  for (const daysAgo of [1, 3, 6]) {
    const start = new Date(now - daysAgo * 864e5).setHours(9, 0, 0, 0), dur = 60 * MIN;
    const sid = db.prepare('INSERT INTO class_sessions(class_id,started_at,ended_at) VALUES(?,?,?)').run(classId, start, start + dur).lastInsertRowid;
    for (const { id, p } of people.slice(0, 7)) {
      if (Math.random() < p.absent) continue;
      let t = start + rand(0, 6) * MIN, joined = false;
      const end = start + dur - rand(0, 4) * MIN;
      att.run(sid, id, 'join', 'heartbeat', t); foc.run(sid, id, 'front', t);
      while ((t += rand(2, 7) * MIN) < end) {
        if (Math.random() < p.leave) {
          att.run(sid, id, 'leave', 'timeout', t);
          if ((t += rand(1, 4) * MIN) >= end) { joined = true; break; }
          att.run(sid, id, 'rejoin', 'heartbeat', t); foc.run(sid, id, 'front', t);
        } else foc.run(sid, id, Math.random() < p.focus ? 'front' : 'background', t);
      }
      if (!joined) att.run(sid, id, 'leave', 'left', end);
    }
  }

  // ---- one open exam with attempts of different risk levels ----
  const exam = db.prepare('INSERT INTO exams(class_id,title,url,url_key,platform,created_at) VALUES(?,?,?,?,?,?)')
    .run(classId, 'Unit 3 quiz: Forces and motion', 'https://docs.google.com/forms/d/e/1FAIpQLSdemoPhysicsQuiz/viewform', 'gf:1FAIpQLSdemoPhysicsQuiz', 'google', now).lastInsertRowid;
  const profiles = [
    [0, { }],
    [1, { tab_switch: 1 }],
    [2, { }],
    [3, { tab_switch: 6, paste: 3, copy: 2, away: 140 }],
    [4, { window_blur: 2, copy: 1 }],
    [5, { tab_switch: 3, paste: 1, away: 45 }]
  ];
  const insAttempt = db.prepare('INSERT INTO exam_attempts(exam_id,student_id,started_at,last_event_at,status,risk_score,risk_level) VALUES(?,?,?,?,?,?,?)');
  const insEvent = db.prepare('INSERT INTO exam_events(attempt_id,type,duration_ms,at) VALUES(?,?,?,?)');
  for (const [i, spec] of profiles) {
    const t0 = now - 50 * MIN, events = [];
    const add = (type, d) => events.push({ type, duration_ms: d || null, at: t0 + rand(1, 40) * MIN });
    for (let k = 0; k < (spec.tab_switch || 0); k++) { add('tab_switch'); add('tab_return', (spec.away || 20) * 1000 / (spec.tab_switch)); }
    for (const t of ['window_blur', 'copy', 'paste', 'cut']) for (let k = 0; k < (spec[t] || 0); k++) add(t);
    const r = risk.assess(events);
    const a = insAttempt.run(exam, people[i].id, t0, t0 + 45 * MIN, 'ended', r.score, r.level).lastInsertRowid;
    events.sort((x, y) => x.at - y.at).forEach(e => insEvent.run(a, e.type, e.duration_ms && Math.round(e.duration_ms), e.at));
  }
})();

console.log(`
Demo data created.

  Teacher   teacher@demo.test / teacher123
  Students  ana@demo.test, ben@demo.test, carla@demo.test ... / student123
  Class     "Grade 10 Physics"  (Meet code abc-defg-hij, join code PHYS10)

Start the server (npm start), sign in as the teacher, and run "npm run simulate"
in a second terminal to watch the live dashboard fill up.`);
