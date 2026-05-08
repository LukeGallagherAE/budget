import { differenceInDays, parseISO, format } from 'date-fns';
import { Edit2, Trash2, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { deleteExpense, payExpense } from '../api.js';

const FREQ_LABELS = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', custom: 'Custom',
};

const CATEGORIES = ['Housing', 'Utilities', 'Insurance', 'Subscriptions', 'Transport', 'Food', 'Health', 'Entertainment', 'Other'];

function urgencyClass(days) {
  if (days < 0) return { ring: 'ring-red-500/60', badge: 'bg-red-500/20 text-red-300', bar: 'bg-red-500' };
  if (days === 0) return { ring: 'ring-orange-500/60', badge: 'bg-orange-500/20 text-orange-300', bar: 'bg-orange-500' };
  if (days <= 3) return { ring: 'ring-yellow-500/40', badge: 'bg-yellow-500/20 text-yellow-300', bar: 'bg-yellow-400' };
  if (days <= 7) return { ring: 'ring-blue-500/30', badge: 'bg-blue-500/20 text-blue-300', bar: 'bg-blue-400' };
  return { ring: 'ring-gray-700', badge: 'bg-gray-700 text-gray-400', bar: 'bg-green-500' };
}

function countdownLabel(days) {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days}d left`;
}

function ExpenseCard({ expense, onEdit, onRefresh }) {
  const days = differenceInDays(parseISO(expense.next_due_date), new Date());
  const u = urgencyClass(days);

  async function handlePay() {
    await payExpense(expense.id);
    onRefresh();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${expense.name}"?`)) return;
    await deleteExpense(expense.id);
    onRefresh();
  }

  // progress bar: 0–100% where 100% = overdue
  const FREQ_TOTAL = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365, custom: expense.interval_days || 30 };
  const total = FREQ_TOTAL[expense.frequency] || 30;
  const elapsed = Math.max(0, total - days);
  const pct = Math.min(100, Math.round((elapsed / total) * 100));

  return (
    <div className={`relative bg-gray-900 rounded-2xl p-5 ring-1 ${u.ring} flex flex-col gap-3 transition-all hover:scale-[1.01]`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: expense.color }} />
          <div className="min-w-0">
            <p className="font-semibold text-white truncate">{expense.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{expense.category} · {FREQ_LABELS[expense.frequency]}</p>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-lg font-bold text-white">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: expense.currency }).format(expense.amount)}
          </p>
          <p className="text-xs text-gray-500">{expense.currency}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${u.bar}`} style={{ width: `${pct}%` }} />
      </div>

      {/* Countdown + due date */}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.badge}`}>
          {countdownLabel(days)}
        </span>
        <span className="text-xs text-gray-500">
          {format(parseISO(expense.next_due_date), 'MMM d, yyyy')}
        </span>
      </div>

      {expense.notes && (
        <p className="text-xs text-gray-500 truncate">{expense.notes}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-gray-800">
        <button
          onClick={handlePay}
          className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors font-medium"
        >
          <CheckCircle size={13} />
          Mark paid
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => onEdit(expense)} className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
            <Edit2 size={13} />
          </button>
          <button onClick={handleDelete} className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ expenses, onEdit, onRefresh }) {
  const today = new Date();
  const totalMonthly = expenses.reduce((sum, e) => {
    const MULTIPLIERS = { daily: 30, weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 0.33, yearly: 1 / 12, custom: 30 / (e.interval_days || 30) };
    return sum + e.amount * (MULTIPLIERS[e.frequency] || 1);
  }, 0);

  const overdue = expenses.filter(e => differenceInDays(parseISO(e.next_due_date), today) < 0);
  const dueSoon = expenses.filter(e => { const d = differenceInDays(parseISO(e.next_due_date), today); return d >= 0 && d <= 7; });

  const [filter, setFilter] = useState('all');
  const cats = [...new Set(expenses.map(e => e.category))].sort();

  const visible = expenses.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'overdue') return differenceInDays(parseISO(e.next_due_date), today) < 0;
    if (filter === 'soon') { const d = differenceInDays(parseISO(e.next_due_date), today); return d >= 0 && d <= 7; }
    return e.category === filter;
  });

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
    <div className="flex flex-col gap-6">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-2xl p-4 ring-1 ring-gray-800">
          <p className="text-xs text-gray-500 mb-1">Monthly total</p>
          <p className="text-2xl font-bold text-white">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalMonthly)}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4 ring-1 ring-red-500/30">
          <p className="text-xs text-gray-500 mb-1">Overdue</p>
          <p className="text-2xl font-bold text-red-400">{overdue.length}</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4 ring-1 ring-yellow-500/30">
          <p className="text-xs text-gray-500 mb-1">Due this week</p>
          <p className="text-2xl font-bold text-yellow-300">{dueSoon.length}</p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
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

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map(exp => (
          <ExpenseCard key={exp.id} expense={exp} onEdit={onEdit} onRefresh={onRefresh} />
        ))}
        {visible.length === 0 && (
          <p className="text-gray-500 col-span-3 text-center py-8">No expenses match this filter.</p>
        )}
      </div>
    </div>
  );
}
