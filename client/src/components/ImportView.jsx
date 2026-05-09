import { useState, useRef } from 'react';
import { Upload, CheckCircle, XCircle, AlertCircle, FileText, Plus, TrendingUp, RefreshCw } from 'lucide-react';
import { analyzeStatement, createExpense, updateExpense } from '../api.js';

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];
function colorFor(i) { return COLORS[i % COLORS.length]; }

const FREQ_LABELS = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', custom: 'Custom',
};

// Match a detected recurring expense against the user's existing expenses.
// Returns { status: 'new' | 'exists' | 'price_change', existing }
function matchAgainstExisting(rec, expenses) {
  const recName = rec.name.toLowerCase().trim();
  const match = expenses.find(e => {
    const eName = e.name.toLowerCase().trim();
    return eName === recName || eName.includes(recName) || recName.includes(eName);
  });
  if (!match) return { status: 'new', existing: null };
  const diff = Math.abs(match.amount - rec.amount);
  // Treat as same if within $0.50 (rounding across currencies/periods)
  if (diff <= 0.50) return { status: 'exists', existing: match };
  return { status: 'price_change', existing: match };
}

export default function ImportView({ expenses = [], onImported }) {
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null); // { added, updated }
  const inputRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setLoading(true);
    setResults(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await analyzeStatement(fd);
      const enriched = data.recurring.map(rec => ({
        ...rec,
        ...matchAgainstExisting(rec, expenses),
      }));
      setResults(enriched);
      // Default selection: new items checked, existing unchecked, price_change checked
      const sel = {};
      enriched.forEach((r, i) => { sel[i] = r.status !== 'exists'; });
      setSelected(sel);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }

  async function importSelected() {
    if (!results) return;
    setSaving(true);
    let added = 0, updated = 0;
    for (let i = 0; i < results.length; i++) {
      if (!selected[i]) continue;
      const rec = results[i];
      if (rec.status === 'price_change' && rec.existing) {
        await updateExpense(rec.existing.id, { amount: rec.amount });
        updated++;
      } else if (rec.status === 'new') {
        await createExpense({
          name: rec.name,
          amount: rec.amount,
          currency: 'AUD',
          frequency: rec.frequency,
          interval_days: rec.interval_days,
          start_date: rec.last_date,
          category: rec.category,
          notes: `Imported from bank statement. Confidence: ${rec.confidence}%`,
          color: colorFor(i),
        });
        added++;
      }
    }
    setDone({ added, updated });
    setSaving(false);
    onImported();
  }

  const newCount = results?.filter((r, i) => selected[i] && r.status === 'new').length ?? 0;
  const updateCount = results?.filter((r, i) => selected[i] && r.status === 'price_change').length ?? 0;

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Import Bank Statement</h2>
        <p className="text-sm text-gray-400">
          Upload a CSV or PDF bank statement. The app detects recurring transactions and checks them
          against what you're already tracking.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
          dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 hover:border-gray-500 hover:bg-gray-800/30'
        }`}
      >
        <Upload className="mx-auto mb-3 text-gray-500" size={32} />
        <p className="text-gray-300 font-medium">Drop your CSV or PDF here, or click to browse</p>
        <p className="text-xs text-gray-500 mt-1">Supports CSV and PDF bank statements · CBA, ANZ, Westpac, NAB</p>
        <input ref={inputRef} type="file" accept=".csv,.tsv,.pdf" className="hidden" onChange={e => handleFile(e.target.files[0])} />
      </div>

      {loading && (
        <div className="text-center text-indigo-400 py-8 font-medium">Analysing transactions…</div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-500/10 rounded-xl p-4 ring-1 ring-red-500/30">
          <XCircle size={16} /> {error}
        </div>
      )}

      {results && results.length === 0 && (
        <div className="flex items-center gap-2 text-yellow-400 bg-yellow-500/10 rounded-xl p-4 ring-1 ring-yellow-500/30">
          <AlertCircle size={16} />
          No recurring transactions detected. Try a statement covering more than 2 billing cycles.
        </div>
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-4">
          {/* Summary legend */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" /> {results.filter(r => r.status === 'new').length} new
              </span>
              {results.some(r => r.status === 'price_change') && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> {results.filter(r => r.status === 'price_change').length} price changed
                </span>
              )}
              {results.some(r => r.status === 'exists') && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gray-600 inline-block" /> {results.filter(r => r.status === 'exists').length} already tracking
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { const s = {}; results.forEach((_, i) => { s[i] = true; }); setSelected(s); }}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >Select all</button>
              <span className="text-gray-600">·</span>
              <button
                onClick={() => setSelected({})}
                className="text-xs text-gray-400 hover:text-gray-300"
              >Deselect all</button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {results.map((rec, i) => {
              const isNew = rec.status === 'new';
              const isPriceChange = rec.status === 'price_change';
              const isExists = rec.status === 'exists';

              return (
                <label key={i} className={`flex items-start gap-4 p-4 rounded-xl ring-1 cursor-pointer transition-colors ${
                  isExists
                    ? 'bg-gray-900/40 ring-gray-800 opacity-50'
                    : isPriceChange
                    ? selected[i] ? 'bg-amber-950/30 ring-amber-500/40' : 'bg-gray-900 ring-gray-800 opacity-60'
                    : selected[i] ? 'bg-gray-800 ring-indigo-500/40' : 'bg-gray-900 ring-gray-800 opacity-60'
                }`}>
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
                      <p className="font-semibold text-white truncate">{rec.name}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isPriceChange && (
                          <span className="text-xs text-gray-500 line-through">${rec.existing.amount.toFixed(2)}</span>
                        )}
                        <p className={`font-bold ${isPriceChange ? 'text-amber-400' : 'text-white'}`}>
                          ${rec.amount.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-indigo-400 font-medium">{FREQ_LABELS[rec.frequency] || rec.frequency}</span>
                      <span className="text-xs text-gray-500">{rec.occurrences}x found</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        rec.confidence >= 80 ? 'bg-green-500/20 text-green-400'
                        : rec.confidence >= 60 ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-gray-700 text-gray-400'
                      }`}>
                        {rec.confidence}%
                      </span>

                      {/* Status badge */}
                      {isExists && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                          <CheckCircle size={10} /> Already tracking
                        </span>
                      )}
                      {isPriceChange && (
                        <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                          <TrendingUp size={10} />
                          Price {rec.amount > rec.existing.amount ? 'up' : 'down'} ${Math.abs(rec.amount - rec.existing.amount).toFixed(2)}
                        </span>
                      )}
                      {isNew && (
                        <span className="flex items-center gap-1 text-xs text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                          <Plus size={10} /> New
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Last seen: {rec.last_date} · {rec.category}</p>
                  </div>
                </label>
              );
            })}
          </div>

          {done && (
            <div className="flex items-center gap-2 text-green-400 bg-green-500/10 rounded-xl p-4 ring-1 ring-green-500/30">
              <CheckCircle size={16} />
              {[
                done.added > 0 && `Added ${done.added} new expense${done.added !== 1 ? 's' : ''}`,
                done.updated > 0 && `Updated ${done.updated} price${done.updated !== 1 ? 's' : ''}`,
              ].filter(Boolean).join(' · ')}
            </div>
          )}

          <button
            onClick={importSelected}
            disabled={saving || (newCount + updateCount) === 0}
            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {updateCount > 0 ? <RefreshCw size={16} /> : <Plus size={16} />}
            {saving ? 'Saving…' : [
              newCount > 0 && `Add ${newCount} new`,
              updateCount > 0 && `Update ${updateCount} price${updateCount !== 1 ? 's' : ''}`,
            ].filter(Boolean).join(' · ') || 'Nothing selected'}
          </button>
        </div>
      )}
    </div>
  );
}
