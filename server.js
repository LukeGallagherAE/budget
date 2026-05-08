require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, initDB } = require('./database');
const { parseCSV, analyzeRecurring } = require('./analyzeStatement');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('ERROR: JWT_SECRET environment variable is not set.'); process.exit(1); }

const isProd = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

function setTokenCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// ── Auth routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'An account with that email already exists' });

    const password_hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email.toLowerCase(), password_hash]
    );
    const user = result.rows[0];
    setTokenCookie(res, { id: user.id, email: user.email });
    res.json({ id: user.id, email: user.email });
  } catch (e) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    setTokenCookie(res, { id: user.id, email: user.email });
    res.json({ id: user.id, email: user.email });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeNextDueDate(frequency, intervalDays, startDate, lastPaidDate) {
  const FREQ_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };
  const days = frequency === 'custom' ? intervalDays : FREQ_DAYS[frequency];
  const base = lastPaidDate ? new Date(lastPaidDate) : new Date(startDate);
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  while (next < today) next.setDate(next.getDate() + days);
  return next.toISOString().split('T')[0];
}

function formatRow(r) {
  return {
    ...r,
    amount: parseFloat(r.amount),
    start_date: r.start_date?.toISOString?.()?.split('T')[0] ?? r.start_date,
    last_paid_date: r.last_paid_date?.toISOString?.()?.split('T')[0] ?? r.last_paid_date ?? null,
    next_due_date: computeNextDueDate(r.frequency, r.interval_days, r.start_date, r.last_paid_date),
  };
}

// ── Expense routes (all require auth) ────────────────────────────────────────

app.get('/api/expenses', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    const rows = result.rows.map(formatRow);
    rows.sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/expenses', requireAuth, async (req, res) => {
  const { name, amount, currency = 'USD', frequency, interval_days, start_date, category = 'Other', notes = '', color = '#6366f1' } = req.body;
  if (!name || !amount || !frequency || !start_date) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const result = await pool.query(
      'INSERT INTO expenses (user_id, name, amount, currency, frequency, interval_days, start_date, category, notes, color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [req.user.id, name, amount, currency, frequency, interval_days || null, start_date, category, notes, color]
    );
    res.json(formatRow(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/expenses/:id', requireAuth, async (req, res) => {
  const { name, amount, currency, frequency, interval_days, start_date, category, notes, color } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM expenses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Not found' });
    const e = existing.rows[0];
    const result = await pool.query(
      'UPDATE expenses SET name=$1, amount=$2, currency=$3, frequency=$4, interval_days=$5, start_date=$6, category=$7, notes=$8, color=$9 WHERE id=$10 AND user_id=$11 RETURNING *',
      [name ?? e.name, amount ?? e.amount, currency ?? e.currency, frequency ?? e.frequency, interval_days ?? e.interval_days, start_date ?? e.start_date, category ?? e.category, notes ?? e.notes, color ?? e.color, req.params.id, req.user.id]
    );
    res.json(formatRow(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/expenses/:id/pay', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await pool.query('UPDATE expenses SET last_paid_date=$1 WHERE id=$2 AND user_id=$3 RETURNING *', [today, req.params.id, req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(formatRow(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/expenses/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM expenses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/import', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const text = req.file.buffer.toString('utf-8');
    const transactions = parseCSV(text);
    if (transactions.length === 0) return res.status(400).json({ error: 'Could not parse any transactions. Check the CSV format.' });
    const recurring = analyzeRecurring(transactions);
    res.json({ transactions: transactions.length, recurring });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Static frontend (production) ─────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'client', 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
initDB()
  .then(() => app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`)))
  .catch(e => { console.error('Failed to initialise database:', e.message); process.exit(1); });
