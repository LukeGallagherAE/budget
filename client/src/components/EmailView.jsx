import { useState, useEffect } from 'react';
import {
  Mail, ScanLine, CheckCircle, XCircle, AlertCircle, Plus, RefreshCw,
  Clock, CalendarCheck, TrendingUp, ExternalLink, Info,
} from 'lucide-react';
import { getEmailStatus, scanEmails, createExpense, updateExpense } from '../api.js';

const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#06b6d4'];
function colorFor(i) { return COLORS[i % COLORS.length]; }

const FREQ_LABELS = {
  daily:'Daily', weekly:'Weekly', biweekly:'Every 2 weeks',
  monthly:'Monthly', quarterly:'Quarterly', yearly:'Yearly', custom:'Custom',
};

// Same dedup logic as ImportView — match invoice against already-tracked expenses
function matchAgainstExisting(inv, expenses) {
  const invName = inv.merchant.toLowerCase().trim();
  const match = expenses.find(e => {
    const eName = e.name.toLowerCase().trim();
    return eName === invName || eName.includes(invName) || invName.includes(eName);
  });
  if (!match) return { status: 'new', existing: null };
  const diff = Math.abs(match.amount - inv.amount);
  if (diff <= 0.50) return { status: 'exists', existing: match };
  return { status: 'price_change', existing: match };
}

// ── Setup instructions shown when Gmail isn't configured ─────────────────────
function SetupCard() {
  return (
    <div className="flex flex-col gap-4 max-w-xl mx-auto">
      <div className="bg-gray-800/60 rounded-2xl p-6 ring-1 ring-gray-700 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Mail size={22} className="text-indigo-400 flex-shrink-0" />
          <h3 className="font-semibold text-white">Connect your Gmail</h3>
        </div>
        <p className="text-sm text-gray-400">
          ExpenseRadar scans your last 6 months of invoice emails — receipts,
          payment confirmations, renewal notices — and checks them against what
          you're already tracking.
        </p>
        <ol className="flex flex-col gap-3 text-sm">
          {[
            <>Go to <span className="text-indigo-400">myaccount.google.com → Security</span> and make sure 2-Step Verification is on.</>,
            <>Search for <span className="text-indigo-400">"App Passwords"</span>, create one (Mail), and copy the 16-character password.</>,
            <>In Railway, add two environment variables:<br/>
              <code className="block mt-1 bg-gray-900 rounded px-3 py-2 text-xs text-green-400 font-mono">
                GMAIL_USER=you@gmail.com<br/>
                GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
              </code>
            </>,
            <>Also add <code className="text-green-400 font-mono text-xs">ANTHROPIC_API_KEY</code> from <span className="text-indigo-400">console.anthropic.com</span> if not already set.</>,
            <>Redeploy, then come back here and click <strong className="text-white">Scan emails</strong>.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</span>
              <span className="text-gray-300">{step}</span>
            </li>
          ))}
        </ol>
        <a
          href="https://myaccount.google.com/apppasswords"
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 w-fit"
        >
          Open Google App Passwords <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, hasPaid }) {
  if (status === 'due') return (
    <span className="flex items-center gap-1 text-xs font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
      <Clock size={10} /> Due soon
    </span>
  );
  if (status === 'upcoming') return (
    <span className="flex items-center gap-1 text-xs font-medium text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full">
      <CalendarCheck size={10} /> Upcoming
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
      <CheckCircle size={10} /> Paid
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EmailView({ expenses = [], onImported }) {
  const [configured, setConfigured] = useState(null); // null = loading
  const [scanning,   setScanning]   = useState(false);
  const [results,    setResults]    = useState(null);  // enriched invoice list
  const [selected,   setSelected]   = useState({});
  const [saving,     setSaving]     = useState(false);
  const [done,       setDone]       = useState(null);
  const [error,      setError]      = useState(null);
  const [emailCount, setEmailCount] = useState(null);

  useEffect(() => {
    getEmailStatus()
      .then(s => setConfigured(s.gmail && s.anthropic))
      .catch(() => setConfigured(false));
  }, []);

  async function handleScan() {
    setError(null);
    setResults(null);
    setDone(null);
    setSelected({});
    setScanning(true);
    try {
      const data = await scanEmails();
      setEmailCount(data.emails_scanned);
      const enriched = data.invoices.map(inv => ({
        ...inv,
        invoice_status: inv.status,          // 'paid' | 'due' | 'upcoming' — from email
        ...matchAgainstExisting(inv, expenses), // status → 'new' | 'exists' | 'price_change'
      }));
      setResults(enriched);
      // Default: check new + price_change; uncheck already-tracked + already-paid
      const sel = {};
      enriched.forEach((r, i) => {
        sel[i] = r.status !== 'exists' && r.invoice_status !== 'paid';
      });
      setSelected(sel);
    } catch (e) {
      if (e.message === 'GMAIL_NOT_CONFIGURED') setConfigured(false);
      else setError(e.message);
    } finally {
      setScanning(false);
    }
  }

  async function importSelected() {
    if (!results) return;
    setSaving(true);
    let added = 0, updated = 0;
    for (let i = 0; i < results.length; i++) {
      if (!selected[i]) continue;
      const inv = results[i];
      if (inv.status === 'price_change' && inv.existing) {
        await updateExpense(inv.existing.id, { amount: inv.amount });
        updated++;
      } else if (inv.status === 'new') {
        await createExpense({
          name:         inv.merchant,
          amount:       inv.amount,
          currency:     inv.currency || 'AUD',
          frequency:    inv.frequency || 'monthly',
          interval_days: null,
          start_date:   inv.due_date || inv.paid_date || inv.email_date || new Date().toISOString().split('T')[0],
          category:     inv.category || 'Other',
          notes:        `Imported from email. Subject: "${inv.subject}"`,
          color:        colorFor(i),
        });
        added++;
      }
    }
    setDone({ added, updated });
    setSaving(false);
    onImported();
  }

  const newCount    = results?.filter((r,i) => selected[i] && r.status === 'new').length ?? 0;
  const updateCount = results?.filter((r,i) => selected[i] && r.status === 'price_change').length ?? 0;

  // ── Loading state for config check
  if (configured === null) {
    return <div className="text-center text-gray-500 py-16">Checking configuration…</div>;
  }

  // ── Not configured
  if (!configured) return <SetupCard />;

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Invoice Emails</h2>
        <p className="text-sm text-gray-400">
          Scan your last 6 months of Gmail for invoices, receipts, and payment reminders.
          Already-tracked subscriptions are highlighted so you don't add duplicates.
        </p>
      </div>

      {/* Scan button */}
      {!results && !scanning && (
        <button
          onClick={handleScan}
          className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          <ScanLine size={16} /> Scan Gmail
        </button>
      )}

      {/* Scanning */}
      {scanning && (
        <div className="flex flex-col items-center gap-3 py-10 text-gray-400">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-indigo-400">Scanning your emails…</p>
          <p className="text-xs text-gray-500">Reading subjects, then asking Claude to extract invoice data. Usually takes 15–30 seconds.</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-500/10 rounded-xl p-4 ring-1 ring-red-500/30">
          <XCircle size={16} /> {error}
        </div>
      )}

      {results && (
        <>
          {/* Summary bar */}
          <div className="flex items-center justify-between text-xs text-gray-500 flex-wrap gap-2">
            <span>
              Found <span className="text-white font-medium">{results.length}</span> invoice{results.length !== 1 ? 's' : ''} across{' '}
              <span className="text-white font-medium">{emailCount}</span> emails
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { const s = {}; results.forEach((_,i) => { s[i] = results[i].status !== 'exists'; }); setSelected(s); }}
                className="text-indigo-400 hover:text-indigo-300"
              >Select all</button>
              <span className="text-gray-600">·</span>
              <button onClick={() => setSelected({})} className="text-gray-400 hover:text-gray-300">Deselect all</button>
              <span className="text-gray-600">·</span>
              <button
                onClick={() => { setResults(null); setDone(null); setSelected({}); }}
                className="text-gray-400 hover:text-gray-300 flex items-center gap-1"
              ><RefreshCw size={10} /> Rescan</button>
            </div>
          </div>

          {results.length === 0 && (
            <div className="flex items-center gap-2 text-yellow-400 bg-yellow-500/10 rounded-xl p-4 ring-1 ring-yellow-500/30">
              <AlertCircle size={16} />
              No invoice emails found. Try checking that your Gmail inbox has receipts, payment confirmations, or renewal notices.
            </div>
          )}

          {/* Invoice cards */}
          <div className="flex flex-col gap-3">
            {results.map((inv, i) => {
              const isNew      = inv.status === 'new';
              const isExists   = inv.status === 'exists';
              const isPriceChg = inv.status === 'price_change';
              const isPaid     = inv.invoice_status === 'paid';

              return (
                <label
                  key={i}
                  className={`flex items-start gap-4 p-4 rounded-xl ring-1 cursor-pointer transition-colors ${
                    isExists
                      ? 'bg-gray-900/40 ring-gray-800 opacity-50'
                      : isPriceChg
                      ? selected[i] ? 'bg-amber-950/30 ring-amber-500/40' : 'bg-gray-900 ring-gray-800 opacity-60'
                      : selected[i] ? 'bg-gray-800 ring-indigo-500/40' : 'bg-gray-900 ring-gray-800 opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!!selected[i]}
                    disabled={isExists}
                    onChange={e => setSelected(s => ({ ...s, [i]: e.target.checked }))}
                    className="mt-1 accent-indigo-500"
                  />
                  <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: colorFor(i) }} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-white truncate">{inv.merchant}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isPriceChg && inv.existing && (
                          <span className="text-xs text-gray-500 line-through">${inv.existing.amount.toFixed(2)}</span>
                        )}
                        <p className={`font-bold ${isPriceChg ? 'text-amber-400' : 'text-white'}`}>
                          ${inv.amount.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {/* Invoice status (paid/due/upcoming) */}
                      <StatusBadge status={inv.invoice_status || inv.status_from_email} hasPaid={inv.has_paid_version} />

                      {/* Billing frequency if detected */}
                      {inv.frequency && (
                        <span className="text-xs text-indigo-400 font-medium">{FREQ_LABELS[inv.frequency] || inv.frequency}</span>
                      )}

                      {/* Confidence */}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        inv.confidence >= 80 ? 'bg-green-500/20 text-green-400'
                        : inv.confidence >= 60 ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-gray-700 text-gray-400'
                      }`}>
                        {inv.confidence}%
                      </span>

                      {/* Dedup badge */}
                      {isExists && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                          <CheckCircle size={10} /> Already tracking
                        </span>
                      )}
                      {isPriceChg && (
                        <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                          <TrendingUp size={10} />
                          Price {inv.amount > inv.existing?.amount ? 'up' : 'down'} ${Math.abs(inv.amount - (inv.existing?.amount ?? inv.amount)).toFixed(2)}
                        </span>
                      )}
                      {isNew && (
                        <span className="flex items-center gap-1 text-xs text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                          <Plus size={10} /> New
                        </span>
                      )}
                      {inv.has_paid_version && inv.invoice_status !== 'paid' && (
                        <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-700/50 px-2 py-0.5 rounded-full">
                          <Info size={10} /> Also paid last cycle
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                      {inv.due_date  && <span>Due: {inv.due_date}</span>}
                      {inv.paid_date && <span>Paid: {inv.paid_date}</span>}
                      {!inv.due_date && !inv.paid_date && inv.email_date && <span>Email: {inv.email_date}</span>}
                      {inv.occurrences > 1 && <span>{inv.occurrences} emails found</span>}
                      <span className="truncate opacity-60">{inv.from}</span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {done && (
            <div className="flex items-center gap-2 text-green-400 bg-green-500/10 rounded-xl p-4 ring-1 ring-green-500/30">
              <CheckCircle size={16} />
              {[
                done.added   > 0 && `Added ${done.added} new expense${done.added   !== 1 ? 's' : ''}`,
                done.updated > 0 && `Updated ${done.updated} price${done.updated !== 1 ? 's' : ''}`,
              ].filter(Boolean).join(' · ')}
            </div>
          )}

          {results.length > 0 && (
            <button
              onClick={importSelected}
              disabled={saving || (newCount + updateCount) === 0}
              className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {updateCount > 0 ? <RefreshCw size={16} /> : <Plus size={16} />}
              {saving ? 'Saving…' : [
                newCount    > 0 && `Add ${newCount} new`,
                updateCount > 0 && `Update ${updateCount} price${updateCount !== 1 ? 's' : ''}`,
              ].filter(Boolean).join(' · ') || 'Nothing selected'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
