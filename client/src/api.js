const BASE = '/api';

export async function fetchExpenses() {
  const r = await fetch(`${BASE}/expenses`);
  if (!r.ok) throw new Error('Failed to fetch expenses');
  return r.json();
}

export async function createExpense(data) {
  const r = await fetch(`${BASE}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('Failed to create expense');
  return r.json();
}

export async function updateExpense(id, data) {
  const r = await fetch(`${BASE}/expenses/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('Failed to update expense');
  return r.json();
}

export async function deleteExpense(id) {
  const r = await fetch(`${BASE}/expenses/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error('Failed to delete expense');
  return r.json();
}

export async function payExpense(id) {
  const r = await fetch(`${BASE}/expenses/${id}/pay`, { method: 'POST' });
  if (!r.ok) throw new Error('Failed to mark as paid');
  return r.json();
}

export async function analyzeStatement(formData) {
  const r = await fetch(`${BASE}/import`, { method: 'POST', body: formData });
  if (!r.ok) throw new Error('Failed to analyze statement');
  return r.json();
}
