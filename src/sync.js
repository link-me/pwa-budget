// Resolve API base depending on environment.
// Local dev hits Node API directly; production adapts to subdirectory (e.g., `/money`).
const API = (() => {
  const host = location.hostname;
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(host);
  // В локальной среде используем 8050, чтобы совпадать с nginx/продом
  if (isLocal) return 'http://127.0.0.1:8050';
  // If app is served under a subdirectory (e.g., /money), assume API is namespaced there.
  const firstSegment = (location.pathname.split('/')[1] || '').trim();
  return firstSegment ? `/${firstSegment}` : '';
})();

// Settings API availability flag to avoid repeated failing requests
let __settingsApiAvailable = null; // null=unknown, true=available, false=unavailable
// In-flight guards to prevent parallel requests spamming the server
let __settingsGetInFlight = null;
let __settingsPutInFlight = null;

// Local fallback storage for settings when server API is unavailable
const LOCAL_SETTINGS_KEY = 'settingsLocal';
function readLocalSettings() {
  try {
    const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function writeLocalSettings(data) {
  try { localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(data || {})); } catch {}
}

// Helper: fetch with fallback from namespaced API to root API
// Falls back on 404, 5xx, or network errors to improve resiliency under subdirectory deployments
async function requestWithFallback(endpoint, options) {
  const primaryUrl = `${API}${endpoint}`;
  let resp1 = null;
  try { resp1 = await fetch(primaryUrl, options || {}); } catch { resp1 = null; }
  if (resp1 && resp1.ok) return resp1;
  const status1 = resp1 ? resp1.status : 0;
  // If namespaced API fails (404, 5xx) or network error, try root fallback
  if ((status1 === 404 || status1 >= 500 || !resp1) && API) {
    let resp2 = null;
    try { resp2 = await fetch(endpoint, options || {}); } catch { resp2 = null; }
    if (resp2 && resp2.ok) return resp2;
    if (resp2 && resp2.status === 404) return null; // definitively unavailable
    return resp2 || null; // propagate other errors or network issue
  }
  if (resp1 && resp1.status === 404) return null; // definitively unavailable
  return resp1; // propagate other errors
}

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
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  };
  const resp = await requestWithFallback('/api/register', options);
  if (resp === null || !resp.ok) throw new Error('register failed');
  return resp.json();
}

export async function login(email, password) {
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  };
  const resp = await requestWithFallback('/api/login', options);
  if (resp === null || !resp.ok) throw new Error('login failed');
  const data = await resp.json();
  localStorage.setItem('authToken', data.token);
  return data;
}

export async function me() {
  const resp = await requestWithFallback('/api/me', { headers: authHeaders() });
  if (resp === null || !resp.ok) throw new Error('me failed');
  return resp.json();
}

export async function getBudgets() {
  const resp = await requestWithFallback('/api/budgets', { headers: authHeaders() });
  if (resp === null || !resp.ok) throw new Error('budgets failed');
  return resp.json();
}

export async function createBudget(name) {
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  };
  const resp = await requestWithFallback('/api/budgets', options);
  if (resp === null || !resp.ok) throw new Error('create budget failed');
  return resp.json();
}

export async function updateBudget(id, name) {
  const options = {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  };
  const resp = await requestWithFallback(`/api/budgets/${id}`, options);
  if (resp === null || !resp.ok) throw new Error('update budget failed');
  return resp.json();
}

export async function deleteBudget(id) {
  const resp = await requestWithFallback(`/api/budgets/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (resp === null || !resp.ok) {
    const err = new Error(data?.error || 'delete budget failed');
    err.code = data?.error;
    throw err;
  }
  return data;
}

export async function inviteMember(budgetId, email, role = 'editor') {
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ email, role }),
  };
  const resp = await requestWithFallback(`/api/budgets/${budgetId}/members`, options);
  if (resp === null || !resp.ok) throw new Error('invite failed');
  return resp.json();
}

export async function acceptInvite(token) {
  const resp = await requestWithFallback(`/api/invitations/${token}/accept`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  if (resp === null || !resp.ok) throw new Error('accept invite failed');
  return resp.json();
}

export async function pullTransactions() {
  const budgetId = Number(localStorage.getItem('activeBudgetId'));
  const endpoint = new URL('/api/transactions', location.origin);
  if (budgetId) endpoint.searchParams.set('budgetId', String(budgetId));
  const pathWithQuery = endpoint.pathname + endpoint.search;
  const resp = await requestWithFallback(pathWithQuery, { headers: authHeaders() });
  if (resp === null || !resp.ok) throw new Error('pull failed');
  // Сервер не возвращает мягко удалённые записи; просто отдаём активные
  return resp.json();
}

export async function pushTransactions(items) {
  const budgetId = Number(localStorage.getItem('activeBudgetId'));
  // Отправляем только локальные записи, чтобы избежать дубликатов
  // Включаем локальные новые и локальные пометки deletedAt (tombstones)
  const raw = Array.isArray(items) ? items.filter((it) => it.origin !== 'server' || it.deletedAt) : [];
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
      String(it.time || ''),
      String(it.createdAt || ''),
    ].join('|').toLowerCase();
    const contentHash = await sha256Hex(base);
    const idempotencyKey = `${Number(budgetId)}:${contentHash}:${String(it.amount)}:${String(it.date)}:${String(it.time || '')}:${String(it.createdAt || '')}`;
    toSend.push({
      clientId: it.id,
      type: it.type,
      amount: it.amount,
      category: it.category,
      member: it.member,
      source: it.source,
      note: it.note,
      date: it.date,
      time: it.time || null,
      createdAt: it.createdAt || null,
      budgetId,
      contentHash,
      idempotencyKey,
      // Передаём tombstone, если локально помечено удалённым
      deletedAt: it.deletedAt || null,
    });
  }
  const resp = await requestWithFallback('/api/transactions/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ budgetId, items: toSend }),
  });
  if (resp === null || !resp.ok) throw new Error('push failed');
  try {
    const data = await resp.json();
    // Сервер возвращает { created, duplicates, updated, mapping }
    return data || { created: [], duplicates: [], updated: [], mapping: [] };
  } catch {
    return { created: [], duplicates: [], updated: [], mapping: [] };
  }
}

export async function getMeta() {
  const resp = await requestWithFallback('/api/meta');
  if (resp === null || !resp.ok) return { members: [], sources: [] };
  return resp.json();
}

// --- Budget-scoped metadata (preferred) with fallback to per-user settings ---
export async function getBudgetMeta(budgetId) {
  try {
    const id = Number(budgetId || localStorage.getItem('activeBudgetId')) || 0;
    if (!id) return { categories: [], members: [], sources: [] };
    const resp = await requestWithFallback(`/api/budgets/${id}/meta`, { headers: { ...authHeaders() } });
    if (resp === null) {
      const s = await getSettings().catch(() => ({}));
      const bundle = (s && s.metaByBudget && s.metaByBudget[String(id)]) || {};
      return {
        categories: Array.isArray(bundle.categories) ? bundle.categories : [],
        members: Array.isArray(bundle.members) ? bundle.members : [],
        sources: Array.isArray(bundle.sources) ? bundle.sources : [],
      };
    }
    if (!resp.ok) throw new Error('get budget meta failed');
    const ct = String(resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) {
      const s = await getSettings().catch(() => ({}));
      const bundle = (s && s.metaByBudget && s.metaByBudget[String(id)]) || {};
      return {
        categories: Array.isArray(bundle.categories) ? bundle.categories : [],
        members: Array.isArray(bundle.members) ? bundle.members : [],
        sources: Array.isArray(bundle.sources) ? bundle.sources : [],
      };
    }
    const data = await resp.json().catch(() => null);
    const bundle = data && typeof data === 'object' ? data : {};
    return {
      categories: Array.isArray(bundle.categories) ? bundle.categories : [],
      members: Array.isArray(bundle.members) ? bundle.members : [],
      sources: Array.isArray(bundle.sources) ? bundle.sources : [],
    };
  } catch (e) {
    console.warn('getBudgetMeta failed, fallback to settings', e);
    const id = Number(budgetId || localStorage.getItem('activeBudgetId')) || 0;
    const s = await getSettings().catch(() => ({}));
    const bundle = (s && s.metaByBudget && s.metaByBudget[String(id)]) || {};
    return {
      categories: Array.isArray(bundle.categories) ? bundle.categories : [],
      members: Array.isArray(bundle.members) ? bundle.members : [],
      sources: Array.isArray(bundle.sources) ? bundle.sources : [],
    };
  }
}

export async function putBudgetMeta(budgetId, bundle) {
  const next = {
    categories: Array.isArray(bundle?.categories) ? bundle.categories : [],
    members: Array.isArray(bundle?.members) ? bundle.members : [],
    sources: Array.isArray(bundle?.sources) ? bundle.sources : [],
  };
  const id = Number(budgetId || localStorage.getItem('activeBudgetId')) || 0;
  if (!id) return next;
  try {
    const options = {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(next),
    };
    const resp = await requestWithFallback(`/api/budgets/${id}/meta`, options);
    if (resp === null) {
      // Fallback to settings storage
      const s = await getSettings().catch(() => ({}));
      const out = { ...(s || {}) };
      out.metaByBudget = out.metaByBudget && typeof out.metaByBudget === 'object' ? out.metaByBudget : {};
      out.metaByBudget[String(id)] = next;
      await putSettings(out);
      return next;
    }
    if (!resp.ok) throw new Error('put budget meta failed');
    if (resp.status === 204) return next;
    const ct = String(resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) return next;
    const dataOut = await resp.json().catch(() => ({}));
    return {
      categories: Array.isArray(dataOut.categories) ? dataOut.categories : next.categories,
      members: Array.isArray(dataOut.members) ? dataOut.members : next.members,
      sources: Array.isArray(dataOut.sources) ? dataOut.sources : next.sources,
    };
  } catch (e) {
    console.warn('putBudgetMeta failed, fallback to settings', e);
    const s = await getSettings().catch(() => ({}));
    const out = { ...(s || {}) };
    out.metaByBudget = out.metaByBudget && typeof out.metaByBudget === 'object' ? out.metaByBudget : {};
    out.metaByBudget[String(id)] = next;
    await putSettings(out);
    return next;
  }
}

// --- Per‑user settings helpers ---
export async function getSettings() {
  if (__settingsApiAvailable === false) return readLocalSettings();
  if (__settingsGetInFlight) return __settingsGetInFlight;
  __settingsGetInFlight = (async () => {
    try {
      const resp = await requestWithFallback('/api/settings', { headers: { ...authHeaders() } });
      if (resp === null) { __settingsApiAvailable = false; return readLocalSettings(); }
      if (!resp.ok) { __settingsApiAvailable = false; throw new Error('settings get failed'); }
      const ct = String(resp.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('application/json')) {
        // Эндпоинт не реализован корректно (например, возвращает HTML/текст)
        __settingsApiAvailable = false;
        return readLocalSettings();
      }
      try {
        const data = await resp.json();
        const isObj = data && typeof data === 'object';
        __settingsApiAvailable = !!isObj;
        const out = isObj ? data : {};
        // Сохраним локально копию для офлайна
        writeLocalSettings(out);
        return out;
      } catch (parseErr) {
        __settingsApiAvailable = false;
        return readLocalSettings();
      }
    } catch (e) {
      // Gracefully degrade to empty settings on error
      console.warn('settings get failed', e);
      return readLocalSettings();
    }
  })();
  try {
    const res = await __settingsGetInFlight;
    return res;
  } finally {
    __settingsGetInFlight = null;
  }
}

export async function putSettings(data) {
  if (__settingsApiAvailable === false) { writeLocalSettings(data || {}); return data || {}; }
  if (__settingsPutInFlight) return __settingsPutInFlight;
  __settingsPutInFlight = (async () => {
    try {
      const options = {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data || {}),
      };
      const resp = await requestWithFallback('/api/settings', options);
      if (resp === null) { __settingsApiAvailable = false; writeLocalSettings(data || {}); return data || {}; }
      if (!resp.ok) { __settingsApiAvailable = false; throw new Error('settings put failed'); }
      // Некоторые реализации могут возвращать 204 No Content
      if (resp.status === 204) { __settingsApiAvailable = true; writeLocalSettings(data || {}); return {}; }
      const ct = String(resp.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('application/json')) { __settingsApiAvailable = false; writeLocalSettings(data || {}); return data || {}; }
      try {
        const dataOut = await resp.json();
        __settingsApiAvailable = true;
        writeLocalSettings(dataOut || {});
        return dataOut || {};
      } catch (parseErr) {
        __settingsApiAvailable = false;
        writeLocalSettings(data || {});
        return data || {};
      }
    } catch (e) {
      console.warn('settings put failed', e);
      writeLocalSettings(data || {});
      return data || {};
    }
  })();
  try {
    const res = await __settingsPutInFlight;
    return res;
  } finally {
    __settingsPutInFlight = null;
  }
}

// --- Real‑time subscription via SSE ---
export function subscribeEvents(budgetId) {
  const token = localStorage.getItem('authToken');
  const url = new URL(`${API}/api/events`, location.origin);
  if (budgetId) url.searchParams.set('budgetId', String(budgetId));
  if (token) url.searchParams.set('token', token);
  // EventSource не поддерживает кастомные заголовки, поэтому токен передаём в query
  const es = new EventSource(url.toString());
  return es;
}

// Удаление на сервере: мягко выставляет deletedAt
export async function deleteServerTransaction(id) {
  const resp = await requestWithFallback(`/api/transactions/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (resp === null || !resp.ok) {
    const err = new Error(data?.error || 'delete tx failed');
    err.code = data?.error;
    throw err;
  }
  return data;
}