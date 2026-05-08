import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Calendar, Upload, Plus } from 'lucide-react';
import Dashboard from './components/Dashboard.jsx';
import CalendarView from './components/CalendarView.jsx';
import ImportView from './components/ImportView.jsx';
import ExpenseModal from './components/ExpenseModal.jsx';
import { fetchExpenses } from './api.js';

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);

  const loadExpenses = useCallback(async () => {
    try {
      const data = await fetchExpenses();
      setExpenses(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  function openAdd() { setEditingExpense(null); setModalOpen(true); }
  function openEdit(exp) { setEditingExpense(exp); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditingExpense(null); }

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
    { id: 'calendar', label: 'Calendar', Icon: Calendar },
    { id: 'import', label: 'Import', Icon: Upload },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tracking-tight text-white">ExpenseRadar</span>
          </div>
          <nav className="flex items-center gap-1">
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === id
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={15} />
            Add Expense
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>
        ) : tab === 'dashboard' ? (
          <Dashboard expenses={expenses} onEdit={openEdit} onRefresh={loadExpenses} />
        ) : tab === 'calendar' ? (
          <CalendarView expenses={expenses} />
        ) : (
          <ImportView onImported={loadExpenses} />
        )}
      </main>

      {modalOpen && (
        <ExpenseModal
          expense={editingExpense}
          onClose={closeModal}
          onSaved={() => { closeModal(); loadExpenses(); }}
        />
      )}
    </div>
  );
}
