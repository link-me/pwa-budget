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
  // Точное время и штамп создания для различения идентичных по содержимому транзакций
  item.time = item.time || new Date().toISOString().slice(11, 19);
  item.createdAt = item.createdAt || Date.now();
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

export async function getTransactionById(id) {
  return withStore('readonly', (store) => {
    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  });
}

export async function deleteTransaction(id) {
  // Soft delete: mark item as deletedAt instead of removing
  return withStore('readwrite', (store) => {
    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const it = req.result;
        if (!it) {
          // Fallback: попробуем найти запись курсором, если тип ключа не совпал (string vs number)
          try {
            const curReq = store.openCursor();
            curReq.onsuccess = () => {
              const cursor = curReq.result;
              if (cursor) {
                const val = cursor.value;
                if (String(val?.id) === String(id)) {
                  val.deletedAt = val.deletedAt || Date.now();
                  try { store.put(val); } catch {}
                  resolve(val);
                  return;
                }
                cursor.continue();
              } else {
                resolve(undefined);
              }
            };
            curReq.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
          return;
        }
        it.deletedAt = it.deletedAt || Date.now();
        try { store.put(it); } catch {}
        resolve(it);
      };
      req.onerror = () => resolve(undefined);
    });
  });
}

// Hard delete for internal cleanup (e.g., after successful server push mapping)
export async function removeTransaction(id) {
  return withStore('readwrite', (store) => store.delete(id));
}

export async function clearTransactions() {
  return withStore('readwrite', (store) => store.clear());
}

export async function updateTransaction(item) {
  if (!item || item.id == null) return;
  item.amount = Number(item.amount || 0);
  return withStore('readwrite', (store) => {
    return new Promise((resolve) => {
      try {
        const req = store.get(item.id);
        req.onsuccess = () => {
          const cur = req.result || {};
          const merged = { ...cur, ...item };
          if (!merged.time) merged.time = cur.time || new Date().toISOString().slice(11, 19);
          if (!merged.createdAt) merged.createdAt = cur.createdAt || Date.now();
          try { store.put(merged); } catch {}
          resolve(merged);
        };
        req.onerror = () => { try { store.put(item); } catch {} resolve(item); };
      } catch {
        try { store.put(item); } catch {}
        resolve(item);
      }
    });
  });
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
      const { id, type, amount, category, note, date, time, createdAt, member, source, budgetId, deletedAt } = it;
      const payload = { id, type, amount, category, note, date, time, createdAt, member, source, budgetId: budgetId ?? activeBudgetId, origin: 'server', deletedAt };
      // Не перезатираем локальные tombstones: если локально запись помечена deletedAt, сохраняем это поле
      await withStore('readwrite', (store) => {
        return new Promise((resolve) => {
          if (payload.id == null) { try { store.put(payload); } catch {} resolve(); return; }
          const req = store.get(payload.id);
          req.onsuccess = () => {
            const existing = req.result;
            if (existing && existing.deletedAt) {
              payload.deletedAt = existing.deletedAt;
              try { store.put(payload); } catch {}
              resolve();
              return;
            }
            // Поиск совпадений по содержимому для случаев, когда server id отличается от local id
            try {
              let preserved = null;
              const curReq = store.openCursor();
              curReq.onsuccess = () => {
                const cursor = curReq.result;
                if (cursor) {
                  const val = cursor.value;
                  const eq = (a, b) => String(a||'').toLowerCase() === String(b||'').toLowerCase();
                  const baseSame = (
                    eq(val.type, payload.type) &&
                    Number(val.amount) === Number(payload.amount) &&
                    eq(val.category, payload.category) &&
                    eq(val.member, payload.member) &&
                    eq(val.source, payload.source) &&
                    eq(val.date, payload.date) &&
                    eq(val.note, payload.note) &&
                    Number(val.budgetId) === Number(payload.budgetId)
                  );
                  const createdMatch = (val.createdAt != null && payload.createdAt != null) ? Number(val.createdAt) === Number(payload.createdAt) : false;
                  const timeMatch = (val.time && payload.time) ? eq(val.time, payload.time) : false;
                  const same = baseSame && (createdMatch || timeMatch);
                  if (same && val.deletedAt) preserved = val.deletedAt;
                  cursor.continue();
                } else {
                  if (preserved) { try { payload.deletedAt = preserved; } catch {} }
                  try { store.put(payload); } catch {}
                  resolve();
                }
              };
              curReq.onerror = () => { try { store.put(payload); } catch {} resolve(); };
            } catch {
              try { store.put(payload); } catch {}
              resolve();
            }
          };
          req.onerror = () => { try { store.put(payload); } catch {} resolve(); };
        });
      });
    }
    return;
  }
  // Объект с meta и transactions
  if (data.meta) await saveMetaLocal(data.meta);
  const items = Array.isArray(data.transactions) ? data.transactions : [];
  for (const it of items) {
    const { id, type, amount, category, note, date, time, createdAt, member, source, budgetId, deletedAt } = it;
    const payload = { id, type, amount, category, note, date, time, createdAt, member, source, budgetId: budgetId ?? activeBudgetId, origin: 'server', deletedAt };
    // Не перезатираем локальные tombstones: если локально запись помечена deletedAt, сохраняем это поле
    await withStore('readwrite', (store) => {
      return new Promise((resolve) => {
        if (payload.id == null) { try { store.put(payload); } catch {} resolve(); return; }
        const req = store.get(payload.id);
        req.onsuccess = () => {
          const existing = req.result;
          if (existing && existing.deletedAt) {
            payload.deletedAt = existing.deletedAt;
            try { store.put(payload); } catch {}
            resolve();
            return;
          }
          // Поиск совпадений по содержимому для случаев, когда server id отличается от local id
          try {
            let preserved = null;
            const curReq = store.openCursor();
            curReq.onsuccess = () => {
              const cursor = curReq.result;
              if (cursor) {
                const val = cursor.value;
                const eq = (a, b) => String(a||'').toLowerCase() === String(b||'').toLowerCase();
                const baseSame = (
                  eq(val.type, payload.type) &&
                  Number(val.amount) === Number(payload.amount) &&
                  eq(val.category, payload.category) &&
                  eq(val.member, payload.member) &&
                  eq(val.source, payload.source) &&
                  eq(val.date, payload.date) &&
                  eq(val.note, payload.note) &&
                  Number(val.budgetId) === Number(payload.budgetId)
                );
                const createdMatch = (val.createdAt != null && payload.createdAt != null) ? Number(val.createdAt) === Number(payload.createdAt) : false;
                const timeMatch = (val.time && payload.time) ? eq(val.time, payload.time) : false;
                const same = baseSame && (createdMatch || timeMatch);
                if (same && val.deletedAt) preserved = val.deletedAt;
                cursor.continue();
              } else {
                if (preserved) { try { payload.deletedAt = preserved; } catch {} }
                try { store.put(payload); } catch {}
                resolve();
              }
            };
            curReq.onerror = () => { try { store.put(payload); } catch {} resolve(); };
          } catch {
            try { store.put(payload); } catch {}
            resolve();
          }
        };
        req.onerror = () => { try { store.put(payload); } catch {} resolve(); };
      });
    });
  }
}

// ---- Метаданные (категории/члены/источники) ----
export async function getMetaLocal() {
  const activeBudgetId = Number(localStorage?.getItem?.('activeBudgetId') || 0) || null;
  const key = activeBudgetId ? `meta:${String(activeBudgetId)}` : 'meta';
  return withStoreName(META_STORE, 'readonly', (store) => {
    return new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => {
        const val = req.result || null;
        if (val) { resolve(val); return; }
        // Фоллбек на глобальные meta
        try {
          const req2 = store.get('meta');
          req2.onsuccess = () => resolve(req2.result || { ...DEFAULT_META, id: key });
          req2.onerror = () => resolve({ ...DEFAULT_META, id: key });
        } catch {
          resolve({ ...DEFAULT_META, id: key });
        }
      };
      req.onerror = () => resolve({ ...DEFAULT_META, id: key });
    });
  });
}

export async function saveMetaLocal(meta) {
  const activeBudgetId = Number(localStorage?.getItem?.('activeBudgetId') || 0) || null;
  const key = activeBudgetId ? `meta:${String(activeBudgetId)}` : 'meta';
  const payload = { ...DEFAULT_META, ...(meta || {}), id: key };
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