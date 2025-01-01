import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import http from 'http';

const app = express();
app.use(cors());
app.use(express.json());
// Rewrite namespaced API (e.g., /money/api/*) to root /api/* to support subdirectory deployments
app.use((req, res, next) => {
  try {
    if (typeof req.url === 'string') {
      const m = req.url.match(/^\/(money|budget|pwa-budget)\/api(\/.*)?$/);
      if (m) {
        const rest = m[2] || '';
        req.url = `/api${rest}`;
      }
    }
  } catch {}
  next();
});

// Store server data inside this project to avoid cross-project coupling
const DATA_DIR = path.resolve('./projects/pwa-budget/server/data');
const FILE = path.join(DATA_DIR, 'transactions.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BUDGETS_FILE = path.join(DATA_DIR, 'budgets.json');
const INVITES_FILE = path.join(DATA_DIR, 'invitations.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BUDGET_META_FILE = path.join(DATA_DIR, 'budget_meta.json');

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]');
  if (!fs.existsSync(META_FILE)) fs.writeFileSync(META_FILE, JSON.stringify({
    members: ['Семья', 'Я', 'Партнёр'],
    sources: ['Основной', 'Зарплата', 'Премия', 'Фриланс']
  }, null, 2));
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(BUDGETS_FILE)) fs.writeFileSync(BUDGETS_FILE, '[]');
  if (!fs.existsSync(INVITES_FILE)) fs.writeFileSync(INVITES_FILE, '[]');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '[]');
  if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, '[]');
  if (!fs.existsSync(BUDGET_META_FILE)) fs.writeFileSync(BUDGET_META_FILE, '{}');
}
ensureFiles();

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function readTransactions() { return readJSON(FILE, []); }
function writeTransactions(arr) { writeJSON(FILE, arr); }
function readMeta() { return readJSON(META_FILE, { members: [], sources: [] }); }
function writeMeta(meta) { writeJSON(META_FILE, meta); }
function readUsers() { return readJSON(USERS_FILE, []); }
function writeUsers(arr) { writeJSON(USERS_FILE, arr); }
function readBudgets() { return readJSON(BUDGETS_FILE, []); }
function writeBudgets(arr) { writeJSON(BUDGETS_FILE, arr); }
function readInvites() { return readJSON(INVITES_FILE, []); }
function writeInvites(arr) { writeJSON(INVITES_FILE, arr); }
function readSessions() { return readJSON(SESSIONS_FILE, []); }
function writeSessions(arr) { writeJSON(SESSIONS_FILE, arr); }
function readSettings() { return readJSON(SETTINGS_FILE, []); }
function writeSettings(arr) { writeJSON(SETTINGS_FILE, arr); }
function readBudgetMetaStore() { return readJSON(BUDGET_META_FILE, {}); }
function writeBudgetMetaStore(obj) { writeJSON(BUDGET_META_FILE, obj); }

function makeSalt() { return crypto.randomBytes(16).toString('hex'); }
function hashPassword(password, salt) { return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex'); }
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'no_token' });
  const sessions = readSessions();
  const session = sessions.find(s => s.token === token);
  if (!session) return res.status(401).json({ error: 'invalid_token' });
  if (session.expiresAt && Date.now() > session.expiresAt) return res.status(401).json({ error: 'expired_token' });
  const user = readUsers().find(u => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'user_not_found' });
  req.user = { id: user.id, email: user.email, name: user.name };
  next();
}

app.get('/api/meta', (req, res) => {
  res.json(readMeta());
});

// --- Proxy to CoinGecko to avoid browser CORS ---
function proxyJson(url, res) {
  const client = url.startsWith('https') ? https : http;
  const req = client.get(url, { headers: { 'User-Agent': 'pwa-budget/1.0' } }, (upstream) => {
    let data = '';
    upstream.on('data', (chunk) => { data += chunk; });
    upstream.on('end', () => {
      try {
        const json = JSON.parse(data);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        res.json(json);
      } catch (e) {
        res.status(502).json({ error: 'bad_json', message: String(e && e.message || e) });
      }
    });
  });
  req.on('error', (err) => {
    res.status(502).json({ error: 'upstream_error', message: String(err && err.message || err) });
  });
}

// GET /api/crypto/coins-list
app.get('/api/crypto/coins-list', (req, res) => {
  const url = 'https://api.coingecko.com/api/v3/coins/list';
  proxyJson(url, res);
});

// GET /api/crypto/simple-price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true
app.get('/api/crypto/simple-price', (req, res) => {
  const ids = typeof req.query.ids === 'string' ? req.query.ids : '';
  const vs = typeof req.query.vs_currencies === 'string' ? req.query.vs_currencies : 'usd';
  const ch = req.query.include_24hr_change ? 'true' : 'true';
  // Encode each id separately but keep commas unencoded to match Coingecko examples
  const idsParam = ids
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => encodeURIComponent(s))
    .join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=${ch}`;
  proxyJson(url, res);
});

// --- Real‑time via Server‑Sent Events (SSE) ---
// Подписка клиентов на события по конкретному бюджету
const clientsByBudget = new Map(); // Map<number, Set<res>>

function addSseClient(budgetId, res) {
  const key = Number(budgetId);
  const set = clientsByBudget.get(key) || new Set();
  set.add(res);
  clientsByBudget.set(key, set);
}

function removeSseClient(budgetId, res) {
  const key = Number(budgetId);
  const set = clientsByBudget.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clientsByBudget.delete(key);
}

function broadcastBudget(budgetId, event, payload) {
  const key = Number(budgetId);
  const set = clientsByBudget.get(key);
  if (!set || set.size === 0) return;
  const data = `event: ${event}\n` + `data: ${JSON.stringify(payload || {})}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { /* ignore write errors */ }
  }
}

// SSE endpoint: допускает токен в хедерах или как query (?token=...)
app.get('/api/events', (req, res) => {
  const auth = req.headers['authorization'] || '';
  const headerToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const token = headerToken || queryToken;
  if (!token) return res.status(401).json({ error: 'no_token' });

  const sessions = readSessions();
  const session = sessions.find(s => s.token === token);
  if (!session) return res.status(401).json({ error: 'invalid_token' });
  if (session.expiresAt && Date.now() > session.expiresAt) return res.status(401).json({ error: 'expired_token' });
  const user = readUsers().find(u => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'user_not_found' });

  const budgetId = Number(req.query.budgetId);
  const budget = getBudgetIfMember(budgetId, user.id);
  if (!budget) return res.status(403).json({ error: 'forbidden' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Отправим приветственное событие
  res.write(`event: hello\ndata: {"status":"connected"}\n\n`);
  // Периодический ping, чтобы соединение не закрывалось прокси
  const heartbeat = setInterval(() => {
    try { res.write(`event: ping\ndata: {}\n\n`); } catch { /* ignore */ }
  }, 30000);

  addSseClient(budgetId, res);
  req.on('close', () => {
    clearInterval(heartbeat);
    removeSseClient(budgetId, res);
  });
});

// --- Auth ---
app.post('/api/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'invalid_payload' });
  const users = readUsers();
  if (users.find(u => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: 'email_exists' });
  }
  const id = (users[users.length - 1]?.id || 0) + 1;
  const salt = makeSalt();
  const hash = hashPassword(password, salt);
  const user = { id, email, name: name || '', password: { salt, hash }, createdAt: Date.now() };
  users.push(user);
  writeUsers(users);
  return res.status(201).json({ id, email, name: user.name });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'invalid_payload' });
  const users = readUsers();
  const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = user.password?.hash === hashPassword(password, user.password?.salt || '');
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const sessions = readSessions();
  const token = makeToken();
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
  sessions.push({ token, userId: user.id, createdAt: Date.now(), expiresAt });
  writeSessions(sessions);
  return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// --- Per-user Settings ---
// Stored as array of { userId, data, updatedAt }
app.get('/api/settings', authMiddleware, (req, res) => {
  const all = readSettings();
  const found = all.find(s => s.userId === req.user.id);
  res.json(found?.data || {});
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const payload = (req.body && typeof req.body === 'object') ? req.body : {};
  const all = readSettings();
  const idx = all.findIndex(s => s.userId === req.user.id);
  const row = { userId: req.user.id, data: payload, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = row; else all.push(row);
  writeSettings(all);
  res.json(row.data);
});

// --- Budgets ---
app.get('/api/budgets', authMiddleware, (req, res) => {
  const budgets = readBudgets().filter(b => b.ownerId === req.user.id || (Array.isArray(b.members) && b.members.some(m => m.userId === req.user.id)));
  res.json(budgets);
});

app.post('/api/budgets', authMiddleware, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'invalid_payload' });
  const budgets = readBudgets();
  const id = (budgets[budgets.length - 1]?.id || 0) + 1;
  const budget = { id, name, ownerId: req.user.id, members: [], createdAt: Date.now() };
  budgets.push(budget);
  writeBudgets(budgets);
  res.status(201).json(budget);
});

// Обновление бюджета (только владелец)
app.put('/api/budgets/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const budgets = readBudgets();
  const idx = budgets.findIndex(b => b.id === id);
  const budget = budgets[idx];
  if (!budget) return res.status(404).json({ error: 'not_found' });
  if (budget.ownerId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const { name } = req.body || {};
  if (typeof name === 'string' && name.trim().length > 0) {
    budget.name = name.trim();
  }
  budgets[idx] = budget;
  writeBudgets(budgets);
  res.json(budget);
});

// Удаление бюджета (только владелец) + очистка связанных данных
app.delete('/api/budgets/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const budgets = readBudgets();
  const idx = budgets.findIndex(b => b.id === id);
  const budget = budgets[idx];
  if (!budget) return res.status(404).json({ error: 'not_found' });
  if (budget.ownerId !== req.user.id) return res.status(403).json({ error: 'forbidden' });

  // Удаляем транзакции этого бюджета
  const remainingTx = readTransactions().filter(it => Number(it.budgetId) !== id);
  writeTransactions(remainingTx);

  // Удаляем приглашения этого бюджета
  const remainingInv = readInvites().filter(inv => Number(inv.budgetId) !== id);
  writeInvites(remainingInv);

  // Удаляем сам бюджет
  const nextBudgets = budgets.filter(b => b.id !== id);
  writeBudgets(nextBudgets);

  res.json({ status: 'deleted' });
});

function getBudgetIfMember(budgetId, userId) {
  const budget = readBudgets().find(b => b.id === Number(budgetId));
  if (!budget) return null;
  if (budget.ownerId === userId) return budget;
  if (Array.isArray(budget.members) && budget.members.some(m => m.userId === userId)) return budget;
  return null;
}

app.get('/api/budgets/:id', authMiddleware, (req, res) => {
  const budget = getBudgetIfMember(req.params.id, req.user.id);
  if (!budget) return res.status(404).json({ error: 'not_found' });
  res.json(budget);
});

// --- Budget metadata (categories/members/sources) ---
// Stored as a map { [budgetId]: { categories:[], members:[], sources:[], updatedAt } }
app.get('/api/budgets/:id/meta', authMiddleware, (req, res) => {
  const budgetId = Number(req.params.id);
  const budget = getBudgetIfMember(budgetId, req.user.id);
  if (!budget) return res.status(403).json({ error: 'forbidden' });
  const store = readBudgetMetaStore();
  const bundle = store[String(budgetId)] || {};
  res.json({
    categories: Array.isArray(bundle.categories) ? bundle.categories : [],
    members: Array.isArray(bundle.members) ? bundle.members : [],
    sources: Array.isArray(bundle.sources) ? bundle.sources : [],
    updatedAt: bundle.updatedAt || 0,
  });
});

app.put('/api/budgets/:id/meta', authMiddleware, (req, res) => {
  const budgetId = Number(req.params.id);
  const budget = getBudgetIfMember(budgetId, req.user.id);
  if (!budget) return res.status(403).json({ error: 'forbidden' });
  const payload = (req.body && typeof req.body === 'object') ? req.body : {};
  const next = {
    categories: Array.isArray(payload.categories) ? payload.categories : [],
    members: Array.isArray(payload.members) ? payload.members : [],
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    updatedAt: Date.now(),
  };
  const store = readBudgetMetaStore();
  store[String(budgetId)] = next;
  writeBudgetMetaStore(store);
  try { broadcastBudget(budgetId, 'update', { budgetId, op: 'meta' }); } catch {}
  res.json(next);
});

app.post('/api/budgets/:id/members', authMiddleware, (req, res) => {
  const { email, role } = req.body || {};
  const budgets = readBudgets();
  const idx = budgets.findIndex(b => b.id === Number(req.params.id));
  const budget = budgets[idx];
  if (!budget) return res.status(404).json({ error: 'not_found' });
  if (budget.ownerId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const users = readUsers();
  const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
  if (user) {
    const exists = (budget.members || []).some(m => m.userId === user.id);
    if (!exists) {
      budget.members = budget.members || [];
      budget.members.push({ userId: user.id, role: role || 'editor' });
      budgets[idx] = budget;
      writeBudgets(budgets);
    }
    return res.json({ status: 'added', userId: user.id });
  } else {
    const invites = readInvites();
    const token = makeToken();
    const invite = { id: (invites[invites.length - 1]?.id || 0) + 1, budgetId: budget.id, email, role: role || 'editor', invitedBy: req.user.id, status: 'pending', token, createdAt: Date.now(), expiresAt: Date.now() + 1000*60*60*24*7 };
    invites.push(invite);
    writeInvites(invites);
    return res.json({ status: 'invited', token });
  }
});

app.post('/api/invitations/:token/accept', authMiddleware, (req, res) => {
  const invites = readInvites();
  const invite = invites.find(i => i.token === req.params.token);
  if (!invite) return res.status(404).json({ error: 'not_found' });
  if (invite.expiresAt && Date.now() > invite.expiresAt) return res.status(400).json({ error: 'expired' });
  const budgets = readBudgets();
  const budget = budgets.find(b => b.id === invite.budgetId);
  if (!budget) return res.status(404).json({ error: 'budget_not_found' });
  budget.members = budget.members || [];
  const exists = budget.members.some(m => m.userId === req.user.id);
  if (!exists) budget.members.push({ userId: req.user.id, role: invite.role || 'editor' });
  writeBudgets(budgets);
  invite.status = 'accepted';
  writeInvites(invites);
  res.json({ status: 'accepted', budgetId: budget.id });
});

app.post('/api/invitations/:token/decline', authMiddleware, (req, res) => {
  const invites = readInvites();
  const invite = invites.find(i => i.token === req.params.token);
  if (!invite) return res.status(404).json({ error: 'not_found' });
  invite.status = 'declined';
  writeInvites(invites);
  res.json({ status: 'declined' });
});

app.get('/api/transactions', authMiddleware, (req, res) => {
  const budgetId = Number(req.query.budgetId);
  const budget = getBudgetIfMember(budgetId, req.user.id);
  if (!budget) return res.status(403).json({ error: 'forbidden' });
  // Возвращаем только активные записи (без мягко удалённых)
  const items = readTransactions().filter(it => Number(it.budgetId) === budgetId && !it.deletedAt);
  res.json(items);
});

app.post('/api/transactions', authMiddleware, (req, res) => {
  const { budgetId } = req.body || {};
  const budget = getBudgetIfMember(budgetId, req.user.id);
  if (!budget) return res.status(403).json({ error: 'forbidden' });
  const items = readTransactions();
  const id = (items[items.length - 1]?.id || 0) + 1;
  const item = { id, ...(req.body || {}), budgetId: Number(budgetId), createdBy: req.user.id };
  items.push(item);
  writeTransactions(items);
  // Уведомляем подписчиков этого бюджета
  try { broadcastBudget(item.budgetId, 'update', { budgetId: item.budgetId, id: item.id, op: 'create' }); } catch {}
  res.status(201).json(item);
});

// Хелпер для вычисления contentHash, если он не передан клиентом
function calcContentHash(it) {
  const base = [
    String(it.type || ''),
    String(it.amount || ''),
    String(it.category || ''),
    String(it.member || ''),
    String(it.source || ''),
    String(it.date || ''),
    String(it.note || ''),
  ].join('|').toLowerCase();
  return crypto.createHash('sha256').update(base).digest('hex');
}

app.post('/api/transactions/bulk', authMiddleware, (req, res) => {
  const { budgetId, items } = req.body || {};
  const budget = getBudgetIfMember(budgetId, req.user.id);
  if (!budget) return res.status(403).json({ error: 'forbidden' });

  const incoming = Array.isArray(items) ? items : [];
  const all = readTransactions();
  let nextId = (all[all.length - 1]?.id || 0) + 1;

  // Индекс существующих записей по budgetId+contentHash для дедупликации
  const byKey = new Map();
  for (const t of all) {
    const ch = t.contentHash || calcContentHash(t);
    byKey.set(`${Number(t.budgetId)}:${ch}:${String(t.amount)}:${String(t.date)}`, t);
  }

  const created = [];
  const duplicates = [];
  const updated = [];
  const mapping = [];

  for (const raw of incoming) {
    const contentHash = raw.contentHash || calcContentHash(raw);
    const key = `${Number(budgetId)}:${contentHash}:${String(raw.amount)}:${String(raw.date)}`;
    const clientId = raw.clientId != null ? Number(raw.clientId) : undefined;
    const idempotencyKey = raw.idempotencyKey || key; // простой идемпотентный ключ
    const existing = byKey.get(key);

    // Мягкое удаление: если пришёл deletedAt, обновим существующую запись или сохраним как новую
    if (existing) {
      // Идёмпотентность: если ключ совпадает, считаем дублем
      if (existing.idempotencyKey === idempotencyKey || existing.contentHash === contentHash) {
        // Если передан deletedAt и он не установлен на сервере — пометим
        if (raw.deletedAt && !existing.deletedAt) {
          existing.deletedAt = raw.deletedAt;
          updated.push(existing);
        } else {
          duplicates.push(existing);
        }
        mapping.push({ clientId, serverId: existing.id });
        continue;
      }
    }

    // Создаём новую запись
    const item = {
      id: nextId++,
      type: raw.type,
      amount: raw.amount,
      category: raw.category,
      member: raw.member,
      source: raw.source,
      note: raw.note,
      date: raw.date,
      budgetId: Number(budgetId),
      createdBy: req.user.id,
      contentHash,
      idempotencyKey,
      deletedAt: raw.deletedAt || null,
    };
    all.push(item);
    byKey.set(key, item);
    created.push(item);
    mapping.push({ clientId, serverId: item.id });
  }

  writeTransactions(all);
  try { broadcastBudget(budgetId, 'update', { budgetId: Number(budgetId), count: created.length, op: 'bulk' }); } catch {}
  res.status(200).json({ created, duplicates, updated, mapping });
});

// Мягкое удаление: выставляем deletedAt вместо физического удаления
app.delete('/api/transactions/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const items = readTransactions();
  const item = items.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const budget = getBudgetIfMember(item.budgetId, req.user.id);
  if (!budget) return res.status(403).json({ error: 'forbidden' });
  item.deletedAt = item.deletedAt || Date.now();
  writeTransactions(items);
  try { broadcastBudget(item.budgetId, 'update', { budgetId: item.budgetId, id: item.id, op: 'soft_delete' }); } catch {}
  res.status(200).json({ id: item.id, deletedAt: item.deletedAt });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8050;
const srv = app.listen(PORT, () => {
  try {
    const addr = srv.address();
    const host = (addr && typeof addr === 'object' && addr.address) ? addr.address : '0.0.0.0';
    const shownHost = host === '::' ? '0.0.0.0' : host;
    console.log(`PWA Budget API listening on port ${PORT} (host ${shownHost})`);
  } catch {
    console.log(`PWA Budget API listening on port ${PORT}`);
  }
});