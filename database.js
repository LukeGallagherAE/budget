const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'expenses.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    frequency TEXT NOT NULL,
    interval_days INTEGER,
    start_date TEXT NOT NULL,
    last_paid_date TEXT,
    category TEXT DEFAULT 'Other',
    notes TEXT DEFAULT '',
    color TEXT DEFAULT '#6366f1',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

module.exports = db;
