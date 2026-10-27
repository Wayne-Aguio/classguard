const router = require('express').Router();
const db = require('../db');
const { auth } = require('../auth');
const A = require('../attendance');
const { meetCode, joinCode, sendCsv, iso } = require('../util');

router.use(auth('teacher'));

// Loads a class the signed-in teacher owns, or sends 404.
const own = (req, res) => {
  const c = db.prepare('SELECT * FROM classes WHERE id=? AND teacher_id=?').get(req.params.id, req.user.id);
  if (!c) res.status(404).json({ error: 'not_found', message: 'Class not found.' });
  return c;
};

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.class_id=c.id) AS students,
      (SELECT COUNT(*) FROM enrollments e WHERE e.class_id=c.id AND e.in_meeting=1) AS in_meeting,
      (SELECT COUNT(*) FROM class_sessions s WHERE s.class_id=c.id) AS sessions,
      (SELECT COUNT(*) FROM exams x WHERE x.class_id=c.id) AS exams
    FROM classes c WHERE c.teacher_id=? ORDER BY c.created_at DESC`).all(req.user.id));
});

router.post('/', (req, res) => {
  const { name, meet } = req.body || {};
  const code = meetCode(meet);
  if (!name || !code) return res.status(400).json({ error: 'invalid_input', message: 'Enter a class name and a Google Meet link or code (like abc-defg-hij).' });
  let jc; do { jc = joinCode(); } while (db.prepare('SELECT 1 FROM classes WHERE join_code=?').get(jc));
  const id = db.prepare('INSERT INTO classes(teacher_id,name,meet_code,join_code,created_at) VALUES(?,?,?,?,?)')
    .run(req.user.id, name.trim(), code, jc, Date.now()).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM classes WHERE id=?').get(id));
});

router.patch('/:id', (req, res) => {
  const c = own(req, res); if (!c) return;
  const name = (req.body.name || c.name).trim();
  const code = req.body.meet ? meetCode(req.body.meet) : c.meet_code;
  if (!code) return res.status(400).json({ error: 'invalid_input', message: 'That is not a valid Google Meet link or code.' });
  db.prepare('UPDATE classes SET name=?, meet_code=? WHERE id=?').run(name, code, c.id);
  res.json(db.prepare('SELECT * FROM classes WHERE id=?').get(c.id));
});

router.delete('/:id', (req, res) => {
  const c = own(req, res); if (!c) return;
  db.prepare('DELETE FROM classes WHERE id=?').run(c.id);
  res.json({ ok: true });
});

router.delete('/:id/students/:sid', (req, res) => {
  const c = own(req, res); if (!c) return;
  db.prepare('DELETE FROM enrollments WHERE class_id=? AND student_id=?').run(c.id, req.params.sid);
  res.json({ ok: true });
});

// ---- roster for one session (live or past) ----
function roster(c, session) {
  const live = !!session && !session.ended_at;
  const students = db.prepare(`SELECT u.id,u.name,u.email,e.in_meeting,e.focused,e.last_seen_at
    FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.class_id=? ORDER BY u.name`).all(c.id);
  const consent = db.consentMap('attendance');
  const rows = A.buildReport(session, students).map(r => {
    let status;
    if (live && r.in_meeting) status = r.focused ? 'focused' : 'away';
    else if (r.joins > 0) status = live ? 'left' : 'attended';
    else status = consent.get(r.id) ? 'absent' : 'no_consent';
    const { in_meeting, focused, ...rest } = r;
    return { ...rest, status };
  });
  const n = (s) => rows.filter(r => r.status === s).length;
  const joined = rows.filter(r => r.joins > 0);
  const summary = {
    enrolled: rows.length,
    in_meeting: n('focused') + n('away'),
    focused: n('focused'), away: n('away'), left: n('left'),
    attended: joined.length,
    absent: n('absent'), no_consent: n('no_consent'),
    avg_focus_pct: joined.length ? Math.round(joined.reduce((s, r) => s + r.focus_pct, 0) / joined.length) : 0
  };
  return {
    class: { id: c.id, name: c.name, meet_code: c.meet_code, join_code: c.join_code },
    session, live, students: rows, summary
  };
}

router.get('/:id/live', (req, res) => {
  const c = own(req, res); if (!c) return;
  const s = A.openSession(c.id) || db.prepare('SELECT * FROM class_sessions WHERE class_id=? ORDER BY id DESC LIMIT 1').get(c.id);
  res.json(roster(c, s));
});

router.get('/:id/sessions', (req, res) => {
  const c = own(req, res); if (!c) return;
  const students = db.prepare('SELECT student_id AS id FROM enrollments WHERE class_id=?').all(c.id);
  const list = db.prepare('SELECT * FROM class_sessions WHERE class_id=? ORDER BY id DESC LIMIT 40').all(c.id).map(s => {
    const joined = A.buildReport(s, students).filter(r => r.joins > 0);
    return {
      ...s,
      attendees: joined.length,
      enrolled: students.length,
      avg_focus_pct: joined.length ? Math.round(joined.reduce((t, r) => t + r.focus_pct, 0) / joined.length) : 0
    };
  });
  res.json(list);
});

router.get('/:id/sessions/:sid', (req, res) => {
  const c = own(req, res); if (!c) return;
  const s = db.prepare('SELECT * FROM class_sessions WHERE id=? AND class_id=?').get(req.params.sid, c.id);
  if (!s) return res.status(404).json({ error: 'not_found', message: 'Session not found.' });
  res.json(roster(c, s));
});

router.post('/:id/sessions/end', (req, res) => {
  const c = own(req, res); if (!c) return;
  const s = A.openSession(c.id);
  if (!s) return res.status(409).json({ error: 'no_open_session', message: 'There is no live session to end.' });
  A.endSession(s);
  res.json({ ok: true });
});

// ---- CSV: one session (?session=ID) or every session of the class ----
router.get('/:id/report.csv', (req, res) => {
  const c = own(req, res); if (!c) return;
  const sessions = req.query.session
    ? db.prepare('SELECT * FROM class_sessions WHERE id=? AND class_id=?').all(req.query.session, c.id)
    : db.prepare('SELECT * FROM class_sessions WHERE class_id=? ORDER BY id').all(c.id);
  const students = db.prepare('SELECT u.id,u.name,u.email FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.class_id=? ORDER BY u.name').all(c.id);
  const mins = (ms) => Math.round(ms / 600) / 100;
  const rows = [['Class', 'Session start', 'Session end', 'Student', 'Email', 'Attended', 'First join', 'Last leave', 'Joins', 'Rejoins', 'Minutes present', 'Minutes focused', 'Focus %']];
  for (const s of sessions) for (const r of A.buildReport(s, students))
    rows.push([c.name, iso(s.started_at), iso(s.ended_at), r.name, r.email, r.joins ? 'yes' : 'no', iso(r.first_join), iso(r.last_leave), r.joins, r.rejoins, mins(r.present_ms), mins(r.focus_ms), r.focus_pct]);
  sendCsv(res, `attendance-${c.meet_code}.csv`, rows);
});

module.exports = router;
