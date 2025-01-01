const DB_NAME = 'pwa-budget';
const STORE = 'transactions';
const META_STORE = 'meta';

const DEFAULT_META = {
  id: 'meta',
  categories: ['Продукты', 'Транспорт', 'Кафе', 'Доход', 'Другое'],
  members: ['Семья', 'Я', 'Партнёр'],
  sources: ['Основной', 'Зарплата', 'Премия', 'Фриланс'],
};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        const ms = db.createObjectStore(META_STORE, { keyPath: 'id' });
        try { ms.put(DEFAULT_META); } catch {}
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const res = fn(store);
    tx.oncomplete = () => resolve(res);
    tx.onerror = () => reject(tx.error);
  });
}

async function withStoreName(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const res = fn(store);
    tx.oncomplete = () => resolve(res);
    tx.onerror = () => reject(tx.error);
  });
}

export async function addTransaction(item) {
  item.amount = Number(item.amount || 0);
  item.date = item.date || new Date().toISOString().slice(0, 10);
  item.member = item.member || 'Семья';
  item.source = item.source || (item.type === 'income' ? 'Зарплата' : 'Основной');
  if (!item.origin) item.origin = 'local';
  return withStore('readwrite', (store) => store.add(item));
}

export async function getAllTransactions() {
  return withStore('readonly', (store) => {
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  });
}

export async function deleteTransaction(id) {
  return withStore('readwrite', (store) => store.delete(id));
}

export async function clearTransactions() {
  return withStore('readwrite', (store) => store.clear());
}

export async function updateTransaction(item) {
  if (!item || item.id == null) return;
  item.amount = Number(item.amount || 0);
  return withStore('readwrite', (store) => store.put(item));
}

export async function exportToJSON() {
  const items = await getAllTransactions();
  return JSON.stringify(items, null, 2);
}

export async function importFromJSON(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!data) return;
  const activeBudgetId = Number(localStorage?.getItem?.('activeBudgetId')) || null;
  if (Array.isArray(data)) {
    for (const it of data) {
      const { id, type, amount, category, note, date, member, source, budgetId } = it;
      const payload = { id, type, amount, category, note, date, member, source, budgetId: budgetId ?? activeBudgetId, origin: 'server' };
      await withStore('readwrite', (store) => store.put(payload));
    }
    return;
  }
  // Объект с meta и transactions
  if (data.meta) await saveMetaLocal(data.meta);
  const items = Array.isArray(data.transactions) ? data.transactions : [];
  for (const it of items) {
    const { id, type, amount, category, note, date, member, source, budgetId } = it;
    const payload = { id, type, amount, category, note, date, member, source, budgetId: budgetId ?? activeBudgetId, origin: 'server' };
    await withStore('readwrite', (store) => store.put(payload));
  }
}

// ---- Метаданные (категории/члены/источники) ----
export async function getMetaLocal() {
  return withStoreName(META_STORE, 'readonly', (store) => {
    return new Promise((resolve) => {
      const req = store.get('meta');
      req.onsuccess = () => resolve(req.result || { ...DEFAULT_META });
      req.onerror = () => resolve({ ...DEFAULT_META });
    });
  });
}

export async function saveMetaLocal(meta) {
  const payload = { ...DEFAULT_META, ...(meta || {}), id: 'meta' };
  return withStoreName(META_STORE, 'readwrite', (store) => store.put(payload));
}

export async function addCategory(name) {
  if (!name) return getMetaLocal();
  const meta = await getMetaLocal();
  if (!meta.categories.includes(name)) meta.categories.push(name);
  await saveMetaLocal(meta);
  return meta;
}

export async function renameCategory(oldName, newName) {
  if (!oldName || !newName) return getMetaLocal();
  const meta = await getMetaLocal();
  const idx = meta.categories.indexOf(oldName);
  if (idx >= 0) meta.categories[idx] = newName;
  await saveMetaLocal(meta);
  return meta;
}

export async function deleteCategoryMeta(name) {
  if (!name) return getMetaLocal();
  const meta = await getMetaLocal();
  meta.categories = meta.categories.filter((c) => c !== name);
  await saveMetaLocal(meta);
  return meta;
}

export async function addMember(name) {
  if (!name) return getMetaLocal();
  const meta = await getMetaLocal();
  if (!meta.members.includes(name)) meta.members.push(name);
  await saveMetaLocal(meta);
  return meta;
}

export async function renameMember(oldName, newName) {
  if (!oldName || !newName) return getMetaLocal();
  const meta = await getMetaLocal();
  const idx = meta.members.indexOf(oldName);
  if (idx >= 0) meta.members[idx] = newName;
  await saveMetaLocal(meta);
  return meta;
}

export async function deleteMemberMeta(name) {
  if (!name) return getMetaLocal();
  const meta = await getMetaLocal();
  meta.members = meta.members.filter((m) => m !== name);
  await saveMetaLocal(meta);
  return meta;
}

export async function addSource(name) {
  if (!name) return getMetaLocal();
  const meta = await getMetaLocal();
  if (!meta.sources.includes(name)) meta.sources.push(name);
  await saveMetaLocal(meta);
  return meta;
}

export async function renameSource(oldName, newName) {
  if (!oldName || !newName) return getMetaLocal();
  const meta = await getMetaLocal();
  const idx = meta.sources.indexOf(oldName);
  if (idx >= 0) meta.sources[idx] = newName;
  await saveMetaLocal(meta);
  return meta;
}

export async function deleteSourceMeta(name) {
  if (!name) return getMetaLocal();
  const meta = await getMetaLocal();
  meta.sources = meta.sources.filter((s) => s !== name);
  await saveMetaLocal(meta);
  return meta;
}