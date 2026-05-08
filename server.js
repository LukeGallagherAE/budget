const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const db = require('./database');
const { parseCSV, analyzeRecurring } = require('./analyzeStatement');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json());

function computeNextDueDate(frequency, intervalDays, startDate, lastPaidDate) {
  const FREQ_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };
  const days = frequency === 'custom' ? intervalDays : FREQ_DAYS[frequency];
  const base = lastPaidDate ? new Date(lastPaidDate) : new Date(startDate);
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  // If next is still in the past, keep advancing
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  while (next < today) {
    next.setDate(next.getDate() + days);
  }
  return next.toISOString().split('T')[0];
}

app.get('/api/expenses', (req, res) => {
  const rows = db.prepare('SELECT * FROM expenses ORDER BY created_at DESC').all();
  const enriched = rows.map(r => ({
    ...r,
    next_due_date: computeNextDueDate(r.frequency, r.interval_days, r.start_date, r.last_paid_date),
  }));
  // Sort by next_due_date ascending
  enriched.sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date));
  res.json(enriched);
});

app.post('/api/expenses', (req, res) => {
  const { name, amount, currency = 'USD', frequency, interval_days, start_date, category = 'Other', notes = '', color = '#6366f1' } = req.body;
  if (!name || !amount || !frequency || !start_date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const stmt = db.prepare(
    'INSERT INTO expenses (name, amount, currency, frequency, interval_days, start_date, category, notes, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(name, amount, currency, frequency, interval_days || null, start_date, category, notes, color);
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...row, next_due_date: computeNextDueDate(row.frequency, row.interval_days, row.start_date, row.last_paid_date) });
});

app.put('/api/expenses/:id', (req, res) => {
  const { name, amount, currency, frequency, interval_days, start_date, category, notes, color } = req.body;
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(
    'UPDATE expenses SET name=?, amount=?, currency=?, frequency=?, interval_days=?, start_date=?, category=?, notes=?, color=? WHERE id=?'
  ).run(
    name ?? existing.name,
    amount ?? existing.amount,
    currency ?? existing.currency,
    frequency ?? existing.frequency,
    interval_days ?? existing.interval_days,
    start_date ?? existing.start_date,
    category ?? existing.category,
    notes ?? existing.notes,
    color ?? existing.color,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  res.json({ ...row, next_due_date: computeNextDueDate(row.frequency, row.interval_days, row.start_date, row.last_paid_date) });
});

app.post('/api/expenses/:id/pay', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE expenses SET last_paid_date = ? WHERE id = ?').run(today, req.params.id);
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  res.json({ ...row, next_due_date: computeNextDueDate(row.frequency, row.interval_days, row.start_date, row.last_paid_date) });
});

app.delete('/api/expenses/:id', (req, res) => {
  const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.post('/api/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const text = req.file.buffer.toString('utf-8');
    const transactions = parseCSV(text);
    if (transactions.length === 0) return res.status(400).json({ error: 'Could not parse any transactions from the file. Check the CSV format.' });
    const recurring = analyzeRecurring(transactions);
    res.json({ transactions: transactions.length, recurring });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve built frontend in production
app.use(express.static(path.join(__dirname, 'client', 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
