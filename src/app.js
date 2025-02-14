import { addTransaction, getAllTransactions, deleteTransaction, clearTransactions, exportToJSON, importFromJSON } from './db.js';
import { setCategories, readForm, clearForm, renderList, renderSummary } from './ui.js';

const DEFAULT_CATEGORIES = ['Продукты', 'Транспорт', 'Кафе', 'Доход', 'Другое'];

function filterItems(items) {
  const cat = document.getElementById('filter-category').value;
  const from = document.getElementById('filter-from').value || '0000-01-01';
  const to = document.getElementById('filter-to').value || '9999-12-31';
  return items.filter((it) => {
    const okCat = !cat || it.category === cat;
    const d = it.date || '1970-01-01';
    return okCat && d >= from && d <= to;
  });
}

async function refresh() {
  const items = await getAllTransactions();
  const filtered = filterItems(items);
  renderList(filtered, { onDelete: handleDelete });
  renderSummary(filtered);
}

async function handleSubmit(e) {
  e.preventDefault();
  const data = readForm();
  if (!data.amount || Number(data.amount) <= 0) return;
  await addTransaction(data);
  clearForm();
  await refresh();
}

async function handleDelete(id) {
  await deleteTransaction(id);
  await refresh();
}

async function handleExport() {
  const text = await exportToJSON();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'budget.json'; a.click();
  URL.revokeObjectURL(url);
}

async function handleImport(e) {
  const file = e.target.files?.[0];
  if (file) {
    await importFromJSON(file);
    await refresh();
    e.target.value = '';
  }
}

async function handleClearAll() {
  if (confirm('Очистить все транзакции?')) {
    await clearTransactions();
    await refresh();
  }
}

export async function initApp() {
  // Категории
  setCategories([
    document.getElementById('category'),
    document.getElementById('filter-category'),
  ], DEFAULT_CATEGORIES);

  // Слушатели
  document.getElementById('transaction-form').addEventListener('submit', handleSubmit);
  document.getElementById('export-json').addEventListener('click', handleExport);
  document.getElementById('import-json').addEventListener('change', handleImport);
  document.getElementById('clear-all').addEventListener('click', handleClearAll);
  document.getElementById('clear-filters').addEventListener('click', async () => {
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-from').value = '';
    document.getElementById('filter-to').value = '';
    await refresh();
  });

  await refresh();
}