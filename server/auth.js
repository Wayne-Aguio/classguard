// Password hashing (bcrypt), signed login tokens (HMAC) and role middleware.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./db');

function loadSecret() {
  if (process.env.SECRET) return process.env.SECRET;
  const f = path.join(__dirname, '..', 'data', '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8');
}
const SECRET = loadSecret();
const mac = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');

const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
const checkPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

function sign(user) {
  const p = Buffer.from(JSON.stringify({ uid: user.id, exp: Date.now() + 7 * 864e5 })).toString('base64url');
  return `${p}.${mac(p)}`;
}
function verify(token) {
  const [p, s] = String(token || '').split('.');
  if (!p || !s) return null;
  const e = mac(p);
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.exp > Date.now() ? d : null; } catch { return null; }
}

// auth() = any signed-in user; auth('teacher') = teachers only; etc.
const auth = (...roles) => (req, res, next) => {
  const d = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
  const user = d && db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(d.uid);
  if (!user) return res.status(401).json({ error: 'unauthorized', message: 'Please sign in again.' });
  if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'forbidden' });
  req.user = user;
  next();
};

module.exports = { hashPassword, checkPassword, sign, auth };
