const router = require('express').Router();
const db = require('../db');
const { hashPassword, checkPassword, sign, auth } = require('../auth');

const CONSENT_VERSION = 1;
const consentState = (userId, scope) => {
  const c = db.consentOf(userId, scope);
  return c ? { granted: !!c.granted, version: c.version, at: c.created_at } : null;
};
const consentsOf = (u) => u.role === 'student'
  ? { attendance: consentState(u.id, 'attendance'), exam: consentState(u.id, 'exam') } : null;

// ---- sign up / sign in ----
router.post('/auth/register', (req, res) => {
  const { name, email, password, role, invite_code } = req.body || {};
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 8)
    return res.status(400).json({ error: 'invalid_input', message: 'Enter your name, a valid email and a password of at least 8 characters.' });
  if (!['teacher', 'student'].includes(role)) return res.status(400).json({ error: 'invalid_role', message: 'Choose teacher or student.' });
  if (role === 'teacher' && process.env.TEACHER_INVITE_CODE && invite_code !== process.env.TEACHER_INVITE_CODE)
    return res.status(403).json({ error: 'invite_required', message: 'Teacher sign-up needs the school invite code.' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email))
    return res.status(409).json({ error: 'email_taken', message: 'An account with this email already exists.' });
  const id = db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)')
    .run(name.trim(), email.trim(), hashPassword(password), role, Date.now()).lastInsertRowid;
  const user = { id, name: name.trim(), email: email.trim(), role };
  res.status(201).json({ token: sign(user), user });
});

const attempts = new Map(); // very small in-memory login rate limit
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const key = `${req.ip}|${String(email).toLowerCase()}`;
  const a = attempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts. Try again in 15 minutes.' });
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email || '');
  if (!u || !checkPassword(password || '', u.password_hash)) {
    attempts.set(key, { n: a.n + 1, t: a.t });
    return res.status(401).json({ error: 'bad_credentials', message: 'Email or password is incorrect.' });
  }
  attempts.delete(key);
  const user = { id: u.id, name: u.name, email: u.email, role: u.role };
  res.json({ token: sign(user), user, consents: consentsOf(user) });
});

// ---- me ----
router.get('/me', auth(), (req, res) => res.json({ user: req.user, consents: consentsOf(req.user), consent_version: CONSENT_VERSION }));

router.put('/me/consents', auth('student'), (req, res) => {
  const { scope, granted } = req.body || {};
  if (!['attendance', 'exam'].includes(scope) || typeof granted !== 'boolean') return res.status(400).json({ error: 'invalid_input' });
  db.prepare('INSERT INTO consents(user_id,scope,version,granted,created_at) VALUES(?,?,?,?,?)').run(req.user.id, scope, CONSENT_VERSION, granted ? 1 : 0, Date.now());
  res.json({ consents: consentsOf(req.user) });
});

router.get('/me/export', auth(), (req, res) => {
  const id = req.user.id, all = (sql) => db.prepare(sql).all(id);
  const data = { exported_at: new Date().toISOString(), user: req.user };
  if (req.user.role === 'student') Object.assign(data, {
    consents: all('SELECT scope,version,granted,created_at FROM consents WHERE user_id=?'),
    classes: all('SELECT c.name,c.meet_code,e.created_at FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=?'),
    attendance_events: all('SELECT session_id,kind,reason,at FROM attendance_events WHERE student_id=?'),
    focus_events: all('SELECT session_id,state,at FROM focus_events WHERE student_id=?'),
    exam_attempts: all('SELECT id,exam_id,started_at,status,risk_score,risk_level,review_status FROM exam_attempts WHERE student_id=?'),
    exam_events: all('SELECT x.attempt_id,x.type,x.duration_ms,x.at FROM exam_events x JOIN exam_attempts a ON a.id=x.attempt_id WHERE a.student_id=?')
  });
  else data.classes = all('SELECT id,name,meet_code,created_at FROM classes WHERE teacher_id=?');
  res.setHeader('Content-Disposition', 'attachment; filename="my-classguard-data.json"');
  res.json(data);
});

router.delete('/me', auth(), (req, res) => {
  const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!checkPassword((req.body || {}).password || '', u.password_hash))
    return res.status(401).json({ error: 'bad_credentials', message: 'Password is incorrect.' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.user.id); // cascades to all of this user's data
  res.json({ ok: true });
});

// ---- student: classes ----
router.get('/student/classes', auth('student'), (req, res) => {
  res.json(db.prepare(`SELECT c.id,c.name,c.meet_code,u.name AS teacher,e.in_meeting,e.focused,e.last_seen_at,
      (SELECT COUNT(*) FROM exams x WHERE x.class_id=c.id AND x.is_open=1) AS open_exams
    FROM enrollments e JOIN classes c ON c.id=e.class_id JOIN users u ON u.id=c.teacher_id
    WHERE e.student_id=? ORDER BY c.name`).all(req.user.id));
});

router.post('/student/classes/join', auth('student'), (req, res) => {
  const code = String((req.body || {}).join_code || '').trim().toUpperCase();
  const c = db.prepare('SELECT id,name FROM classes WHERE join_code=?').get(code);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'No class uses that join code. Check it with your teacher.' });
  db.prepare('INSERT OR IGNORE INTO enrollments(class_id,student_id,created_at) VALUES(?,?,?)').run(c.id, req.user.id, Date.now());
  res.status(201).json({ ok: true, class: c });
});

router.delete('/student/classes/:id', auth('student'), (req, res) => {
  db.prepare('DELETE FROM enrollments WHERE class_id=? AND student_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
