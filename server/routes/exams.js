const router = require('express').Router();
const db = require('../db');
const { auth } = require('../auth');
const risk = require('../risk');
const { examKey, sendCsv, iso } = require('../util');

router.use(auth('teacher'));

const ownExam = (req, res) => {
  const x = db.prepare(`SELECT x.*, c.name AS class_name FROM exams x JOIN classes c ON c.id=x.class_id
    WHERE x.id=? AND c.teacher_id=?`).get(req.params.id, req.user.id);
  if (!x) res.status(404).json({ error: 'not_found', message: 'Exam not found.' });
  return x;
};

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT x.*, c.name AS class_name,
      (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=x.id) AS attempts,
      (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=x.id AND a.risk_level='high') AS high_risk,
      (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=x.id AND a.review_status='pending' AND a.risk_level!='low') AS to_review
    FROM exams x JOIN classes c ON c.id=x.class_id WHERE c.teacher_id=? ORDER BY x.created_at DESC`).all(req.user.id));
});

router.post('/', (req, res) => {
  const { class_id, title, url } = req.body || {};
  const c = db.prepare('SELECT id FROM classes WHERE id=? AND teacher_id=?').get(class_id, req.user.id);
  const k = examKey(url);
  if (!c || !title) return res.status(400).json({ error: 'invalid_input', message: 'Choose a class and enter an exam title.' });
  if (!k) return res.status(400).json({
    error: 'unsupported_url',
    message: 'Paste the full Google Forms link (docs.google.com/forms/…) or the Microsoft Forms link that contains "?id=". Short links like forms.gle are not supported.'
  });
  const id = db.prepare('INSERT INTO exams(class_id,title,url,url_key,platform,created_at) VALUES(?,?,?,?,?,?)')
    .run(c.id, title.trim(), url.trim(), k.key, k.platform, Date.now()).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM exams WHERE id=?').get(id));
});

router.patch('/:id', (req, res) => {
  const x = ownExam(req, res); if (!x) return;
  db.prepare('UPDATE exams SET title=?, is_open=? WHERE id=?').run(
    (req.body.title || x.title).trim(), typeof req.body.is_open === 'boolean' ? +req.body.is_open : x.is_open, x.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const x = ownExam(req, res); if (!x) return;
  db.prepare('DELETE FROM exams WHERE id=?').run(x.id);
  res.json({ ok: true });
});

// ---- attempts ----
function attemptRows(x) {
  const rows = db.prepare(`SELECT u.id AS student_id,u.name,u.email,a.id AS attempt_id,a.status,a.started_at,a.last_event_at,
      a.risk_score,a.risk_level,a.review_status,a.review_note
    FROM enrollments e JOIN users u ON u.id=e.student_id
    LEFT JOIN exam_attempts a ON a.student_id=u.id AND a.exam_id=?
    WHERE e.class_id=? ORDER BY COALESCE(a.risk_score,-1) DESC, u.name`).all(x.id, x.class_id);
  const agg = db.prepare(`SELECT attempt_id,type,COUNT(*) AS n,COALESCE(SUM(duration_ms),0) AS ms FROM exam_events
    WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE exam_id=?) GROUP BY attempt_id,type`).all(x.id);
  const consent = db.consentMap('exam');
  return rows.map(r => {
    const counts = { tab_switch: 0, window_blur: 0, copy: 0, paste: 0, cut: 0 };
    let away = 0;
    for (const a of agg) if (a.attempt_id === r.attempt_id) { if (a.type in counts) counts[a.type] = a.n; if (a.type === 'tab_return') away = a.ms; }
    const state = r.attempt_id ? r.status : (consent.get(r.student_id) ? 'not_started' : 'no_consent');
    return { ...r, state, counts, away_ms: away };
  });
}

router.get('/:id/attempts', (req, res) => {
  const x = ownExam(req, res); if (!x) return;
  const rows = attemptRows(x);
  const started = rows.filter(r => r.attempt_id);
  res.json({
    exam: x, students: rows,
    summary: {
      enrolled: rows.length, started: started.length,
      in_progress: rows.filter(r => r.state === 'in_progress').length,
      high: started.filter(r => r.risk_level === 'high').length,
      to_review: started.filter(r => r.review_status === 'pending' && r.risk_level !== 'low').length
    },
    weights: risk.WEIGHTS, levels: risk.LEVELS
  });
});

router.get('/:id/attempts/:aid', (req, res) => {
  const x = ownExam(req, res); if (!x) return;
  const a = db.prepare('SELECT a.*, u.name, u.email FROM exam_attempts a JOIN users u ON u.id=a.student_id WHERE a.id=? AND a.exam_id=?').get(req.params.aid, x.id);
  if (!a) return res.status(404).json({ error: 'not_found' });
  const events = db.prepare('SELECT type,duration_ms,at FROM exam_events WHERE attempt_id=? ORDER BY at,id').all(a.id);
  res.json({ attempt: a, events, assessment: risk.assess(events) });
});

router.patch('/:id/attempts/:aid', (req, res) => {
  const x = ownExam(req, res); if (!x) return;
  const { review_status, review_note } = req.body || {};
  if (!['pending', 'cleared', 'flagged'].includes(review_status)) return res.status(400).json({ error: 'invalid_input' });
  const r = db.prepare('UPDATE exam_attempts SET review_status=?, review_note=? WHERE id=? AND exam_id=?')
    .run(review_status, String(review_note || '').slice(0, 1000), req.params.aid, x.id);
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

router.get('/:id/report.csv', (req, res) => {
  const x = ownExam(req, res); if (!x) return;
  const rows = [['Exam', 'Class', 'Student', 'Email', 'Status', 'Started', 'Risk score', 'Risk level', 'Tab switches', 'Seconds away', 'Window blurs', 'Copy', 'Paste', 'Cut', 'Review', 'Review note']];
  for (const r of attemptRows(x))
    rows.push([x.title, x.class_name, r.name, r.email, r.state, iso(r.started_at), r.attempt_id ? r.risk_score : '', r.attempt_id ? r.risk_level : '',
      r.counts.tab_switch, Math.round(r.away_ms / 1000), r.counts.window_blur, r.counts.copy, r.counts.paste, r.counts.cut, r.review_status || '', r.review_note || '']);
  sendCsv(res, `exam-${x.id}-report.csv`, rows);
});

module.exports = router;
