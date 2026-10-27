// SQLite database: ten tables, created automatically on first start.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'classguard.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
-- 1. accounts (passwords are stored only as bcrypt hashes)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher','student')),
  created_at INTEGER NOT NULL
);
-- 2. a teacher's class, linked to one Google Meet code
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  meet_code TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
-- 3. which students are in which class + their live presence state
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  in_meeting INTEGER NOT NULL DEFAULT 0,
  focused INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  UNIQUE (class_id, student_id)
);
-- 4. append-only log of consent decisions (latest row per scope wins)
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('attendance','exam')),
  version INTEGER NOT NULL,
  granted INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
-- 5. one live meeting of a class
CREATE TABLE IF NOT EXISTS class_sessions (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
-- 6. join / leave / rejoin history
CREATE TABLE IF NOT EXISTS attendance_events (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('join','leave','rejoin')),
  reason TEXT,
  at INTEGER NOT NULL
);
-- 7. class tab in front / in background (changes only)
CREATE TABLE IF NOT EXISTS focus_events (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('front','background')),
  at INTEGER NOT NULL
);
-- 8. an exam (a Google Forms or Microsoft Forms link)
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('google','microsoft')),
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
-- 9. one student's attempt at one exam, with risk score + teacher review
CREATE TABLE IF NOT EXISTS exam_attempts (
  id INTEGER PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  last_event_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','ended')),
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'low',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','cleared','flagged')),
  review_note TEXT,
  UNIQUE (exam_id, student_id)
);
-- 10. tab switches and copy / paste / cut counts (never their content)
CREATE TABLE IF NOT EXISTS exam_events (
  id INTEGER PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('tab_switch','tab_return','window_blur','copy','paste','cut')),
  duration_ms INTEGER,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS i_att_session ON attendance_events(session_id, student_id, at);
CREATE INDEX IF NOT EXISTS i_focus_session ON focus_events(session_id, student_id, at);
CREATE INDEX IF NOT EXISTS i_exam_events ON exam_events(attempt_id);
CREATE INDEX IF NOT EXISTS i_consents ON consents(user_id, scope, id);
`);

// Latest consent decision for a user + scope (undefined if they never answered).
db.consentOf = (userId, scope) =>
  db.prepare('SELECT granted, version, created_at FROM consents WHERE user_id=? AND scope=? ORDER BY id DESC LIMIT 1').get(userId, scope);

// Map of userId -> granted(bool) for everyone, for one scope.
db.consentMap = (scope) => {
  const rows = db.prepare(`SELECT user_id, granted FROM consents c WHERE scope=? AND id=(SELECT MAX(id) FROM consents WHERE user_id=c.user_id AND scope=c.scope)`).all(scope);
  return new Map(rows.map(r => [r.user_id, !!r.granted]));
};

module.exports = db;
