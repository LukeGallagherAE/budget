import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Calendar, Upload, Plus, LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './components/Dashboard.jsx';
import CalendarView from './components/CalendarView.jsx';
import ImportView from './components/ImportView.jsx';
import ExpenseModal from './components/ExpenseModal.jsx';
import { fetchExpenses } from './api.js';

function AppShell() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>;
  }

  if (!user) return <AuthPage />;

  return <MainApp />;
}

function MainApp() {
  const { user, logout } = useAuth();
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
      <header className="border-b border-gray-800 bg-gray-900/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
          <span className="text-xl font-bold tracking-tight text-white">ExpenseRadar</span>

          <nav className="flex items-center gap-1">
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === id ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={15} />
              Add Expense
            </button>
            <div className="flex items-center gap-2 pl-2 border-l border-gray-800">
              <span className="text-xs text-gray-500 hidden sm:block">{user.email}</span>
              <button
                onClick={logout}
                title="Sign out"
                className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>
        ) : tab === 'dashboard' ? (
          <Dashboard expenses={expenses} onEdit={openEdit} onRefresh={loadExpenses} />
        ) : tab === 'calendar' ? (
          <CalendarView expenses={expenses} />
        ) : (
          <ImportView expenses={expenses} onImported={loadExpenses} />
        )}
      </main>

      {modalOpen && (
        <ExpenseModal
          expense={editingExpense}
          onClose={closeModal}
          onSaved={() => { closeModal(); loadExpenses(); }}
        />
      )}

      <footer className="border-t border-gray-800 py-2 text-center">
        <span className="text-xs text-gray-700">
          built {new Date(__BUILD_TIME__).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
