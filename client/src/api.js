const BASE = '/api';
const OPTS = { credentials: 'include' };

export async function fetchExpenses() {
  const r = await fetch(`${BASE}/expenses`, OPTS);
  if (!r.ok) throw new Error('Failed to fetch expenses');
  return r.json();
}

export async function createExpense(data) {
  const r = await fetch(`${BASE}/expenses`, { ...OPTS, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error('Failed to create expense');
  return r.json();
}

export async function updateExpense(id, data) {
  const r = await fetch(`${BASE}/expenses/${id}`, { ...OPTS, method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error('Failed to update expense');
  return r.json();
}

export async function deleteExpense(id) {
  const r = await fetch(`${BASE}/expenses/${id}`, { ...OPTS, method: 'DELETE' });
  if (!r.ok) throw new Error('Failed to delete expense');
  return r.json();
}

export async function payExpense(id) {
  const r = await fetch(`${BASE}/expenses/${id}/pay`, { ...OPTS, method: 'POST' });
  if (!r.ok) throw new Error('Failed to mark as paid');
  return r.json();
}

export async function analyzeStatement(formData) {
  const r = await fetch(`${BASE}/import`, { ...OPTS, method: 'POST', body: formData });
  if (!r.ok) throw new Error('Failed to analyze statement');
  return r.json();
}
