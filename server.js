require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ai = require('./ai');
const { cleanResume, renderHtml, THEMES } = require('./resume');

// Database: Turso (hosted SQLite, free tier) online, or a local file on your laptop.
// TURSO_DATABASE_URL empty -> uses ./data/app.db on your computer automatically.
const { createClient } = require('@libsql/client');
const fs = require('fs');

const dbUrl = process.env.TURSO_DATABASE_URL || 'file:./data/app.db';
if (dbUrl.startsWith('file:./') || dbUrl.startsWith('file:data')) {
  fs.mkdirSync(path.dirname(path.resolve(dbUrl.slice(5))), { recursive: true });
}
const client = createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN || undefined });

const db = {
  async get(sql, args = []) {
    return (await client.execute({ sql, args })).rows[0];
  },
  async all(sql, args = []) {
    return (await client.execute({ sql, args })).rows;
  },
  async run(sql, args = []) {
    return Number((await client.execute({ sql, args })).lastInsertRowid || 0);
  },
};

// Creates the tables the first time (safe to run every time).
const dbReady = client.executeMultiple(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
dbReady.catch((e) => console.error('Database setup failed:', e.message));

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && SECRET === 'dev-secret-change-me') {
  throw new Error('Set JWT_SECRET before running in production');
}

const app = express();
app.set('trust proxy', 1); // correct client IPs behind Vercel, Render, etc.
app.use(
  helmet({
    contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } },
  }),
);
const origins = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: origins === '*' ? true : origins.split(',') }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // the front end
app.use('/api', async (req, res, next) => {
  await dbReady; // wait until the tables exist
  next();
});

/* ---------- helpers ---------- */
// Throws an error with an HTTP status when a condition is false (Express 5 catches it).
function check(ok, message, status = 400) {
  if (!ok) throw Object.assign(new Error(message), { status });
}
const isText = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });
const token = (u) => jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });

function auth(req, res, next) {
  const bearer = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.userId = jwt.verify(bearer, SECRET).id;
    next();
  } catch {
    res.status(401).json({ error: 'Please log in' });
  }
}

const toResume = (r) => ({
  id: r.id,
  title: r.title,
  data: JSON.parse(r.data),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function ownedResume(id, userId) {
  const row = await db.get('SELECT * FROM resumes WHERE id = ? AND user_id = ?', [id, userId]);
  check(row, 'Resume not found', 404);
  return row;
}

function saveNew(userId, title, data) {
  const sql = 'INSERT INTO resumes (user_id, title, data) VALUES (?, ?, ?)';
  return db.run(sql, [userId, title, JSON.stringify(data)]);
}

// AI routes accept either {resumeId} (saved resume) or {resume} (data from the form).
async function resumeFrom(body, userId) {
  if (body.resume) return cleanResume(body.resume);
  check(body.resumeId, 'Send resumeId or resume');
  return JSON.parse((await ownedResume(body.resumeId, userId)).data);
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

/* ---------- auth ---------- */
app.use(
  '/api/auth',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, message: { error: 'Too many attempts' } }),
);

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  check(isText(name, 1, 100), 'Enter your name');
  check(isText(email, 3, 200) && email.includes('@'), 'Enter a valid email');
  check(isText(password, 8, 200), 'Password must be at least 8 characters');
  const mail = email.toLowerCase().trim();
  check(
    !(await db.get('SELECT 1 FROM users WHERE email = ?', [mail])),
    'Email already registered',
    409,
  );
  const hash = await bcrypt.hash(password, 12);
  const sql = 'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)';
  const id = await db.run(sql, [mail, name.trim(), hash]);
  const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  res.status(201).json({ user: publicUser(user), token: token(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  check(isText(email, 1, 200) && isText(password, 1, 200), 'Enter email and password');
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  check(
    user && (await bcrypt.compare(password, user.password_hash)),
    'Wrong email or password',
    401,
  );
  res.json({ user: publicUser(user), token: token(user) });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.userId]);
  check(user, 'User not found', 404);
  res.json({ user: publicUser(user) });
});

/* ---------- resumes ---------- */
const resumes = express.Router();
resumes.use(auth);

resumes.get('/', async (req, res) => {
  const sql = 'SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC';
  const rows = await db.all(sql, [req.userId]);
  res.json({
    resumes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

resumes.post('/', async (req, res) => {
  check(isText(req.body.title, 1, 200), 'Title is required');
  const id = await saveNew(req.userId, req.body.title, cleanResume(req.body.data));
  res.status(201).json({ resume: toResume(await ownedResume(id, req.userId)) });
});

// Live preview of unsaved edits -> {html}
resumes.post('/preview', (req, res) => {
  const template = THEMES[req.body.template] ? req.body.template : 'modern';
  res.json({ html: renderHtml(cleanResume(req.body.data), template) });
});

resumes.get('/:id', async (req, res) =>
  res.json({ resume: toResume(await ownedResume(req.params.id, req.userId)) }),
);

resumes.put('/:id', async (req, res) => {
  const row = await ownedResume(req.params.id, req.userId);
  const title = req.body.title === undefined ? row.title : req.body.title;
  check(isText(title, 1, 200), 'Title is required');
  const data = req.body.data ? JSON.stringify(cleanResume(req.body.data)) : row.data;
  const sql = "UPDATE resumes SET title = ?, data = ?, updated_at = datetime('now') WHERE id = ?";
  await db.run(sql, [title, data, row.id]);
  res.json({ resume: toResume(await ownedResume(row.id, req.userId)) });
});

resumes.delete('/:id', async (req, res) => {
  const row = await ownedResume(req.params.id, req.userId);
  await db.run('DELETE FROM resumes WHERE id = ?', [row.id]);
  res.status(204).end();
});

resumes.post('/:id/duplicate', async (req, res) => {
  const row = await ownedResume(req.params.id, req.userId);
  const id = await saveNew(req.userId, `${row.title} (copy)`, JSON.parse(row.data));
  res.status(201).json({ resume: toResume(await ownedResume(id, req.userId)) });
});

// Printable page: open it, then Print -> Save as PDF.  ?template=modern|classic|minimal
resumes.get('/:id/export', async (req, res) => {
  const template = THEMES[req.query.template] ? req.query.template : 'modern';
  const row = await ownedResume(req.params.id, req.userId);
  res.type('html').send(renderHtml(JSON.parse(row.data), template));
});
app.use('/api/resumes', resumes);

/* ---------- AI (each user limited to 60 calls per hour: AI costs money) ---------- */
const aiRoutes = express.Router();
aiRoutes.use(auth);
aiRoutes.use(
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 60,
    keyGenerator: (req) => `user${req.userId}`,
    message: { error: 'AI limit reached, try again later' },
  }),
);

aiRoutes.post('/generate', async (req, res) => {
  const { profile, targetRole, save, title } = req.body;
  check(isText(profile, 20, 15000), 'Write at least a couple of sentences about yourself');
  const resume = await ai.generate(profile, targetRole);
  const resumeId = save
    ? await saveNew(req.userId, title || targetRole || 'AI resume', resume)
    : null;
  res.json({ resume, resumeId });
});

aiRoutes.post('/improve', async (req, res) => {
  const { section, content, instruction } = req.body;
  check(['summary', 'experience', 'projects', 'skills'].includes(section), 'Unknown section');
  check(content !== undefined, 'content is required');
  res.json(await ai.improve(section, content, instruction));
});

aiRoutes.post('/tailor', async (req, res) => {
  check(isText(req.body.jobDescription, 30, 15000), 'Paste the full job description');
  const resume = await resumeFrom(req.body, req.userId);
  const out = await ai.tailor(resume, req.body.jobDescription);
  const resumeId = req.body.save ? await saveNew(req.userId, 'Tailored resume', out.resume) : null;
  res.json({ ...out, resumeId });
});

aiRoutes.post('/ats-score', async (req, res) => {
  const resume = await resumeFrom(req.body, req.userId);
  res.json(await ai.atsScore(resume, req.body.jobDescription));
});

aiRoutes.post('/cover-letter', async (req, res) => {
  check(isText(req.body.jobDescription, 30, 15000), 'Paste the full job description');
  const tone = ['professional', 'friendly', 'confident'].includes(req.body.tone)
    ? req.body.tone
    : 'professional';
  const resume = await resumeFrom(req.body, req.userId);
  res.json(await ai.coverLetter(resume, req.body.jobDescription, tone));
});
app.use('/api/ai', aiRoutes);

/* ---------- errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  const status = err.type === 'entity.parse.failed' ? 400 : err.status || 500;
  if (status === 500) console.error(err);
  res
    .status(status)
    .json({ error: status === 500 ? 'Something went wrong on the server' : err.message });
});

/* ---------- start ---------- */
module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 4000;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Running: open http://localhost:${port} in your browser`);
    if (process.env.AI_MOCK === 'true') console.log('AI_MOCK is on: AI answers are fake samples');
    else if (!process.env.ANTHROPIC_API_KEY)
      console.log('Note: ANTHROPIC_API_KEY is missing, AI will not work');
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy. Change PORT in .env` : e);
    process.exit(1);
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
