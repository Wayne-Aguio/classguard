// Endpoints used by the Chrome extension. Every call needs a signed-in student
// and the matching consent; without consent nothing is stored.
const router = require('express').Router();
const db = require('../db');
const { auth } = require('../auth');
const A = require('../attendance');
const risk = require('../risk');
const { meetCode, examKey } = require('../util');

router.use(auth('student'));

const needConsent = (scope) => (req, res, next) => {
  const c = db.consentOf(req.user.id, scope);
  if (!c || !c.granted) return res.status(403).json({ error: 'consent_required', scope, message: `Consent for ${scope} monitoring has not been given.` });
  next();
};

router.get('/status', (req, res) => {
  const cs = (s) => { const c = db.consentOf(req.user.id, s); return c ? { granted: !!c.granted, at: c.created_at } : null; };
  res.json({
    user: req.user,
    consents: { attendance: cs('attendance'), exam: cs('exam') },
    classes: db.prepare('SELECT c.id,c.name,c.meet_code FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=?').all(req.user.id)
  });
});

// ---- Meet heartbeat: {meet_code, focused, leaving?} ----
router.post('/presence', needConsent('attendance'), (req, res) => {
  const code = meetCode(req.body.meet_code);
  const enr = code && db.prepare(`SELECT e.*, c.name AS class_name FROM enrollments e JOIN classes c ON c.id=e.class_id
    WHERE e.student_id=? AND c.meet_code=? LIMIT 1`).get(req.user.id, code);
  if (!enr) return res.status(404).json({ error: 'no_class', message: 'This Meet is not one of your classes.' });
  const now = Date.now(), focused = req.body.focused ? 1 : 0, sid = req.user.id;

  const out = db.transaction(() => {
    const addAtt = (session, kind, reason) => db.prepare('INSERT INTO attendance_events(session_id,student_id,kind,reason,at) VALUES(?,?,?,?,?)').run(session.id, sid, kind, reason, now);
    const addFocus = (session, f) => db.prepare('INSERT INTO focus_events(session_id,student_id,state,at) VALUES(?,?,?,?)').run(session.id, sid, f ? 'front' : 'background', now);

    if (req.body.leaving) {
      const s = A.openSession(enr.class_id);
      if (s && enr.in_meeting) addAtt(s, 'leave', 'left');
      db.prepare('UPDATE enrollments SET in_meeting=0, focused=0, last_seen_at=? WHERE id=?').run(now, enr.id);
      return { state: 'left' };
    }
    const s = A.ensureSession(enr.class_id, now);
    if (!enr.in_meeting) {
      const before = db.prepare('SELECT 1 FROM attendance_events WHERE session_id=? AND student_id=? LIMIT 1').get(s.id, sid);
      addAtt(s, before ? 'rejoin' : 'join', 'heartbeat');
      addFocus(s, focused);
    } else if (enr.focused !== focused) addFocus(s, focused);
    db.prepare('UPDATE enrollments SET in_meeting=1, focused=?, last_seen_at=? WHERE id=?').run(focused, now, enr.id);
    return { state: focused ? 'focused' : 'away', session_id: s.id };
  })();
  res.json({ ok: true, class: enr.class_name, ...out });
});

// ---- exams ----
const findExam = (userId, url) => {
  const k = examKey(url);
  return k && db.prepare(`SELECT x.id,x.title FROM exams x JOIN enrollments e ON e.class_id=x.class_id
    WHERE e.student_id=? AND x.url_key=? AND x.is_open=1 LIMIT 1`).get(userId, k.key);
};

router.post('/exam/match', (req, res) => {
  const x = findExam(req.user.id, req.body.url);
  if (!x) return res.json({ match: false });
  const c = db.consentOf(req.user.id, 'exam');
  res.json({ match: true, exam: x, consent: !!(c && c.granted) });
});

const TYPES = new Set(['tab_switch', 'tab_return', 'window_blur', 'copy', 'paste', 'cut']);

// {exam_id, events:[{type, at, duration_ms?}]}  (an empty list just starts/keeps the attempt)
router.post('/exam/events', needConsent('exam'), (req, res) => {
  const x = db.prepare(`SELECT x.id FROM exams x JOIN enrollments e ON e.class_id=x.class_id
    WHERE x.id=? AND e.student_id=? AND x.is_open=1`).get(req.body.exam_id, req.user.id);
  if (!x) return res.status(404).json({ error: 'no_exam', message: 'This exam is closed or not assigned to you.' });
  const now = Date.now();
  const events = Array.isArray(req.body.events) ? req.body.events.slice(0, 200) : [];

  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO exam_attempts(exam_id,student_id,started_at,last_event_at) VALUES(?,?,?,?)').run(x.id, req.user.id, now, now);
    const a = db.prepare('SELECT id FROM exam_attempts WHERE exam_id=? AND student_id=?').get(x.id, req.user.id);
    const ins = db.prepare('INSERT INTO exam_events(attempt_id,type,duration_ms,at) VALUES(?,?,?,?)');
    for (const e of events) {
      if (!TYPES.has(e.type)) continue;
      const at = Number.isFinite(e.at) && e.at > now - 36e5 && e.at < now + 6e4 ? Math.round(e.at) : now;
      const d = Number.isFinite(e.duration_ms) ? Math.min(Math.max(0, Math.round(e.duration_ms)), 6 * 36e5) : null;
      ins.run(a.id, e.type, d, at);
    }
    const all = db.prepare('SELECT type,duration_ms FROM exam_events WHERE attempt_id=?').all(a.id);
    const r = risk.assess(all);
    db.prepare("UPDATE exam_attempts SET last_event_at=?, status='in_progress', risk_score=?, risk_level=? WHERE id=?").run(now, r.score, r.level, a.id);
  })();
  res.json({ ok: true }); // the student is deliberately not shown the score
});

router.post('/exam/finish', (req, res) => {
  db.prepare("UPDATE exam_attempts SET status='ended', last_event_at=? WHERE exam_id=? AND student_id=?").run(Date.now(), req.body.exam_id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
