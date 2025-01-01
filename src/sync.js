const API = 'http://127.0.0.1:8050';

async function sha256Hex(str) {
  try {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(hash));
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback простой хеш, если SubtleCrypto недоступен
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return h.toString(16);
  }
}

function authHeaders() {
  const token = localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function register(email, password, name = '') {
  const resp = await fetch(`${API}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!resp.ok) throw new Error('register failed');
  return resp.json();
}

export async function login(email, password) {
  const resp = await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) throw new Error('login failed');
  const data = await resp.json();
  localStorage.setItem('authToken', data.token);
  return data;
}

export async function me() {
  const resp = await fetch(`${API}/api/me`, { headers: authHeaders() });
  if (!resp.ok) throw new Error('me failed');
  return resp.json();
}

export async function getBudgets() {
  const resp = await fetch(`${API}/api/budgets`, { headers: authHeaders() });
  if (!resp.ok) throw new Error('budgets failed');
  return resp.json();
}

export async function createBudget(name) {
  const resp = await fetch(`${API}/api/budgets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) throw new Error('create budget failed');
  return resp.json();
}

export async function updateBudget(id, name) {
  const resp = await fetch(`${API}/api/budgets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) throw new Error('update budget failed');
  return resp.json();
}

export async function deleteBudget(id) {
  const resp = await fetch(`${API}/api/budgets/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!resp.ok) {
    const err = new Error(data?.error || 'delete budget failed');
    err.code = data?.error;
    throw err;
  }
  return data;
}

export async function inviteMember(budgetId, email, role = 'editor') {
  const resp = await fetch(`${API}/api/budgets/${budgetId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ email, role }),
  });
  if (!resp.ok) throw new Error('invite failed');
  return resp.json();
}

export async function acceptInvite(token) {
  const resp = await fetch(`${API}/api/invitations/${token}/accept`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error('accept invite failed');
  return resp.json();
}

export async function pullTransactions() {
  const budgetId = Number(localStorage.getItem('activeBudgetId'));
  const url = new URL(`${API}/api/transactions`);
  if (budgetId) url.searchParams.set('budgetId', String(budgetId));
  const resp = await fetch(url, { headers: authHeaders() });
  if (!resp.ok) throw new Error('pull failed');
  return resp.json();
}

export async function pushTransactions(items) {
  const budgetId = Number(localStorage.getItem('activeBudgetId'));
  // Отправляем только локальные записи, чтобы избежать дубликатов
  const raw = Array.isArray(items) ? items.filter((it) => it.origin !== 'server') : [];
  // Готовим payload с clientId, contentHash и idempotencyKey
  const toSend = [];
  for (const it of raw) {
    const base = [
      String(it.type || ''),
      String(it.amount || ''),
      String(it.category || ''),
      String(it.member || ''),
      String(it.source || ''),
      String(it.date || ''),
      String(it.note || ''),
    ].join('|').toLowerCase();
    const contentHash = await sha256Hex(base);
    const idempotencyKey = `${Number(budgetId)}:${contentHash}:${String(it.amount)}:${String(it.date)}`;
    toSend.push({
      clientId: it.id,
      type: it.type,
      amount: it.amount,
      category: it.category,
      member: it.member,
      source: it.source,
      note: it.note,
      date: it.date,
      budgetId,
      contentHash,
      idempotencyKey,
      deletedAt: it.deletedAt || null,
    });
  }
  const resp = await fetch(`${API}/api/transactions/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ budgetId, items: toSend }),
  });
  if (!resp.ok) throw new Error('push failed');
  try {
    const data = await resp.json();
    // Сервер возвращает { created, duplicates, updated, mapping }
    return data || { created: [], duplicates: [], updated: [], mapping: [] };
  } catch {
    return { created: [], duplicates: [], updated: [], mapping: [] };
  }
}

export async function getMeta() {
  const resp = await fetch(`${API}/api/meta`);
  if (!resp.ok) return { members: [], sources: [] };
  return resp.json();
}

// --- Real‑time subscription via SSE ---
export function subscribeEvents(budgetId) {
  const token = localStorage.getItem('authToken');
  const url = new URL(`${API}/api/events`);
  if (budgetId) url.searchParams.set('budgetId', String(budgetId));
  if (token) url.searchParams.set('token', token);
  // EventSource не поддерживает кастомные заголовки, поэтому токен передаём в query
  const es = new EventSource(url.toString());
  return es;
}