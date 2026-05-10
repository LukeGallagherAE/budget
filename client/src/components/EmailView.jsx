import { useState, useEffect } from 'react';
import {
  Mail, ScanLine, CheckCircle, XCircle, AlertCircle, Plus, RefreshCw,
  Clock, CalendarCheck, TrendingUp, ExternalLink, Info, FileText, ChevronDown, ChevronUp, Repeat,
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
          ExpenseRadar scans your last 12 months of invoice emails — receipts,
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
const CATEGORIES = ['Subscriptions','Utilities','Insurance','Food','Transport','Health','Housing','Entertainment','Other'];
const FREQ_OPTIONS = [
  { value: 'daily',     label: 'Daily' },
  { value: 'weekly',    label: 'Weekly' },
  { value: 'biweekly',  label: 'Every 2 wks' },
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly',    label: 'Yearly' },
];

export default function EmailView({ expenses = [], onImported }) {
  const [configured, setConfigured] = useState(null); // null = loading
  const [scanning,   setScanning]   = useState(false);
  const [results,    setResults]    = useState(null);  // enriched invoice list
  const [selected,   setSelected]   = useState({});
  const [saving,     setSaving]     = useState(false);
  const [done,       setDone]       = useState(null);
  const [error,           setError]           = useState(null);
  const [extractionErrors, setExtractionErrors] = useState([]);
  const [emailCount,      setEmailCount]      = useState(null);
  const [edits,           setEdits]           = useState({});
  const [noteOpen,        setNoteOpen]        = useState({});
  const [bodyOpen,        setBodyOpen]        = useState({});

  const getVal = (i, field) => edits[i]?.[field] ?? results[i][field];
  const setVal = (i, field, val) => setEdits(p => ({ ...p, [i]: { ...(p[i] || {}), [field]: val } }));

  useEffect(() => {
    getEmailStatus()
      .then(s => setConfigured(s.gmail && s.anthropic))
      .catch(() => setConfigured(false));
  }, []);

  async function handleScan() {
    setError(null);
    setExtractionErrors([]);
    setResults(null);
    setDone(null);
    setSelected({});
    setEdits({});
    setNoteOpen({});
    setBodyOpen({});
    setScanning(true);
    try {
      const data = await scanEmails();
      setEmailCount(data.emails_scanned);
      if (data.errors?.length) setExtractionErrors(data.errors);
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
      const overrides = edits[i] || {};
      if (inv.status === 'price_change' && inv.existing) {
        await updateExpense(inv.existing.id, { amount: overrides.amount ?? inv.amount });
        updated++;
      } else if (inv.status === 'new') {
        await createExpense({
          name:          overrides.merchant  ?? inv.merchant,
          amount:        overrides.amount    ?? inv.amount,
          currency:      inv.currency || 'AUD',
          frequency:     overrides.frequency ?? inv.frequency ?? 'monthly',
          interval_days: null,
          start_date:    inv.due_date || inv.paid_date || inv.email_date || new Date().toISOString().split('T')[0],
          category:      overrides.category  ?? inv.category ?? 'Other',
          notes:         overrides.notes     ?? (() => {
            const parts = [];
            if (inv.subject) parts.push(`"${inv.subject}"`);
            if (inv.from)    parts.push(`From: ${inv.from}`);
            if (inv.email_body) parts.push(inv.email_body.slice(0, 200).trim());
            if (inv.attachments?.length) parts.push(`PDFs: ${inv.attachments.map(a => a.name).join(', ')}`);
            return parts.join('\n');
          })(),
          color:         colorFor(i),
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
          Scan your last 12 months of Gmail for invoices, receipts, and payment reminders.
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
          <p className="text-xs text-gray-500">Reading a year of emails, then asking Claude to extract invoice data. Allow 2–3 minutes — batches are spaced out to avoid rate limits.</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-500/10 rounded-xl p-4 ring-1 ring-red-500/30">
          <XCircle size={16} /> {error}
        </div>
      )}

      {extractionErrors.length > 0 && (
        <div className="bg-amber-950/30 rounded-xl p-4 ring-1 ring-amber-500/30 flex flex-col gap-1">
          <p className="flex items-center gap-2 text-amber-400 text-sm font-medium">
            <AlertCircle size={14} /> Claude extraction had errors ({extractionErrors.length} batch{extractionErrors.length !== 1 ? 'es' : ''} failed)
          </p>
          {extractionErrors.map((e, i) => (
            <p key={i} className="text-xs text-amber-300/70 font-mono break-all">{e}</p>
          ))}
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
                onClick={() => { setResults(null); setDone(null); setSelected({}); setExtractionErrors([]); setEdits({}); setNoteOpen({}); setBodyOpen({}); }}
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
                <div
                  key={i}
                  className={`flex items-start gap-4 p-4 rounded-xl ring-1 transition-colors ${
                    isExists
                      ? 'bg-gray-900/40 ring-gray-800 opacity-50'
                      : isPriceChg
                      ? selected[i] ? 'bg-amber-950/30 ring-amber-500/40' : 'bg-gray-900 ring-gray-800 opacity-60'
                      : selected[i] ? 'bg-gray-800 ring-indigo-500/40' : 'bg-gray-900 ring-gray-800 opacity-60'
                  }`}
                >
                  <label className="mt-1 cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={!!selected[i]}
                      disabled={isExists}
                      onChange={e => setSelected(s => ({ ...s, [i]: e.target.checked }))}
                      className="accent-indigo-500"
                    />
                  </label>
                  <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: colorFor(i) }} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      {/* Editable name */}
                      <input
                        type="text"
                        value={getVal(i, 'merchant') ?? ''}
                        onChange={e => setVal(i, 'merchant', e.target.value)}
                        className="bg-transparent outline-none border-b border-dashed border-transparent hover:border-gray-600 focus:border-indigo-400 font-semibold text-white w-full min-w-0"
                      />
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isPriceChg && inv.existing && (
                          <span className="text-xs text-gray-500 line-through">${inv.existing.amount.toFixed(2)}</span>
                        )}
                        {/* Editable amount */}
                        <input
                          type="number"
                          step="0.01"
                          value={getVal(i, 'amount') ?? ''}
                          onChange={e => setVal(i, 'amount', parseFloat(e.target.value))}
                          className={`bg-transparent outline-none border-b border-dashed border-transparent hover:border-gray-600 focus:border-indigo-400 font-bold text-right w-24 ${isPriceChg ? 'text-amber-400' : 'text-white'}`}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {/* Invoice status (paid/due/upcoming) */}
                      <StatusBadge status={inv.invoice_status || inv.status_from_email} hasPaid={inv.has_paid_version} />

                      {/* Editable category */}
                      <select
                        value={getVal(i, 'category') ?? 'Other'}
                        onChange={e => setVal(i, 'category', e.target.value)}
                        className="bg-gray-800 text-xs rounded px-1.5 py-0.5 text-gray-300 border border-gray-700 focus:outline-none focus:border-indigo-400"
                      >
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>

                      {/* Editable frequency — only for non-exists invoices */}
                      {!isExists && (
                        <select
                          value={getVal(i, 'frequency') ?? 'monthly'}
                          onChange={e => setVal(i, 'frequency', e.target.value)}
                          className="bg-gray-800 text-xs rounded px-1.5 py-0.5 text-gray-300 border border-gray-700 focus:outline-none focus:border-indigo-400"
                        >
                          {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
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
                      {/* Occurrences badge — prominent */}
                      {inv.occurrences > 1 && (
                        <span className="flex items-center gap-1 text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full font-medium">
                          <Repeat size={10} /> {inv.occurrences}× found
                        </span>
                      )}
                    </div>

                    {/* From / dates row */}
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                      {inv.due_date  && <span className="text-yellow-400/80">Due {inv.due_date}</span>}
                      {inv.paid_date && <span className="text-green-400/80">Paid {inv.paid_date}</span>}
                      {!inv.due_date && !inv.paid_date && inv.email_date && <span>Received {inv.email_date}</span>}
                      {inv.from && <span className="truncate opacity-50">{inv.from}</span>}
                    </div>

                    {/* Subject line */}
                    {inv.subject && (
                      <p className="mt-1 text-xs text-gray-400 italic truncate" title={inv.subject}>
                        "{inv.subject}"
                      </p>
                    )}

                    {/* Email body — always show a preview, expand for full */}
                    {inv.email_body && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap break-words">
                          {bodyOpen[i] ? inv.email_body : inv.email_body.slice(0, 180).trimEnd()}
                          {!bodyOpen[i] && inv.email_body.length > 180 && (
                            <button
                              onClick={() => setBodyOpen(p => ({ ...p, [i]: true }))}
                              className="text-gray-500 hover:text-gray-300 ml-1"
                            >… more</button>
                          )}
                        </p>
                        {bodyOpen[i] && (
                          <button
                            onClick={() => setBodyOpen(p => ({ ...p, [i]: false }))}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 mt-1"
                          >
                            <ChevronUp size={11} /> Show less
                          </button>
                        )}
                      </div>
                    )}

                    {/* PDF attachments — only shown when emails actually have .pdf files attached */}
                    {inv.attachments?.length > 0 && (
                      <div className="mt-2 rounded-lg bg-blue-950/40 border border-blue-500/30 px-3 py-2 flex flex-col gap-1.5">
                        <p className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
                          <FileText size={11} />
                          {inv.attachments.length === 1 ? '1 PDF attached' : `${inv.attachments.length} PDFs attached`}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {inv.attachments.map((att, j) => (
                            <span key={j} className="flex items-center gap-1.5 text-xs text-blue-200 bg-blue-900/50 border border-blue-500/20 px-2 py-1 rounded-md font-mono">
                              <FileText size={10} className="text-blue-400" />
                              {att.name}
                              {att.size > 0 && <span className="text-blue-400/60 font-sans ml-1">{(att.size / 1024).toFixed(0)} KB</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Notes section */}
                    <div className="mt-2">
                      {!noteOpen[i] ? (
                        <button
                          onClick={() => setNoteOpen(p => ({ ...p, [i]: true }))}
                          className="text-xs text-gray-500 hover:text-gray-400"
                        >+ Add note</button>
                      ) : (
                        <textarea
                          rows={3}
                          value={getVal(i, 'notes') ?? ''}
                          onChange={e => setVal(i, 'notes', e.target.value)}
                          placeholder="Add a note…"
                          className="bg-gray-800/50 rounded-lg text-xs text-gray-300 w-full px-3 py-2 mt-2 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      )}
                    </div>
                  </div>
                </div>
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
