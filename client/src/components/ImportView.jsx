import { useState, useRef } from 'react';
import { Upload, CheckCircle, XCircle, AlertCircle, FileText, Plus } from 'lucide-react';
import { analyzeStatement, createExpense } from '../api.js';

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];

function colorFor(i) { return COLORS[i % COLORS.length]; }

const FREQ_LABELS = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', custom: 'Custom' };

export default function ImportView({ onImported }) {
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState([]);
  const inputRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setLoading(true);
    setResults(null);
    setSaved([]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await analyzeStatement(fd);
      setResults(data.recurring);
      const sel = {};
      data.recurring.forEach((_, i) => { sel[i] = true; });
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
    const toImport = results.filter((_, i) => selected[i]);
    const newlySaved = [];
    for (const rec of toImport) {
      await createExpense({
        name: rec.name,
        amount: rec.amount,
        currency: 'USD',
        frequency: rec.frequency,
        interval_days: rec.interval_days,
        start_date: rec.last_date,
        category: rec.category,
        notes: `Imported from bank statement. Confidence: ${rec.confidence}%`,
        color: colorFor(results.indexOf(rec)),
      });
      newlySaved.push(rec.name);
    }
    setSaved(newlySaved);
    setSaving(false);
    onImported();
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Import Bank Statement</h2>
        <p className="text-sm text-gray-400">
          Upload a CSV export from your bank. The app will detect recurring transactions automatically.
          Supports most bank CSV formats (Date, Description, Amount columns).
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
        <p className="text-xs text-gray-500 mt-1">Supports CSV and PDF bank statements</p>
        <input ref={inputRef} type="file" accept=".csv,.tsv,.pdf" className="hidden" onChange={e => handleFile(e.target.files[0])} />
      </div>

      {/* Format hint */}
      <div className="bg-gray-900 rounded-xl p-4 ring-1 ring-gray-800 text-sm">
        <p className="text-gray-400 font-medium mb-2 flex items-center gap-2"><FileText size={14} /> Expected CSV format</p>
        <p className="text-gray-500 font-mono text-xs leading-relaxed">
          Date, Description, Amount<br />
          2024-01-15, Netflix, -15.99<br />
          2024-01-14, Spotify, -9.99<br />
          2024-01-01, Rent, -1200.00
        </p>
        <p className="text-gray-500 text-xs mt-2">Column headers are flexible — the importer auto-detects date, description, and amount columns.</p>
      </div>

      {loading && (
        <div className="text-center text-indigo-400 py-8 font-medium">Analysing transactions...</div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-500/10 rounded-xl p-4 ring-1 ring-red-500/30">
          <XCircle size={16} />
          {error}
        </div>
      )}

      {/* Results */}
      {results && results.length === 0 && (
        <div className="flex items-center gap-2 text-yellow-400 bg-yellow-500/10 rounded-xl p-4 ring-1 ring-yellow-500/30">
          <AlertCircle size={16} />
          No recurring transactions detected. Try a statement covering more than 2 billing cycles.
        </div>
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">
              {results.length} recurring pattern{results.length !== 1 ? 's' : ''} detected
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { const s = {}; results.forEach((_, i) => { s[i] = true; }); setSelected(s); }}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Select all
              </button>
              <span className="text-gray-600">·</span>
              <button
                onClick={() => setSelected({})}
                className="text-xs text-gray-400 hover:text-gray-300"
              >
                Deselect all
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {results.map((rec, i) => (
              <label key={i} className={`flex items-start gap-4 p-4 rounded-xl ring-1 cursor-pointer transition-colors ${
                selected[i] ? 'bg-gray-800 ring-indigo-500/40' : 'bg-gray-900 ring-gray-800 opacity-60'
              }`}>
                <input
                  type="checkbox"
                  checked={!!selected[i]}
                  onChange={e => setSelected(s => ({ ...s, [i]: e.target.checked }))}
                  className="mt-1 accent-indigo-500"
                />
                <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: colorFor(i) }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-white truncate">{rec.name}</p>
                    <p className="font-bold text-white flex-shrink-0">
                      ${rec.amount.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-xs text-indigo-400 font-medium">{FREQ_LABELS[rec.frequency] || rec.frequency}</span>
                    <span className="text-xs text-gray-500">{rec.occurrences} occurrences found</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      rec.confidence >= 80 ? 'bg-green-500/20 text-green-400'
                      : rec.confidence >= 60 ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-gray-700 text-gray-400'
                    }`}>
                      {rec.confidence}% confidence
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Last seen: {rec.last_date} · Category: {rec.category}</p>
                </div>
              </label>
            ))}
          </div>

          {saved.length > 0 && (
            <div className="flex items-center gap-2 text-green-400 bg-green-500/10 rounded-xl p-4 ring-1 ring-green-500/30">
              <CheckCircle size={16} />
              Added {saved.length} expense{saved.length !== 1 ? 's' : ''}: {saved.join(', ')}
            </div>
          )}

          <button
            onClick={importSelected}
            disabled={saving || Object.values(selected).filter(Boolean).length === 0}
            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
          >
            <Plus size={16} />
            {saving ? 'Saving...' : `Add ${Object.values(selected).filter(Boolean).length} selected expense${Object.values(selected).filter(Boolean).length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
