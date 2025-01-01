import { addTransaction, getAllTransactions, deleteTransaction, clearTransactions, exportToJSON, importFromJSON, getMetaLocal, addCategory, renameCategory, deleteCategoryMeta, addMember, renameMember, deleteMemberMeta, addSource, renameSource, deleteSourceMeta, saveMetaLocal, updateTransaction } from './db.js';
import { setCategories, setMembers, setSources, readForm, clearForm, renderList, renderSummary } from './ui.js';
import * as charts from './charts.js?v=7';
import { pullTransactions, pushTransactions, getMeta, register, login, me, getBudgets, createBudget, inviteMember, acceptInvite, updateBudget, subscribeEvents } from './sync.js?v=5';

const DEFAULT_CATEGORIES = ['Продукты', 'Транспорт', 'Кафе', 'Доход', 'Другое'];
const DEFAULT_MEMBERS = ['Семья', 'Я', 'Партнёр'];
const DEFAULT_SOURCES = ['Основной', 'Зарплата', 'Премия', 'Фриланс'];

function filterItems(items) {
  const cat = document.getElementById('filter-category').value;
  const member = document.getElementById('filter-member').value;
  const source = document.getElementById('filter-source').value;
  const from = document.getElementById('filter-from').value || '0000-01-01';
  const to = document.getElementById('filter-to').value || '9999-12-31';
  const activeBudgetId = Number(localStorage.getItem('activeBudgetId')) || null;
  return items.filter((it) => {
    const okCat = !cat || it.category === cat;
    const okMember = !member || it.member === member;
    const okSource = !source || it.source === source;
    const d = it.date || '1970-01-01';
    const okBudget = !activeBudgetId || Number(it.budgetId || 0) === activeBudgetId;
    return okCat && okMember && okSource && okBudget && d >= from && d <= to;
  });
}

async function refresh() {
  const items = await getAllTransactions();
  const filtered = filterItems(items);
  renderList(filtered, { onDelete: handleDelete, onEdit: handleEdit });
  renderSummary(filtered);
  charts.drawMonthlyChart(document.getElementById('chart-monthly'), filtered);
  charts.drawCategoryChart(document.getElementById('chart-categories'), filtered);
  attachChartTooltip(document.getElementById('chart-monthly'));
  attachChartTooltip(document.getElementById('chart-categories'));
  // update admin bar record count
  const countEl = document.getElementById('status-count');
  if (countEl) countEl.textContent = String(filtered.length);
  // update admin bar income/expense/balance
  try {
    let income = 0, expense = 0;
    for (const it of filtered) {
      const amt = Number(it.amount) || 0;
      if (it.type === 'income') income += amt; else expense += amt;
    }
    const balance = income - expense;
    const incEl = document.getElementById('status-income');
    const expEl = document.getElementById('status-expense');
    const balEl = document.getElementById('status-balance');
    if (incEl) incEl.textContent = income.toFixed(2);
    if (expEl) expEl.textContent = expense.toFixed(2);
    if (balEl) balEl.textContent = balance.toFixed(2);
  } catch {}
  // уведомим другие модули (например, extra.js) об изменении данных
  try { window.dispatchEvent(new CustomEvent('transactions-updated')); } catch {}
}

function getMode() {
  const m = localStorage.getItem('mode');
  return m === 'local' ? 'local' : 'server';
}

function setMode(mode) {
  const m = mode === 'local' ? 'local' : 'server';
  localStorage.setItem('mode', m);
  const modeEl = document.getElementById('status-mode');
  if (modeEl) modeEl.textContent = m;
  const onlineEl = document.getElementById('status-online');
  const syncEl = document.getElementById('status-sync');
  const authPanel = document.getElementById('auth-panel');
  if (m === 'local') {
    if (authPanel) authPanel.style.display = 'none';
    if (onlineEl) onlineEl.textContent = 'local';
    if (syncEl) syncEl.textContent = 'idle';
  } else {
    if (authPanel) authPanel.style.display = 'flex';
    if (onlineEl) onlineEl.textContent = 'online';
  }
}

function updateLastSynced() {
  const el = document.getElementById('status-last');
  if (el) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  const data = readForm();
  if (!data.amount || Number(data.amount) <= 0) return;
  const activeBudgetId = Number(localStorage.getItem('activeBudgetId')) || null;
  if (activeBudgetId) data.budgetId = activeBudgetId;
  if (window.__editingId != null) {
    await updateTransaction({ id: window.__editingId, ...data });
    window.__editingId = null;
    const submitEl = document.querySelector('#transaction-form .actions .primary');
    if (submitEl) submitEl.textContent = 'Добавить';
    const formEl = document.getElementById('transaction-form');
    if (formEl) formEl.classList.remove('editing');
  } else {
    await addTransaction(data);
  }
  clearForm();
  await refresh();
}

async function handleDelete(id) {
  await deleteTransaction(id);
  await refresh();
}

function fillForm(it) {
  document.getElementById('type').value = it.type;
  document.getElementById('amount').value = it.amount;
  document.getElementById('category').value = it.category;
  document.getElementById('member').value = it.member || '';
  document.getElementById('source').value = it.source || '';
  document.getElementById('note').value = it.note || '';
  document.getElementById('date').value = it.date || new Date().toISOString().slice(0,10);
}

async function handleEdit(it) {
  window.__editingId = it.id;
  fillForm(it);
  const submitEl = document.querySelector('#transaction-form .actions .primary');
  if (submitEl) submitEl.textContent = 'Сохранить';
  const formEl = document.getElementById('transaction-form');
  if (formEl) formEl.classList.add('editing');
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
  // Убедимся, что ключевые элементы DOM готовы, иначе повторим позже
  const requiredIds = ['transaction-form','budget-select','auth-panel'];
  const ready = requiredIds.every(id => !!document.getElementById(id));
  if (!ready) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { try { initApp(); } catch {} });
    } else {
      setTimeout(() => { try { initApp(); } catch {} }, 50);
    }
    return;
  }
  // Предзаполняем дату текущим днём
  const dateEl = document.getElementById('date');
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);

  // Загружаем метаданные из IndexedDB и применяем в селекты
  const meta = await getMetaLocal();
  setCategories([
    document.getElementById('category'),
    document.getElementById('filter-category'),
  ], meta.categories?.length ? meta.categories : DEFAULT_CATEGORIES);
  setMembers([
    document.getElementById('member'),
    document.getElementById('filter-member'),
  ], meta.members?.length ? meta.members : DEFAULT_MEMBERS);
  setSources([
    document.getElementById('source'),
    document.getElementById('filter-source'),
  ], meta.sources?.length ? meta.sources : DEFAULT_SOURCES);

  // Рендер редактора справочников
  function renderMetaLists(m) {
    const catsEl = document.getElementById('list-categories');
    const memsEl = document.getElementById('list-members');
    const srcsEl = document.getElementById('list-sources');
    const makeItem = (name, onRename, onDelete) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="name"></span><div class="meta-actions"><button class="secondary edit">Редактировать</button><button class="danger del">Удалить</button></div>`;
      li.querySelector('.name').textContent = name;
      { const editBtn = li.querySelector('.edit'); if (editBtn) editBtn.addEventListener('click', async () => {
        const next = prompt('Новое имя', name);
        if (next && next.trim() && next.trim() !== name) {
          await onRename(name, next.trim());
          const updated = await getMetaLocal();
          renderMetaLists(updated);
          setCategories([document.getElementById('category'), document.getElementById('filter-category')], updated.categories);
          setMembers([document.getElementById('member'), document.getElementById('filter-member')], updated.members);
          setSources([document.getElementById('source'), document.getElementById('filter-source')], updated.sources);
        }
      }); }
      { const delBtn = li.querySelector('.del'); if (delBtn) delBtn.addEventListener('click', async () => {
        if (confirm(`Удалить «${name}»?`)) {
          await onDelete(name);
          const updated = await getMetaLocal();
          renderMetaLists(updated);
          setCategories([document.getElementById('category'), document.getElementById('filter-category')], updated.categories);
          setMembers([document.getElementById('member'), document.getElementById('filter-member')], updated.members);
          setSources([document.getElementById('source'), document.getElementById('filter-source')], updated.sources);
        }
      }); }
      return li;
    };
    catsEl.innerHTML = '';
    (m.categories || DEFAULT_CATEGORIES).forEach((c) => {
      catsEl.appendChild(makeItem(c, renameCategory, deleteCategoryMeta));
    });
    memsEl.innerHTML = '';
    (m.members || DEFAULT_MEMBERS).forEach((c) => {
      memsEl.appendChild(makeItem(c, renameMember, deleteMemberMeta));
    });
    srcsEl.innerHTML = '';
    (m.sources || DEFAULT_SOURCES).forEach((c) => {
      srcsEl.appendChild(makeItem(c, renameSource, deleteSourceMeta));
    });
  }
  renderMetaLists(meta);

  // Слушатели
  { const el = document.getElementById('transaction-form'); if (el) el.addEventListener('submit', handleSubmit); }
  { const el = document.getElementById('transaction-form'); if (el) el.addEventListener('reset', () => {
    window.__editingId = null;
    const submitEl = document.querySelector('#transaction-form .actions .primary');
    if (submitEl) submitEl.textContent = 'Добавить';
    const formEl = document.getElementById('transaction-form');
    if (formEl) formEl.classList.remove('editing');
  }); }
  // Обновление списка и итогов при изменении фильтров
  const filterIds = ['filter-period','filter-from','filter-to','filter-category','filter-member','filter-source'];
  filterIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { refresh(); });
  });
  { const el = document.getElementById('export-json'); if (el) el.addEventListener('click', handleExport); }
  { const el = document.getElementById('import-json'); if (el) el.addEventListener('change', handleImport); }
  { const el = document.getElementById('clear-all'); if (el) el.addEventListener('click', handleClearAll); }
  { const el = document.getElementById('clear-filters'); if (el) el.addEventListener('click', async () => {
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-member').value = '';
    document.getElementById('filter-source').value = '';
    document.getElementById('filter-from').value = '';
    document.getElementById('filter-to').value = '';
    await refresh();
  }); }

  // Синхронизация
  { const el = document.getElementById('sync-pull'); if (el) el.addEventListener('click', async () => {
    try {
      if (getMode() !== 'server') { alert('Доступно только в серверном режиме'); return; }
      const syncEl = document.getElementById('status-sync');
      if (syncEl) syncEl.textContent = 'pulling';
      const token = localStorage.getItem('authToken');
      const budgetId = Number(localStorage.getItem('activeBudgetId'));
      if (!token) { alert('Войдите в аккаунт'); return; }
      if (!budgetId) { alert('Выберите бюджет'); return; }
      const items = await pullTransactions();
      // Импортируем как JSON в локальную БД
      const blob = new Blob([JSON.stringify(items)], { type: 'application/json' });
      await importFromJSON(new File([blob], 'remote.json'));
      await refresh();
      updateLastSynced();
      const meta = await getMeta();
      if (meta.members?.length) setMembers([document.getElementById('member'), document.getElementById('filter-member')], meta.members);
      if (meta.sources?.length) setSources([document.getElementById('source'), document.getElementById('filter-source')], meta.sources);
      if (syncEl) syncEl.textContent = 'ok';
    } catch (e) { console.error(e); alert('Не удалось загрузить с сервера'); }
  }); }
  { const el = document.getElementById('sync-push'); if (el) el.addEventListener('click', async () => {
    try {
      if (getMode() !== 'server') { alert('Доступно только в серверном режиме'); return; }
      el.disabled = true;
      const syncEl = document.getElementById('status-sync');
      if (syncEl) syncEl.textContent = 'pushing';
      const token = localStorage.getItem('authToken');
      const budgetId = Number(localStorage.getItem('activeBudgetId'));
      if (!token) { alert('Войдите в аккаунт'); return; }
      if (!budgetId) { alert('Выберите бюджет'); return; }
      const items = await getAllTransactions();
      const toSend = Array.isArray(items) ? items.filter((it) => it.origin !== 'server') : [];
      const result = await pushTransactions(toSend);
      const { created = [], duplicates = [], updated = [], mapping = [] } = result || {};
      const serverItems = [...created, ...duplicates, ...updated];
      // Удаляем локальные копии (по clientId), импортируем версии с server IDs
      try {
        for (const map of mapping) { if (map?.clientId != null) { try { await deleteTransaction(map.clientId); } catch {} } }
        if (Array.isArray(serverItems) && serverItems.length) {
          const blob = new Blob([JSON.stringify(serverItems)], { type: 'application/json' });
          await importFromJSON(new File([blob], 'server-push.json'));
        }
      } catch {}
      alert('Выгружено на сервер');
      updateLastSynced();
      if (syncEl) syncEl.textContent = 'ok';
    } catch (e) { console.error(e); alert('Не удалось выгрузить на сервер'); }
    finally { el.disabled = false; }
  }); }

  // Добавление в справочники
  { const el = document.getElementById('add-category'); if (el) el.addEventListener('click', async () => {
    const val = document.getElementById('new-category').value.trim();
    if (!val) return;
    await addCategory(val);
    document.getElementById('new-category').value = '';
    const updated = await getMetaLocal();
    renderMetaLists(updated);
    setCategories([document.getElementById('category'), document.getElementById('filter-category')], updated.categories);
  }); }
  { const el = document.getElementById('add-member'); if (el) el.addEventListener('click', async () => {
    const val = document.getElementById('new-member').value.trim();
    if (!val) return;
    await addMember(val);
    document.getElementById('new-member').value = '';
    const updated = await getMetaLocal();
    renderMetaLists(updated);
    setMembers([document.getElementById('member'), document.getElementById('filter-member')], updated.members);
  }); }
  { const el = document.getElementById('add-source'); if (el) el.addEventListener('click', async () => {
    const val = document.getElementById('new-source').value.trim();
    if (!val) return;
    await addSource(val);
    document.getElementById('new-source').value = '';
    const updated = await getMetaLocal();
    renderMetaLists(updated);
    setSources([document.getElementById('source'), document.getElementById('filter-source')], updated.sources);
  }); }

  // Режим работы: Server/Local
  setMode(getMode());
  const modeSelect = document.getElementById('mode-select');
  if (modeSelect) {
    modeSelect.value = getMode();
    modeSelect.addEventListener('change', () => {
      setMode(modeSelect.value);
      if (getMode() === 'local') {
        try { clearInterval(window.__pullInterval); } catch {}
        try { if (window.__eventsSub?.close) window.__eventsSub.close(); } catch {}
        const syncEl = document.getElementById('status-sync');
        if (syncEl) syncEl.textContent = 'idle';
      } else {
        startAutoSync();
        startRealtime();
      }
    });
  }

  // --- Аккаунт и бюджеты ---
  const authStatusEl = document.getElementById('auth-status');
  const budgetSelectEl = document.getElementById('budget-select');
  const modalBudgetSelectEl = document.getElementById('modal-budget-select');

  function updateAuthStatus(user) {
    if (authStatusEl) {
      if (user?.user?.email) authStatusEl.textContent = `Вошли: ${user.user.email}`;
      else if (user?.email) authStatusEl.textContent = `Вошли: ${user.email}`;
      else authStatusEl.textContent = 'Не вошли';
    }
  }

  async function populateBudgets() {
    try {
      const list = await getBudgets();
      const active = Number(localStorage.getItem('activeBudgetId'));
      if (budgetSelectEl) {
        budgetSelectEl.innerHTML = '';
        for (const b of list) {
          const opt = new Option(`${b.name} (#${b.id})`, String(b.id));
          budgetSelectEl.appendChild(opt);
        }
        if (active) budgetSelectEl.value = String(active);
        else if (list.length) {
          localStorage.setItem('activeBudgetId', String(list[0].id));
          budgetSelectEl.value = String(list[0].id);
        }
      }
      if (modalBudgetSelectEl) {
        modalBudgetSelectEl.innerHTML = '';
        for (const b of list) {
          modalBudgetSelectEl.appendChild(new Option(`${b.name} (#${b.id})`, String(b.id)));
        }
        if (active) modalBudgetSelectEl.value = String(active);
        else if (list.length) modalBudgetSelectEl.value = String(list[0].id);
      }
    } catch (e) { console.warn('budgets load failed', e); }
  }

  // Кнопки регистрации/входа заменены на единую кнопку #btn-auth

  // Единая кнопка авторизации (Войти / Регистрация)
  { const authBtn = document.getElementById('btn-auth'); if (authBtn?.addEventListener) authBtn.addEventListener('click', async () => {
    try {
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      if (!email || !password) { alert('Укажите email и пароль'); return; }
      let info;
      try {
        const data = await login(email, password);
        info = data?.user ? { user: data.user } : { email: data?.user?.email };
      } catch (e1) {
        try {
          await register(email, password);
          const data = await login(email, password);
          info = data?.user ? { user: data.user } : { email: data?.user?.email };
        } catch (e2) {
          console.error(e2);
          alert('Ошибка авторизации');
          return;
        }
      }
      updateAuthStatus(info);
      const authPanelEl = document.getElementById('auth-panel');
      const authUserEl = document.getElementById('auth-user');
      if (authPanelEl && authUserEl) { authPanelEl.style.display = 'none'; authUserEl.style.display = 'flex'; }
      await populateBudgets();
    } catch (e) { console.error(e); alert('Ошибка авторизации'); }
  }); }

  try {
    const el = document.getElementById('budget-select');
    if (el && typeof el.addEventListener === 'function') {
      el.addEventListener('change', () => {
        const val = el.value;
        if (val) localStorage.setItem('activeBudgetId', val);
        if (modalBudgetSelectEl) modalBudgetSelectEl.value = val;
        // Перезапустить realtime при смене бюджета
        try { startRealtime(); } catch {}
        try { doPullOnce(); } catch {}
      });
    }
  } catch (e) { console.warn('budget-select listener attach failed', e); }

  // Модальное окно управления бюджетами: открыть/закрыть + синхронизация
const openModalBtn = document.getElementById('btn-open-budget-modal');
const closeModalBtn = document.getElementById('btn-close-budget-modal');
const budgetModalEl = document.getElementById('budget-modal');
// Хелпер объявлен ниже единажды; здесь просто подключаем
enableDialogBackdropClose(budgetModalEl);
  if (openModalBtn && budgetModalEl && typeof openModalBtn.addEventListener === 'function') {
    openModalBtn.addEventListener('click', async () => {
      try { await populateBudgets(); } catch {}
try {
  if (typeof budgetModalEl.showModal === 'function') {
    budgetModalEl.showModal();
  } else {
    budgetModalEl.classList.add('is-open');
    budgetModalEl.style.display = 'block';
  }
} catch {}
    });
  }
  if (closeModalBtn && budgetModalEl && typeof closeModalBtn.addEventListener === 'function') {
    closeModalBtn.addEventListener('click', () => {
try {
  if (typeof budgetModalEl.close === 'function') {
    budgetModalEl.close();
  } else {
    budgetModalEl.classList.remove('is-open');
    budgetModalEl.style.display = 'none';
  }
} catch {}
    });
  }
  if (modalBudgetSelectEl && typeof modalBudgetSelectEl.addEventListener === 'function') {
    modalBudgetSelectEl.addEventListener('change', () => {
      const val = modalBudgetSelectEl.value;
      if (val) localStorage.setItem('activeBudgetId', val);
      if (budgetSelectEl) budgetSelectEl.value = val;
      // Перезапустить realtime при смене бюджета (из модалки)
      try { startRealtime(); } catch {}
      try { doPullOnce(); } catch {}
    });
  }

  const refreshBtn = document.getElementById('btn-refresh-budgets');
  try { if (refreshBtn && typeof refreshBtn.addEventListener === 'function') refreshBtn.addEventListener('click', populateBudgets); } catch (e) { console.warn('refresh budgets listener attach failed', e); }

  { const el = document.getElementById('btn-create-budget'); if (el) el.addEventListener('click', async () => {
    try {
      const name = document.getElementById('new-budget-name').value.trim();
      if (!name) { alert('Введите название'); return; }
      const b = await createBudget(name);
      document.getElementById('new-budget-name').value = '';
      await populateBudgets();
      localStorage.setItem('activeBudgetId', String(b.id));
      if (budgetSelectEl) budgetSelectEl.value = String(b.id);
    } catch (e) { console.error(e); alert('Ошибка создания бюджета'); }
  }); }

  { const el = document.getElementById('btn-invite'); if (el) el.addEventListener('click', async () => {
    try {
      const email = document.getElementById('invite-email').value.trim();
      const budgetId = Number(localStorage.getItem('activeBudgetId'));
      if (!budgetId) { alert('Сначала выберите бюджет'); return; }
      if (!email) { alert('Введите email'); return; }
      const res = await inviteMember(budgetId, email);
      if (res.status === 'invited' && res.token) {
        alert(`Приглашение создано. Токен: ${res.token}`);
      } else {
        alert('Пользователь добавлен в бюджет');
      }
      document.getElementById('invite-email').value = '';
    } catch (e) { console.error(e); alert('Ошибка приглашения'); }
  }); }

  // Генерация токена без email
  const genBtn = document.getElementById('btn-gen-invite');
  if (genBtn) {
    genBtn.addEventListener('click', async () => {
      try {
        const budgetId = Number(localStorage.getItem('activeBudgetId'));
        if (!budgetId) { alert('Сначала выберите бюджет'); return; }
        const res = await inviteMember(budgetId, 'token@local');
        if (res?.token) {
          alert(`Токен приглашения: ${res.token}`);
          const tokenEl = document.getElementById('invite-token');
          if (tokenEl) tokenEl.value = res.token;
        } else {
          alert('Не удалось создать токен');
        }
      } catch (e) { console.error(e); alert('Ошибка создания токена'); }
    });
  }

  { const el = document.getElementById('btn-accept-invite'); if (el) el.addEventListener('click', async () => {
    try {
      const token = document.getElementById('invite-token').value.trim();
      if (!token) { alert('Введите токен'); return; }
      await acceptInvite(token);
      document.getElementById('invite-token').value = '';
      await populateBudgets();
      alert('Приглашение принято');
    } catch (e) { console.error(e); alert('Не удалось принять приглашение'); }
  }); }

  // Автоинициализация: если есть токен, показать пользователя и загрузить бюджеты
  try {
    const token = localStorage.getItem('authToken');
    if (token) {
      const info = await me();
      updateAuthStatus(info);
      // Скрываем поля авторизации, показываем юзера
      const authPanelEl = document.getElementById('auth-panel');
      const authUserEl = document.getElementById('auth-user');
      if (authPanelEl && authUserEl) { authPanelEl.style.display = 'none'; authUserEl.style.display = 'flex'; }
      await populateBudgets();
    }
  } catch (e) { /* ignore */ }

  // Демо-данные для визуализации
  async function seedDemoData() {
    const today = new Date();
    function dShift(days) { const d = new Date(today); d.setDate(d.getDate() - days); return d.toISOString().slice(0,10); }
    const samples = [
      { type:'income', amount: 120000, category:'Доход', note:'Зарплата', date: dShift(30), member:'Я', source:'Зарплата' },
      { type:'income', amount: 15000, category:'Доход', note:'Фриланс', date: dShift(25), member:'Я', source:'Фриланс' },
      { type:'expense', amount: 4500, category:'Продукты', note:'Магазин', date: dShift(24), member:'Семья', source:'Основной' },
      { type:'expense', amount: 1200, category:'Транспорт', note:'Такси', date: dShift(23), member:'Я', source:'Основной' },
      { type:'expense', amount: 2200, category:'Кафе', note:'Кофе/ланч', date: dShift(22), member:'Партнёр', source:'Основной' },
      { type:'expense', amount: 9800, category:'Продукты', note:'Супермаркет', date: dShift(20), member:'Семья', source:'Основной' },
      { type:'expense', amount: 3400, category:'Транспорт', note:'Проездной', date: dShift(18), member:'Я', source:'Основной' },
      { type:'expense', amount: 5000, category:'Другое', note:'Подарок', date: dShift(15), member:'Партнёр', source:'Основной' },
      { type:'expense', amount: 7200, category:'Продукты', note:'Рынок', date: dShift(10), member:'Семья', source:'Основной' },
      { type:'income', amount: 120000, category:'Доход', note:'Зарплата', date: dShift(0), member:'Я', source:'Зарплата' },
      { type:'expense', amount: 1600, category:'Кафе', note:'Кофейня', date: dShift(2), member:'Я', source:'Основной' },
      { type:'expense', amount: 1400, category:'Транспорт', note:'Каршеринг', date: dShift(1), member:'Я', source:'Основной' },
    ];
    for (const it of samples) await addTransaction(it);
  }

  const seedBtn = document.getElementById('seed-demo');
  if (seedBtn) {
    seedBtn.addEventListener('click', async () => {
      await seedDemoData();
      await refresh();
      const syncEl = document.getElementById('status-sync');
      if (syncEl) syncEl.textContent = 'seeded';
    });
  }

  await refresh();
}

// Тултипы для графиков
function ensureTooltipEl() {
  let el = document.getElementById('chart-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chart-tooltip';
    // фиксированное позиционирование, чтобы элемент не расширял страницу
    el.style.position = 'fixed';
    el.style.pointerEvents = 'none';
    el.style.padding = '6px 8px';
    el.style.borderRadius = '8px';
    el.style.background = 'rgba(17,24,39,0.95)';
    el.style.color = '#e5e7eb';
    el.style.font = '12px system-ui';
    el.style.border = '1px solid #334155';
    el.style.boxShadow = '0 6px 24px rgba(0,0,0,0.25)';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

function attachChartTooltip(canvas) {
  if (!canvas) return;
  // не навешивать обработчики повторно при каждом refresh()
  if (canvas.__tooltipBound) return;
  const tooltip = ensureTooltipEl();
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const bars = canvas.__bars || [];
    let hit = null;
    for (const b of bars) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { hit = b; break; }
    }
    if (hit) {
      canvas.style.cursor = 'pointer';
      tooltip.style.display = 'block';
      tooltip.innerHTML = `<strong>${hit.type}</strong> — ${hit.label}<br/>${Number(hit.value).toFixed(0)}${hit.pct!=null?` · ${hit.pct}%`:''}`;
      // позиционируем по координатам окна, чтобы не менять высоту документа
      tooltip.style.left = `${e.clientX + 12}px`;
      tooltip.style.top = `${e.clientY + 12}px`;
    } else {
      canvas.style.cursor = '';
      tooltip.style.display = 'none';
    }
  }
  function onLeave() {
    canvas.style.cursor = '';
    tooltip.style.display = 'none';
  }
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.__tooltipBound = true;
}

// --- Доп. инициализация панели аккаунта/бюджетов вне initApp ---
function attachAuthBudgetExtras() {
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn && !logoutBtn.__bound) {
    logoutBtn.__bound = true;
    logoutBtn.addEventListener('click', async () => {
      localStorage.removeItem('authToken');
      localStorage.removeItem('activeBudgetId');
      const budgetSelectEl = document.getElementById('budget-select');
      if (budgetSelectEl) budgetSelectEl.innerHTML = '';
      const authPanelEl = document.getElementById('auth-panel');
      const authUserEl = document.getElementById('auth-user');
      const authStatusEl = document.getElementById('auth-status');
      if (authStatusEl) authStatusEl.textContent = 'Не вошли';
      if (authPanelEl && authUserEl) { authPanelEl.style.display = 'flex'; authUserEl.style.display = 'none'; }
      try { await refresh(); } catch {}
    });
  }

  const renameBtn = document.getElementById('btn-rename-budget');
  if (renameBtn && !renameBtn.__bound) {
    renameBtn.__bound = true;
    renameBtn.addEventListener('click', async () => {
      try {
        const id = Number(localStorage.getItem('activeBudgetId'));
        if (!id) { alert('Выберите бюджет'); return; }
        const name = document.getElementById('new-budget-name').value.trim();
        if (!name) { alert('Укажите новое имя'); return; }
        await updateBudget(id, name);
        document.getElementById('new-budget-name').value = '';
        // Переполнить список бюджетов
        const list = await getBudgets();
        const budgetSelectEl = document.getElementById('budget-select');
        if (budgetSelectEl) {
          budgetSelectEl.innerHTML = '';
          for (const b of list) budgetSelectEl.appendChild(new Option(`${b.name} (#${b.id})`, String(b.id)));
          budgetSelectEl.value = String(id);
        }
      } catch (e) { console.error(e); alert('Ошибка переименования'); }
    });
  }

  const deleteBtn = document.getElementById('btn-delete-budget');
  if (deleteBtn && !deleteBtn.__bound) {
    deleteBtn.__bound = true;
    deleteBtn.addEventListener('click', async () => {
      try {
        const id = Number(localStorage.getItem('activeBudgetId'));
        if (!id) { alert('Выберите бюджет'); return; }
        if (!confirm('Удалить бюджет и связанные данные?')) return;
        const mod = await import('./sync.js?v=5');
        if (!mod.deleteBudget) { throw new Error('deleteBudget not available'); }
        await mod.deleteBudget(id);
        localStorage.removeItem('activeBudgetId');
        const list = await getBudgets();
        const budgetSelectEl = document.getElementById('budget-select');
        if (budgetSelectEl) {
          budgetSelectEl.innerHTML = '';
          for (const b of list) budgetSelectEl.appendChild(new Option(`${b.name} (#${b.id})`, String(b.id)));
          if (list.length) {
            localStorage.setItem('activeBudgetId', String(list[0].id));
            budgetSelectEl.value = String(list[0].id);
          }
        }
        await refresh();
      } catch (e) { console.error(e); alert('Ошибка удаления'); }
    });
  }
}

// --- Авто‑синхронизация ---
async function doPullOnce() {
  try {
    if (getMode() !== 'server') return;
    const token = localStorage.getItem('authToken');
    const budgetId = Number(localStorage.getItem('activeBudgetId'));
    if (!token || !budgetId) return;
    const syncEl = document.getElementById('status-sync');
    if (syncEl) syncEl.textContent = 'pulling';
    const items = await pullTransactions();
    const blob = new Blob([JSON.stringify(items)], { type: 'application/json' });
    await importFromJSON(new File([blob], 'auto-pull.json'));
    await refresh();
    updateLastSynced();
    if (syncEl) syncEl.textContent = 'ok';
  } catch (e) { /* silent */ }
}

function scheduleAutoPush() {
  clearTimeout(window.__pushTimer);
  window.__pushTimer = setTimeout(async () => {
    try {
      if (getMode() !== 'server') return;
      const token = localStorage.getItem('authToken');
      const budgetId = Number(localStorage.getItem('activeBudgetId'));
      if (!token || !budgetId) return;
      const syncEl = document.getElementById('status-sync');
      if (syncEl) syncEl.textContent = 'pushing';
      const items = await getAllTransactions();
      const toSend = Array.isArray(items) ? items.filter((it) => it.origin !== 'server') : [];
      const result = await pushWithRetry(toSend, 3);
      const { created = [], duplicates = [], updated = [], mapping = [] } = result || {};
      const serverItems = [...created, ...duplicates, ...updated];
      try {
        for (const map of mapping) { if (map?.clientId != null) { try { await deleteTransaction(map.clientId); } catch {} } }
        if (Array.isArray(serverItems) && serverItems.length) {
          const blob = new Blob([JSON.stringify(serverItems)], { type: 'application/json' });
          await importFromJSON(new File([blob], 'server-auto-push.json'));
        }
      } catch {}
      updateLastSynced();
      if (syncEl) syncEl.textContent = 'ok';
    } catch (e) { console.warn('auto-push failed', e); }
  }, 1500);
}

async function pushWithRetry(items, maxAttempts = 3) {
  let attempt = 0;
  let lastErr = null;
  while (attempt < maxAttempts) {
    try {
      return await pushTransactions(items);
    } catch (e) {
      lastErr = e;
      const delay = Math.pow(2, attempt) * 500; // 500ms, 1s, 2s
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
  if (lastErr) throw lastErr;
  return { created: [], duplicates: [], updated: [], mapping: [] };
}

function startAutoSync() {
  clearInterval(window.__pullInterval);
  // мгновенный pull при старте
  doPullOnce();
  // и регулярный опрос каждые 5 секунд
  window.__pullInterval = setInterval(doPullOnce, 5000);
}

// Real‑time подписка через SSE
function startRealtime() {
  try {
    // Закроем предыдущую подписку, если есть
    if (window.__eventsSub && typeof window.__eventsSub.close === 'function') {
      try { window.__eventsSub.close(); } catch {}
    }
    const token = localStorage.getItem('authToken');
    const budgetId = Number(localStorage.getItem('activeBudgetId'));
    if (getMode() !== 'server') return;
    if (!token || !budgetId) return;
    const syncEl = document.getElementById('status-sync');
    const es = subscribeEvents(budgetId);
    window.__eventsSub = es;
    es.addEventListener('hello', () => { if (syncEl) syncEl.textContent = 'live'; });
    es.addEventListener('ping', () => { /* keep-alive */ });
    es.addEventListener('update', async () => { try { await doPullOnce(); } catch {} });
    es.onerror = () => { if (syncEl) syncEl.textContent = 'idle'; };
  } catch (e) { /* ignore */ }
}

// Привязываем обработчики и авто‑push на любое обновление
try {
  attachAuthBudgetExtras();
  window.addEventListener('transactions-updated', () => scheduleAutoPush());
  startAutoSync();
  startRealtime();
} catch {}
// Хелпер: закрывать диалог по клику на фон (единственный)
function enableDialogBackdropClose(dialog) {
  if (!dialog) return;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      try { dialog.close(); } catch {}
    }
  });
}
  // Модальное окно совместной работы: открыть/закрыть
const openCollabBtn = document.getElementById('btn-open-collab-modal');
const closeCollabBtn = document.getElementById('btn-close-collab-modal');
const collabModalEl = document.getElementById('collab-modal');
enableDialogBackdropClose(collabModalEl);
  if (openCollabBtn && collabModalEl && typeof openCollabBtn.addEventListener === 'function') {
    openCollabBtn.addEventListener('click', () => {
try {
  if (typeof collabModalEl.showModal === 'function') {
    collabModalEl.showModal();
  } else {
    collabModalEl.classList.add('is-open');
    collabModalEl.style.display = 'block';
  }
} catch {}
    });
  }
  if (closeCollabBtn && collabModalEl && typeof closeCollabBtn.addEventListener === 'function') {
    closeCollabBtn.addEventListener('click', () => {
try {
  if (typeof collabModalEl.close === 'function') {
    collabModalEl.close();
  } else {
    collabModalEl.classList.remove('is-open');
    collabModalEl.style.display = 'none';
  }
} catch {}
    });
  }