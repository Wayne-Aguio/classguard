// Session handling and attendance maths (presence time, focus time, rejoins).
const db = require('./db');

const TIMEOUT_MS = 45 * 1000;        // no heartbeat for this long = student left
const SESSION_IDLE_MS = 10 * 60000;  // empty for this long = session closes
const ATTEMPT_IDLE_MS = 20 * 60000;  // no exam events for this long = attempt ended

const openSession = (classId) =>
  db.prepare('SELECT * FROM class_sessions WHERE class_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get(classId);

function ensureSession(classId, now) {
  return openSession(classId) ||
    db.prepare('SELECT * FROM class_sessions WHERE id=?').get(
      db.prepare('INSERT INTO class_sessions(class_id, started_at) VALUES(?,?)').run(classId, now).lastInsertRowid);
}

function endSession(session, now = Date.now()) {
  const inside = db.prepare('SELECT student_id FROM enrollments WHERE class_id=? AND in_meeting=1').all(session.class_id);
  const ins = db.prepare("INSERT INTO attendance_events(session_id,student_id,kind,reason,at) VALUES(?,?,'leave','session_ended',?)");
  for (const r of inside) ins.run(session.id, r.student_id, now);
  db.prepare('UPDATE enrollments SET in_meeting=0, focused=0 WHERE class_id=?').run(session.class_id);
  db.prepare('UPDATE class_sessions SET ended_at=? WHERE id=?').run(now, session.id);
}

const group = (rows) => rows.reduce((m, r) => ((m[r.student_id] ||= []).push(r), m), {});

// Walks a student's events in time order and totals presence/focus time.
function computeOne(att, foc, end) {
  const items = [
    ...att.map(e => ({ t: e.at, a: true, v: e.kind })),
    ...foc.map(e => ({ t: e.at, a: false, v: e.state }))
  ].sort((x, y) => x.t - y.t || (x.a ? -1 : 1));
  let inM = false, f = false, last = null, present = 0, focused = 0;
  const segments = [];
  const st = () => (!inM ? 'out' : f ? 'focused' : 'away');
  const push = (from, to, state) => {
    if (to <= from) return;
    const p = segments[segments.length - 1];
    if (p && p.state === state && p.to === from) p.to = to; else segments.push({ from, to, state });
  };
  const span = (to) => {
    const dt = Math.max(0, to - last);
    if (inM) { present += dt; if (f) focused += dt; }
    push(last, to, st());
  };
  for (const it of items) {
    if (last !== null) span(it.t);
    last = it.t;
    if (it.a) { if (it.v === 'leave') { inM = false; f = false; } else inM = true; }
    else f = it.v === 'front';
  }
  if (last !== null) span(end);
  return {
    present_ms: present,
    focus_ms: focused,
    focus_pct: present ? Math.round((focused / present) * 100) : 0,
    joins: att.filter(e => e.kind !== 'leave').length,
    rejoins: att.filter(e => e.kind === 'rejoin').length,
    first_join: att.find(e => e.kind !== 'leave')?.at || null,
    last_leave: [...att].reverse().find(e => e.kind === 'leave')?.at || null,
    history: att.map(e => ({ kind: e.kind, reason: e.reason, at: e.at })),
    segments
  };
}

function buildReport(session, students, now = Date.now()) {
  const end = session ? (session.ended_at || now) : now;
  const q = (t) => session ? db.prepare(`SELECT * FROM ${t} WHERE session_id=? ORDER BY at,id`).all(session.id) : [];
  const A = group(q('attendance_events')), F = group(q('focus_events'));
  return students.map(s => ({ ...s, ...computeOne(A[s.id] || [], F[s.id] || [], end) }));
}

// Runs every few seconds: marks silent students as left, closes idle sessions.
function sweep(now = Date.now()) {
  db.transaction(() => {
    const stale = db.prepare('SELECT class_id, student_id, last_seen_at FROM enrollments WHERE in_meeting=1 AND last_seen_at < ?').all(now - TIMEOUT_MS);
    for (const e of stale) {
      const s = openSession(e.class_id);
      if (s) db.prepare("INSERT INTO attendance_events(session_id,student_id,kind,reason,at) VALUES(?,?,'leave','timeout',?)").run(s.id, e.student_id, e.last_seen_at);
      db.prepare('UPDATE enrollments SET in_meeting=0, focused=0 WHERE class_id=? AND student_id=?').run(e.class_id, e.student_id);
    }
    for (const s of db.prepare('SELECT * FROM class_sessions WHERE ended_at IS NULL').all()) {
      const anyone = db.prepare('SELECT 1 FROM enrollments WHERE class_id=? AND in_meeting=1').get(s.class_id);
      const lastAt = db.prepare('SELECT MAX(at) m FROM attendance_events WHERE session_id=?').get(s.id).m || s.started_at;
      if (!anyone && lastAt < now - SESSION_IDLE_MS) db.prepare('UPDATE class_sessions SET ended_at=? WHERE id=?').run(lastAt, s.id);
    }
    db.prepare("UPDATE exam_attempts SET status='ended' WHERE status='in_progress' AND last_event_at < ?").run(now - ATTEMPT_IDLE_MS);
  })();
}

// Data minimisation: delete old records.
function purge(days = Number(process.env.RETENTION_DAYS) || 180) {
  const cutoff = Date.now() - days * 864e5;
  db.prepare('DELETE FROM class_sessions WHERE started_at < ?').run(cutoff);
  db.prepare('DELETE FROM exam_attempts WHERE started_at < ?').run(cutoff);
}

module.exports = { openSession, ensureSession, endSession, buildReport, sweep, purge };
