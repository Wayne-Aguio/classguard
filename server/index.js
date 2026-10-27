const express = require('express');
const path = require('path');
const db = require('./db');
const { sweep, purge } = require('./attendance');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// The extension calls the API from a chrome-extension:// origin. Auth uses bearer tokens
// (no cookies), so a permissive CORS policy is safe here. Tighten it for production.
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));
app.use('/api', require('./routes/auth'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/exams', require('./routes/exams'));
app.use('/api/ext', require('./routes/ext'));
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'Unknown API endpoint.' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong on the server.' });
});

setInterval(() => { try { sweep(); } catch (e) { console.error('sweep failed', e); } }, 10000);
setInterval(() => { try { purge(); } catch (e) { console.error('purge failed', e); } }, 6 * 36e5);
purge();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  console.log(`\n  ClassGuard is running at http://localhost:${port}`);
  if (!users) console.log('  No accounts yet. Register one in the browser, or run:  npm run seed\n');
});
