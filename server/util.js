const crypto = require('crypto');

const MEET_RE = /([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
const meetCode = (s) => { const m = String(s || '').match(MEET_RE); return m ? m[1].toLowerCase() : null; };

// Turns a Google/Microsoft Forms URL into a stable key so the extension can recognise the exam.
function examKey(raw) {
  try {
    const u = new URL(raw);
    if (u.hostname === 'docs.google.com') {
      const m = u.pathname.match(/\/forms\/d\/(?:e\/)?([^/]+)/);
      return m ? { key: 'gf:' + m[1], platform: 'google' } : null;
    }
    if (/^forms\.(office|microsoft)\.com$|^forms\.cloud\.microsoft$/.test(u.hostname)) {
      const id = u.searchParams.get('id');
      return id ? { key: 'ms:' + id, platform: 'microsoft' } : null;
    }
  } catch { /* fall through */ }
  return null;
}

const joinCode = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6), b => a[b % a.length]).join('');
};

// CSV with protection against spreadsheet formula injection.
function csv(rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}
const sendCsv = (res, name, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(csv(rows));
};
const iso = (t) => (t ? new Date(t).toISOString() : '');

module.exports = { meetCode, examKey, joinCode, csv, sendCsv, iso };
