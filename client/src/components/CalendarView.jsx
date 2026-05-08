import { useState } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday,
  parseISO, addMonths, subMonths, differenceInDays,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function getMonthDates(month) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
}

function expensesForDay(expenses, day) {
  const dayStr = format(day, 'yyyy-MM-dd');
  return expenses.filter(e => e.next_due_date === dayStr);
}

export default function CalendarView({ expenses }) {
  const [month, setMonth] = useState(new Date());
  const days = getMonthDates(month);
  const [selected, setSelected] = useState(null);

  const selectedDayExpenses = selected
    ? expenses.filter(e => e.next_due_date === format(selected, 'yyyy-MM-dd'))
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">{format(month, 'MMMM yyyy')}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth(m => subMonths(m, 1))}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setMonth(new Date())}
            className="px-3 py-1 text-xs rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors font-medium"
          >
            Today
          </button>
          <button
            onClick={() => setMonth(m => addMonths(m, 1))}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="bg-gray-900 rounded-2xl ring-1 ring-gray-800 overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-gray-800">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-500 py-3">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const dayExpenses = expensesForDay(expenses, day);
            const isCurrentMonth = isSameMonth(day, month);
            const isSelected = selected && format(selected, 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd');
            const today = isToday(day);

            return (
              <div
                key={i}
                onClick={() => setSelected(day)}
                className={`min-h-[80px] p-2 border-b border-r border-gray-800 cursor-pointer transition-colors
                  ${isCurrentMonth ? 'hover:bg-gray-800/50' : 'opacity-30'}
                  ${isSelected ? 'bg-indigo-900/30' : ''}
                `}
              >
                <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium mb-1 ${
                  today ? 'bg-indigo-600 text-white' : 'text-gray-400'
                }`}>
                  {format(day, 'd')}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayExpenses.slice(0, 3).map(exp => (
                    <div
                      key={exp.id}
                      className="text-xs px-1.5 py-0.5 rounded truncate font-medium"
                      style={{ backgroundColor: exp.color + '33', color: exp.color }}
                      title={`${exp.name} – ${new Intl.NumberFormat('en-US', { style: 'currency', currency: exp.currency }).format(exp.amount)}`}
                    >
                      {exp.name}
                    </div>
                  ))}
                  {dayExpenses.length > 3 && (
                    <div className="text-xs text-gray-500 pl-1">+{dayExpenses.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day panel */}
      {selected && selectedDayExpenses.length > 0 && (
        <div className="bg-gray-900 rounded-2xl ring-1 ring-gray-800 p-5">
          <h3 className="font-semibold text-white mb-4">{format(selected, 'EEEE, MMMM d, yyyy')}</h3>
          <div className="flex flex-col gap-3">
            {selectedDayExpenses.map(exp => (
              <div key={exp.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: exp.color }} />
                  <div>
                    <p className="font-medium text-white text-sm">{exp.name}</p>
                    <p className="text-xs text-gray-500">{exp.category}</p>
                  </div>
                </div>
                <p className="font-bold text-white">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: exp.currency }).format(exp.amount)}
                </p>
              </div>
            ))}
            <p className="text-right text-sm font-semibold text-gray-400 mt-1">
              Total:{' '}
              <span className="text-white">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                  selectedDayExpenses.reduce((s, e) => s + e.amount, 0)
                )}
              </span>
            </p>
          </div>
        </div>
      )}

      {selected && selectedDayExpenses.length === 0 && (
        <p className="text-center text-gray-500 text-sm">No expenses due on {format(selected, 'MMMM d')}.</p>
      )}
    </div>
  );
}
