import { useState } from 'react';
import { differenceInDays, parseISO, format } from 'date-fns';
import {
  Edit2, Trash2, CheckCircle, Clock, CheckSquare, Square, X,
  LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink,
} from 'lucide-react';
import { deleteExpense, payExpense, updateExpense } from '../api.js';

const FREQ_LABELS = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', custom: 'Custom',
};

const CURRENCIES  = ['AUD', 'USD', 'EUR', 'GBP', 'CAD', 'JPY', 'CHF'];
const CATEGORIES  = ['Housing','Utilities','Insurance','Subscriptions','Transport','Food','Health','Entertainment','Other'];
const FREQUENCIES = [
  { value: 'daily',     label: 'Daily' },
  { value: 'weekly',    label: 'Weekly' },
  { value: 'biweekly',  label: 'Every 2 weeks' },
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly',    label: 'Yearly' },
  { value: 'custom',    label: 'Custom' },
];

// Looks like a text label; clicking opens the native dropdown and saves on change
function InlineSelect({ value, options, onChange, className = '' }) {
  return (
    <select
      value={value}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value)}
      className={`bg-transparent border-none outline-none cursor-pointer appearance-none
        hover:text-white transition-colors ${className}`}
    >
      {options.map(o =>
        typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
      )}
    </select>
  );
}

function urgencyClass(days) {
  if (days < 0) return { ring: 'ring-red-500/60', badge: 'bg-red-500/20 text-red-300', bar: 'bg-red-500', row: 'border-red-500/30' };
  if (days === 0) return { ring: 'ring-orange-500/60', badge: 'bg-orange-500/20 text-orange-300', bar: 'bg-orange-500', row: 'border-orange-500/30' };
  if (days <= 3) return { ring: 'ring-yellow-500/40', badge: 'bg-yellow-500/20 text-yellow-300', bar: 'bg-yellow-400', row: 'border-yellow-500/20' };
  if (days <= 7) return { ring: 'ring-blue-500/30', badge: 'bg-blue-500/20 text-blue-300', bar: 'bg-blue-400', row: 'border-blue-500/20' };
  return { ring: 'ring-gray-700', badge: 'bg-gray-700 text-gray-400', bar: 'bg-green-500', row: 'border-gray-800' };
}

function countdownLabel(days) {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days}d left`;
}

// ── Inline amount editor (shared between card + list) ────────────────────────
function AmountCell({ expense, onRefresh, disabled }) {
  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState('');
  const [cur, setCur] = useState('');

  function start(e) {
    if (disabled) return;
    e.stopPropagation();
    setAmt(expense.amount.toFixed(2));
    setCur(expense.currency);
    setEditing(true);
  }

  async function save() {
    const parsed = parseFloat(amt);
    if (!isNaN(parsed) && (parsed !== expense.amount || cur !== expense.currency)) {
      await updateExpense(expense.id, { amount: parsed, currency: cur });
      onRefresh();
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <input
          type="number" step="0.01" min="0" autoFocus
          value={amt} onChange={e => setAmt(e.target.value)}
          onBlur={save} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(false); }}
          className="w-24 bg-gray-800 border border-indigo-500 rounded-lg px-2 py-1 text-sm font-bold text-white text-right focus:outline-none"
        />
        <select
          value={cur} onChange={e => setCur(e.target.value)} onBlur={save}
          className="bg-gray-800 border border-gray-700 rounded-lg px-1 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
        >
          {CURRENCIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>
    );
  }

  return (
    <div onClick={start} className={!disabled ? 'cursor-text group' : ''}>
      <p className="text-lg font-bold text-white group-hover:text-indigo-300 transition-colors leading-none">
        {new Intl.NumberFormat('en-AU', { style: 'currency', currency: expense.currency }).format(expense.amount)}
      </p>
      <p className="text-xs text-gray-500 text-right">{expense.currency}</p>
    </div>
  );
}

// ── Card view ─────────────────────────────────────────────────────────────────
function ExpenseCard({ expense, onEdit, onRefresh, selectMode, isSelected, onToggle }) {
  const days = differenceInDays(parseISO(expense.next_due_date), new Date());
  const u = urgencyClass(days);

  const FREQ_TOTAL = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365, custom: expense.interval_days || 30 };
  const total = FREQ_TOTAL[expense.frequency] || 30;
  const elapsed = Math.max(0, total - days);
  const pct = Math.min(100, Math.round((elapsed / total) * 100));

  async function handlePay(e) {
    e.stopPropagation();
    await payExpense(expense.id);
    onRefresh();
  }
  async function handleDelete(e) {
    e.stopPropagation();
    if (!confirm(`Delete "${expense.name}"?`)) return;
    await deleteExpense(expense.id);
    onRefresh();
  }

  return (
    <div
      onClick={selectMode ? onToggle : undefined}
      className={`bg-gray-900 rounded-2xl p-5 ring-1 flex flex-col gap-3 transition-all
        ${selectMode ? 'cursor-pointer' : 'hover:scale-[1.01]'}
        ${selectMode && isSelected ? 'ring-indigo-500 bg-indigo-950/30' : u.ring}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {/* Checkbox sits naturally in the header row */}
          {selectMode && (
            isSelected
              ? <CheckSquare size={16} className="text-indigo-400 flex-shrink-0" />
              : <Square size={16} className="text-gray-600 flex-shrink-0" />
          )}
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: expense.color }} />
          <div className="min-w-0">
            <p className="font-semibold text-white truncate">{expense.name}</p>
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-0.5">
              <InlineSelect
                value={expense.category}
                options={CATEGORIES}
                onChange={async v => { await updateExpense(expense.id, { category: v }); onRefresh(); }}
                className="text-xs text-gray-500"
              />
              <span className="text-gray-700">·</span>
              <InlineSelect
                value={expense.frequency}
                options={FREQUENCIES}
                onChange={async v => { await updateExpense(expense.id, { frequency: v }); onRefresh(); }}
                className="text-xs text-gray-500"
              />
            </p>
          </div>
        </div>
        <AmountCell expense={expense} onRefresh={onRefresh} disabled={selectMode} />
      </div>

      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${u.bar}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.badge}`}>{countdownLabel(days)}</span>
        <span className="text-xs text-gray-500">{format(parseISO(expense.next_due_date), 'MMM d, yyyy')}</span>
      </div>

      {expense.notes && <p className="text-xs text-gray-500 truncate">{expense.notes}</p>}

      {expense.url && (
        <a
          href={expense.url} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 truncate w-fit"
        >
          <ExternalLink size={11} />
          {(() => { try { return new URL(expense.url).hostname; } catch { return expense.url; } })()}
        </a>
      )}

      {!selectMode && (
        <div className="flex items-center gap-2 pt-1 border-t border-gray-800">
          <button onClick={handlePay} className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors font-medium">
            <CheckCircle size={13} /> Mark paid
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); onEdit(expense); }} className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
              <Edit2 size={13} />
            </button>
            <button onClick={handleDelete} className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── List row ──────────────────────────────────────────────────────────────────
function ExpenseRow({ expense, onEdit, onRefresh, selectMode, isSelected, onToggle }) {
  const days = differenceInDays(parseISO(expense.next_due_date), new Date());
  const u = urgencyClass(days);

  async function handlePay(e) { e.stopPropagation(); await payExpense(expense.id); onRefresh(); }
  async function handleDelete(e) {
    e.stopPropagation();
    if (!confirm(`Delete "${expense.name}"?`)) return;
    await deleteExpense(expense.id); onRefresh();
  }

  return (
    <div
      onClick={selectMode ? onToggle : undefined}
      className={`flex items-center px-4 py-3 border-b transition-colors gap-3
        ${selectMode ? 'cursor-pointer' : ''}
        ${selectMode && isSelected ? 'bg-indigo-950/30 border-indigo-500/30' : 'border-gray-800 hover:bg-gray-800/40'}
      `}
    >
      {/* Checkbox */}
      {selectMode && (
        <div className="w-5 flex-shrink-0 flex items-center">
          {isSelected ? <CheckSquare size={16} className="text-indigo-400" /> : <Square size={16} className="text-gray-600" />}
        </div>
      )}

      {/* Color dot */}
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: expense.color }} />

      {/* Name + category/frequency — fills remaining space */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="font-medium text-white text-sm truncate">{expense.name}</p>
          {expense.url && (
            <a href={expense.url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()} title={expense.url}
              className="text-indigo-400 hover:text-indigo-300 flex-shrink-0">
              <ExternalLink size={11} />
            </a>
          )}
        </div>
        <p className="text-xs text-gray-500 flex items-center gap-0.5 mt-0.5">
          <InlineSelect value={expense.category} options={CATEGORIES}
            onChange={async v => { await updateExpense(expense.id, { category: v }); onRefresh(); }}
            className="text-xs text-gray-500" />
          <span className="text-gray-700">·</span>
          <InlineSelect value={expense.frequency} options={FREQUENCIES}
            onChange={async v => { await updateExpense(expense.id, { frequency: v }); onRefresh(); }}
            className="text-xs text-gray-500" />
        </p>
      </div>

      {/* Countdown — fixed width so it never shifts neighbours */}
      <div className="w-28 flex-shrink-0 hidden sm:flex justify-center">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${u.badge}`}>
          {countdownLabel(days)}
        </span>
      </div>

      {/* Due date — fixed width, right-aligned */}
      <div className="w-24 flex-shrink-0 hidden md:block text-right">
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {format(parseISO(expense.next_due_date), 'MMM d, yyyy')}
        </span>
      </div>

      {/* Amount — fixed width, right-aligned */}
      <div className="w-36 flex-shrink-0 flex justify-end">
        <AmountCell expense={expense} onRefresh={onRefresh} disabled={selectMode} />
      </div>

      {/* Actions — fixed width */}
      {!selectMode && (
        <div className="w-20 flex-shrink-0 flex items-center justify-end gap-0.5">
          <button onClick={handlePay} className="p-1.5 text-gray-500 hover:text-green-400 rounded-lg hover:bg-gray-800 transition-colors" title="Mark paid">
            <CheckCircle size={14} />
          </button>
          <button onClick={e => { e.stopPropagation(); onEdit(expense); }} className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
            <Edit2 size={14} />
          </button>
          <button onClick={handleDelete} className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sort button ───────────────────────────────────────────────────────────────
function SortBtn({ label, field, sortBy, sortDir, onClick }) {
  const active = sortBy === field;
  return (
    <button
      onClick={() => onClick(field)}
      className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
      }`}
    >
      {label}
      {active
        ? sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
        : <ArrowUpDown size={11} className="opacity-40" />}
    </button>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard({ expenses, onEdit, onRefresh }) {
  const today = new Date();

  const totalMonthly = expenses.reduce((sum, e) => {
    const MULTIPLIERS = { daily: 30, weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 0.33, yearly: 1 / 12, custom: 30 / (e.interval_days || 30) };
    return sum + e.amount * (MULTIPLIERS[e.frequency] || 1);
  }, 0);

  const overdue = expenses.filter(e => differenceInDays(parseISO(e.next_due_date), today) < 0);
  const dueSoon = expenses.filter(e => { const d = differenceInDays(parseISO(e.next_due_date), today); return d >= 0 && d <= 7; });

  const [filter, setFilter] = useState('all');
  const [viewMode, setViewMode] = useState('grid');       // 'grid' | 'list'
  const [sortBy, setSortBy] = useState('due');            // 'due' | 'name' | 'amount'
  const [sortDir, setSortDir] = useState('asc');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const cats = [...new Set(expenses.map(e => e.category))].sort();

  function handleSort(field) {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('asc'); }
  }

  const filtered = expenses.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'overdue') return differenceInDays(parseISO(e.next_due_date), today) < 0;
    if (filter === 'soon') { const d = differenceInDays(parseISO(e.next_due_date), today); return d >= 0 && d <= 7; }
    return e.category === filter;
  });

  const visible = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'due')    cmp = new Date(a.next_due_date) - new Date(b.next_due_date);
    if (sortBy === 'name')   cmp = a.name.localeCompare(b.name);
    if (sortBy === 'amount') cmp = a.amount - b.amount;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function exitSelectMode() { setSelectMode(false); setSelectedIds(new Set()); }
  function selectAll() { setSelectedIds(new Set(visible.map(e => e.id))); }

  async function deleteSelected() {
    if (!selectedIds.size) return;
    const names = expenses.filter(e => selectedIds.has(e.id)).map(e => e.name);
    const msg = selectedIds.size === 1
      ? `Delete "${names[0]}"?`
      : `Delete ${selectedIds.size} expenses?\n\n${names.join('\n')}`;
    if (!confirm(msg)) return;
    setDeleting(true);
    await Promise.all([...selectedIds].map(id => deleteExpense(id)));
    setDeleting(false);
    exitSelectMode();
    onRefresh();
  }

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500">
        <Clock size={40} className="opacity-30" />
        <p className="text-lg font-medium">No recurring expenses yet.</p>
        <p className="text-sm">Click <span className="text-indigo-400">Add Expense</span> or <span className="text-indigo-400">Import</span> a bank statement to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 rounded-2xl p-4 ring-1 ring-gray-800">
          <p className="text-xs text-gray-500 mb-1">Monthly total</p>
          <p className="text-xl sm:text-2xl font-bold text-white">{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(totalMonthly)}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4 ring-1 ring-red-500/30">
          <p className="text-xs text-gray-500 mb-1">Overdue</p>
          <p className="text-xl sm:text-2xl font-bold text-red-400">{overdue.length}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4 ring-1 ring-yellow-500/30">
          <p className="text-xs text-gray-500 mb-1">Due this week</p>
          <p className="text-xl sm:text-2xl font-bold text-yellow-300">{dueSoon.length}</p>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 flex-1">
          {['all', 'overdue', 'soon', ...cats].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {f === 'all' ? 'All' : f === 'overdue' ? `Overdue (${overdue.length})` : f === 'soon' ? `Due soon (${dueSoon.length})` : f}
            </button>
          ))}
        </div>

        {/* Sort + view controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <SortBtn label="Due date" field="due"    sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
          <SortBtn label="Name"     field="name"   sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
          <SortBtn label="Cost"     field="amount" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />

          <div className="w-px h-5 bg-gray-700 mx-1" />

          <button
            onClick={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
          >
            {viewMode === 'grid' ? <List size={16} /> : <LayoutGrid size={16} />}
          </button>

          <div className="w-px h-5 bg-gray-700 mx-1" />

          {!selectMode ? (
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-800 text-gray-400 hover:text-white transition-colors"
            >
              <CheckSquare size={12} /> Select
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={selectAll} className="text-xs text-indigo-400 hover:text-indigo-300">All ({visible.length})</button>
              <span className="text-gray-700">·</span>
              <button onClick={exitSelectMode} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white"><X size={12} /> Cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* Grid or List */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(exp => (
            <ExpenseCard key={exp.id} expense={exp} onEdit={onEdit} onRefresh={onRefresh}
              selectMode={selectMode} isSelected={selectedIds.has(exp.id)} onToggle={() => toggleSelect(exp.id)} />
          ))}
          {visible.length === 0 && <p className="text-gray-500 col-span-3 text-center py-8">No expenses match this filter.</p>}
        </div>
      ) : (
        <div className="bg-gray-900 rounded-2xl ring-1 ring-gray-800 overflow-hidden">
          {/* List header — widths must match ExpenseRow exactly */}
          <div className="flex items-center px-4 py-2 border-b border-gray-800 text-xs font-medium text-gray-500 gap-3">
            {selectMode && <div className="w-5 flex-shrink-0" />}
            <div className="w-2.5 flex-shrink-0" />
            <div className="flex-1">Name</div>
            <div className="w-28 flex-shrink-0 hidden sm:block text-center">Countdown</div>
            <div className="w-24 flex-shrink-0 hidden md:block text-right">Due date</div>
            <div className="w-36 flex-shrink-0 text-right">Amount</div>
            {!selectMode && <div className="w-20 flex-shrink-0" />}
          </div>
          {visible.map(exp => (
            <ExpenseRow key={exp.id} expense={exp} onEdit={onEdit} onRefresh={onRefresh}
              selectMode={selectMode} isSelected={selectedIds.has(exp.id)} onToggle={() => toggleSelect(exp.id)} />
          ))}
          {visible.length === 0 && <p className="text-gray-500 text-center py-8 text-sm">No expenses match this filter.</p>}
        </div>
      )}

      {/* Floating batch-delete bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 bg-gray-900 border border-gray-700 shadow-2xl rounded-2xl px-5 py-3">
          <span className="text-sm text-gray-300 font-medium">{selectedIds.size} selected</span>
          <button
            onClick={deleteSelected}
            disabled={deleting}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-xl transition-colors"
          >
            <Trash2 size={14} />
            {deleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
          </button>
        </div>
      )}
    </div>
  );
}
