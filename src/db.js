const DB_NAME = 'pwa-budget';
const STORE = 'transactions';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
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

export async function addTransaction(item) {
  item.amount = Number(item.amount || 0);
  item.date = item.date || new Date().toISOString().slice(0, 10);
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

export async function exportToJSON() {
  const items = await getAllTransactions();
  return JSON.stringify(items, null, 2);
}

export async function importFromJSON(file) {
  const text = await file.text();
  let items = [];
  try { items = JSON.parse(text); } catch {}
  if (!Array.isArray(items)) return;
  for (const it of items) {
    const { type, amount, category, note, date } = it;
    await addTransaction({ type, amount, category, note, date });
  }
}