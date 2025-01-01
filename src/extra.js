import { getAllTransactions } from './db.js';
import * as charts from './charts.js?v=7';

const LS_KEY = 'budget_filters_v2';
const TICKER_KEY = 'ticker_items_v1';
const TICKER_ENABLED_KEY = 'ticker_enabled_map_v1';
const TICKER_AUTO_KEY = 'ticker_auto_v1';
const TICKER_IDS_KEY = 'ticker_ids_v1';
const TICKER_INTERVAL_KEY = 'ticker_interval_ms_v1';
const COINS_LIST_KEY = 'coingecko_coins_list_v1';
const COINS_LIST_TS_KEY = 'coingecko_coins_list_ts_v1';
const API_PORT = 8050;
const SERVER_ORIGIN = (typeof window !== 'undefined' && window.location && window.location.origin)
  ? window.location.origin.replace(/:\d+$/, ':' + API_PORT)
  : 'http://127.0.0.1:' + API_PORT;

function getEl(id) { return document.getElementById(id); }

function readFilters() {
  const preset = getEl('filter-period')?.value || 'current_month';
  const from = getEl('filter-from')?.value || '';
  const to = getEl('filter-to')?.value || '';
  const category = getEl('filter-category')?.value || '';
  const member = getEl('filter-member')?.value || '';
  const source = getEl('filter-source')?.value || '';
  return { preset, from, to, category, member, source };
}

function saveFilters(filters) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(filters)); } catch {}
}

function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const f = JSON.parse(raw);
    for (const [k,v] of Object.entries(f)) {
      const el = getEl(`filter-${k}`) || (k==='preset'?getEl('filter-period'):null);
      if (el && typeof v !== 'undefined') el.value = v;
    }
  } catch {}
}

function periodRange(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const to = new Date(y, m, now.getDate());
  let from;
  switch (preset) {
    case 'current_month':
    case 'month':
    default:
      from = new Date(y, m, 1); break;
    case 'months3':
    case '3m': from = new Date(y, m-2, 1); break;
    case 'months6':
    case '6m': from = new Date(y, m-5, 1); break;
    case 'ytd': from = new Date(y, 0, 1); break;
    case 'year': from = new Date(y-1, m, 1); break;
    case 'all': from = new Date(1970,0,1); break;
  }
  const fmtLocal = (d) => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yy}-${mm}-${dd}`;
  };
  return { from: fmtLocal(from), to: fmtLocal(to) };
}

function applyFilters(items, filters) {
  const f = { ...filters };
  const range = f.preset === 'custom' ? { from: f.from || '1970-01-01', to: f.to || '9999-12-31' } : periodRange(f.preset);
  return items.filter(it => {
    const date = (it.date || '').slice(0,10);
    if (date && (date < range.from || date > range.to)) return false;
    if (f.category && it.category !== f.category) return false;
    if (f.member && it.member !== f.member) return false;
    if (f.source && it.source !== f.source) return false;
    return true;
  });
}

function isChecked(id) { const el = getEl(id); return !!el && !!el.checked; }

async function refreshCharts() {
  const filters = readFilters();
  saveFilters(filters);
  const items = await getAllTransactions();
  const filtered = applyFilters(items, filters);

  // Ежемесячный столбчатый
  const cMonthly = getEl('chart-monthly');
  if (cMonthly) cMonthly.style.display = isChecked('toggle-monthly') ? 'block' : 'none';
  if (isChecked('toggle-monthly')) charts.drawMonthlyChart(cMonthly, filtered);

  // Категории
  const cCats = getEl('chart-categories');
  if (cCats) cCats.style.display = isChecked('toggle-categories') ? 'block' : 'none';
  if (isChecked('toggle-categories')) charts.drawCategoryChart(cCats, filtered);

  // Баланс
  const cBal = getEl('chart-balance');
  if (cBal) cBal.style.display = isChecked('toggle-balance') ? 'block' : 'none';
  if (isChecked('toggle-balance') && charts.drawBalanceChart) charts.drawBalanceChart(cBal, filtered);

  // Донат
  const cDonut = getEl('chart-donut');
  const dimEl = document.getElementById('donut-dimension');
  const dimension = dimEl ? dimEl.value : 'category';
  if (cDonut) cDonut.style.display = isChecked('toggle-donut') ? 'block' : 'none';
  if (isChecked('toggle-donut')) charts.drawDonutChart(cDonut, filtered, dimension);
}

function bindFilters() {
  const ids = ['filter-period','filter-from','filter-to','filter-category','filter-member','filter-source','donut-dimension'];
  ids.forEach(id => getEl(id)?.addEventListener('change', refreshCharts));
  const toggles = ['toggle-monthly','toggle-categories','toggle-balance','toggle-donut'];
  toggles.forEach(id => getEl(id)?.addEventListener('change', refreshCharts));
  getEl('clear-filters')?.addEventListener('click', () => {
    const { from, to } = periodRange('current_month');
    const presetEl = getEl('filter-period'); if (presetEl) presetEl.value = 'current_month';
    if (getEl('filter-from')) getEl('filter-from').value = from;
    if (getEl('filter-to')) getEl('filter-to').value = to;
    ['filter-category','filter-member','filter-source'].forEach(id => { const el = getEl(id); if (el) el.value = ''; });
    refreshCharts();
  });
}

function bindOnlineStatus() {
  const badge = document.getElementById('status-online');
  function update() { if (!badge) return; badge.textContent = navigator.onLine ? 'Online' : 'Offline'; badge.className = navigator.onLine ? 'badge online' : 'badge offline'; }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function download(filename, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}

function toCSV(items) {
  const cols = ['id','type','amount','category','member','source','note','date'];
  const escape = v => String(v==null?'':v).replace(/"/g,'""');
  const header = cols.join(',');
  const rows = items.map(it => cols.map(c => '"'+escape(it[c])+'"').join(','));
  return [header, ...rows].join('\n');
}

function bindExport() {
  getEl('export-png')?.addEventListener('click', () => {
    const idsOrder = ['chart-donut','chart-balance','chart-categories','chart-monthly'];
    const canvas = idsOrder.map(getEl).find(c => c && c.width && c.height);
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    download('chart.png', url);
  });
  getEl('export-csv')?.addEventListener('click', async () => {
    const filtered = applyFilters(await getAllTransactions(), readFilters());
    const csv = toCSV(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    download('transactions.csv', url);
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  });
}

// --- Настраиваемый тикер ---
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getDefaultTickerItems() {
  return ['AAPL +1.2%','GOOGL -0.3%','MSFT +0.8%','TSLA -1.1%','BTC +0.6%','ETH +0.4%','EUR/USD 1.07'];
}

function loadTickerItems() {
  try {
    const raw = localStorage.getItem(TICKER_KEY);
    if (!raw) return getDefaultTickerItems();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(String);
    return getDefaultTickerItems();
  } catch {
    return getDefaultTickerItems();
  }
}

function saveTickerItems(items) {
  try { localStorage.setItem(TICKER_KEY, JSON.stringify(items)); } catch {}
}

// Видимость ручных элементов: { text: true|false }, по умолчанию true
function loadTickerEnabledMap() {
  try {
    const raw = localStorage.getItem(TICKER_ENABLED_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}
function saveTickerEnabledMap(map) {
  try { localStorage.setItem(TICKER_ENABLED_KEY, JSON.stringify(map || {})); } catch {}
}
function getEnabledManualItems() {
  const items = loadTickerItems();
  const map = loadTickerEnabledMap();
  return items.filter(txt => map[txt] !== false);
}

// --- JS бесконечная прокрутка (поэлементная бегущая строка) ---
let marqueeRaf = null;
let marqueeSpeed = 60; // пикселей в секунду (движение влево)

function stopJsMarquee() {
  if (marqueeRaf) { cancelAnimationFrame(marqueeRaf); marqueeRaf = null; }
  const el = document.getElementById('ticker-marquee') || document.querySelector('.ticker .marquee');
  if (el) {
    const items = Array.from(el.children);
    for (const it of items) it.style.transform = '';
  }
}

function startJsMarquee() {
  const el = document.getElementById('ticker-marquee') || document.querySelector('.ticker .marquee');
  if (!el) return;
  el.classList.add('no-anim');
  // Пауза по наведению — привязываем к контейнеру
  let paused = false;
  el.onmouseenter = () => { paused = true; };
  el.onmouseleave = () => { paused = false; };

  // Удаляем возможные старые клоны, если они были
  Array.from(el.querySelectorAll('.tick[data-clone="1"]')).forEach(n => n.remove());

  const baseItems = Array.from(el.querySelectorAll('.tick'));
  if (!baseItems.length) return;

  const containerRect = el.getBoundingClientRect();
  const viewportW = Math.max(0, containerRect.width);

  // Высота контейнера — высота строки + вертикальные паддинги
  const cs = getComputedStyle(el);
  const pt = parseFloat(cs.paddingTop || '0');
  const pb = parseFloat(cs.paddingBottom || '0');
  const gapPx = parseFloat(cs.columnGap || cs.gap || '0') || 0;
  const sampleH = (baseItems[0]?.getBoundingClientRect().height || 20);
  el.style.height = `${sampleH + pt + pb}px`;

  // Инициализация позиций: берём исходное флекс-расположение
  const entries = baseItems.map(node => {
    const r = node.getBoundingClientRect();
    const leftRel = r.left - containerRect.left;
    const w = r.width;
    // Переключаем на абсолютное позиционирование, управляем transform
    node.style.position = 'absolute';
    node.style.left = '0px';
    node.style.top = '50%'; // центр контейнера
    const entry = { node, x: leftRel, w };
    // Ссылка на структуру для последующих обновлений ширины при смене содержимого
    node.__tickerEntry = entry;
    return entry;
  });

  let lastTs = 0;
  function step(now) {
    const dt = lastTs ? Math.max(0, (now - lastTs) / 1000) : 0;
    lastTs = now;
    const move = paused ? 0 : (marqueeSpeed * dt);
    // текущее правое окончание самой правой метки
    let maxRight = -Infinity;
    for (const e of entries) {
      const right = e.x + e.w;
      if (right > maxRight) maxRight = right;
    }
    for (const e of entries) {
      e.x -= move;
      // как только элемент полностью ушёл — переносим его к правому краю:
      // либо вслед за самым правым (maxRight + gap), либо прямо у правой границы viewport
      if (e.x + e.w <= 0) {
        const startX = Math.max(maxRight + gapPx, viewportW);
        e.x = startX;
        // обновляем maxRight на случай нескольких переносов в одном кадре
        maxRight = e.x + e.w;
      }
      // вертикально центрируем через translateY(-50%)
      e.node.style.transform = `translate3d(${e.x}px, -50%, 0)`;
    }
    marqueeRaf = requestAnimationFrame(step);
  }

  cancelAnimationFrame(marqueeRaf);
  marqueeRaf = requestAnimationFrame(step);
}

function renderTicker() {
  const el = document.getElementById('ticker-marquee') || document.querySelector('.ticker .marquee');
  if (!el) return;
  const settings = loadTickerSettings();
  if (settings.auto) {
    updateCryptoTicker(settings);
  } else {
    const items = getEnabledManualItems();
    el.innerHTML = items.map(txt => `<span class="tick">${escapeHtml(txt)}</span>`).join('');
    el.removeAttribute('data-doubled');
    if (items.length) startJsMarquee(); else stopJsMarquee();
  }
}

function renderTickerFromItems(items) {
  // Дебаунс обновлений: батчим частые вызовы в RAF, чтобы избежать микрофризов
  renderTickerFromItems._pending = items;
  if (renderTickerFromItems._scheduled) return;
  renderTickerFromItems._scheduled = true;
  requestAnimationFrame(() => {
    renderTickerFromItems._scheduled = false;
    const el = document.getElementById('ticker-marquee') || document.querySelector('.ticker .marquee');
    if (!el) return;
    const nextItems = renderTickerFromItems._pending || items;
    const existing = Array.from(el.querySelectorAll('.tick'));
    // Если структура совпадает по количеству — обновим содержимое на месте без перезапуска анимации
    if (existing.length === nextItems.length && existing.length > 0) {
      for (let i = 0; i < nextItems.length; i++) {
        const n = existing[i];
        const raw = nextItems[i];
        if (n.__raw !== raw) {
          n.__raw = raw;
          // Сохраняем HTML (для авто-режима с разметкой)
          n.innerHTML = raw;
          // Обновляем кеш ширины соответствующего entry, чтобы избежать пересчёта на каждом кадре
          if (n.__tickerEntry) {
            const w = n.getBoundingClientRect().width;
            n.__tickerEntry.w = w;
          }
        }
      }
    } else {
      // Иначе перерисуем и запустим анимацию заново
      el.innerHTML = nextItems.map(txt => `<span class="tick">${txt}</span>`).join('');
      el.removeAttribute('data-doubled');
      if (nextItems.length) startJsMarquee(); else stopJsMarquee();
    }
  });
}

function idToSym(id) {
  const key = String(id).toLowerCase();
  const map = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', 'the-open-network': 'TON', toncoin: 'TON', tether: 'USDT', binancecoin: 'BNB', ripple: 'XRP', dogecoin: 'DOGE', cardano: 'ADA' };
  return map[key] || key.toUpperCase();
}

function formatUsd(n) {
  try { return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); } catch { return '$' + n; }
}

function getDefaultIds() { return ['Bitcoin','Ethereum','Solana','the-open-network']; }

async function ensureCoinsList() {
  try {
    const ts = Number(localStorage.getItem(COINS_LIST_TS_KEY) || 0);
    const now = Date.now();
    const cached = localStorage.getItem(COINS_LIST_KEY);
    if (cached && (now - ts) < 24*60*60*1000) {
      return JSON.parse(cached);
    }
    const res = await fetch(`${SERVER_ORIGIN}/api/crypto/coins-list`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('coins list fetch failed');
    const arr = await res.json();
    localStorage.setItem(COINS_LIST_KEY, JSON.stringify(arr));
    localStorage.setItem(COINS_LIST_TS_KEY, String(now));
    return arr;
  } catch {
    return [];
  }
}

function findCoinId(list, s) {
  const q = String(s || '').trim();
  const ql = q.toLowerCase();
  if (ql === 'ton' || ql === 'toncoin' || ql === 'the-open-network') return 'the-open-network';
  const byId = list.find(c => String(c.id).toLowerCase() === ql);
  if (byId) return byId.id;
  const bySymbol = list.find(c => String(c.symbol).toLowerCase() === ql);
  if (bySymbol) return bySymbol.id;
  const byName = list.find(c => String(c.name).toLowerCase() === ql);
  if (byName) return byName.id;
  return q;
}

async function resolveIds(userIds) {
  const list = await ensureCoinsList();
  const base = (userIds && userIds.length ? userIds : getDefaultIds());
  return base.map(s => findCoinId(list, s));
}

function loadTickerSettings() {
  const auto = localStorage.getItem(TICKER_AUTO_KEY) === '1';
  const idsStr = localStorage.getItem(TICKER_IDS_KEY) || getDefaultIds().join(',');
  const intervalMs = Number(localStorage.getItem(TICKER_INTERVAL_KEY) || 120000);
  const ids = idsStr.split(',').map(s => s.trim()).filter(Boolean);
  return { auto, ids, intervalMs };
}

function saveTickerSettings({ auto, ids, intervalMs }) {
  try {
    localStorage.setItem(TICKER_AUTO_KEY, auto ? '1' : '0');
    localStorage.setItem(TICKER_IDS_KEY, (ids||[]).join(','));
    localStorage.setItem(TICKER_INTERVAL_KEY, String(intervalMs || 120000));
  } catch {}
}

async function fetchCrypto(settings) {
  const idsArr = await resolveIds(settings.ids);
  const ids = idsArr.join(',');
  const url = `${SERVER_ORIGIN}/api/crypto/simple-price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('fetch failed');
  return res.json();
}

async function updateCryptoTicker(settings) {
  try {
    const data = await fetchCrypto(settings);
    const items = Object.entries(data).map(([id, v]) => {
      const sym = idToSym(id);
      const price = formatUsd(v.usd);
      const ch = Number(v.usd_24h_change || 0);
      const sign = ch > 0 ? '+' : ch < 0 ? '' : '';
      const cls = ch > 0 ? 'pos' : ch < 0 ? 'neg' : 'flat';
      const pct = Math.abs(ch).toFixed(2) + '%';
      return `<span class="sym">${sym}</span> <span class="price">${price}</span> <span class="change ${cls}">${sign}${pct}</span>`;
    });
    const manual = getEnabledManualItems().map(txt => escapeHtml(txt));
    renderTickerFromItems(items.concat(manual));
  } catch (e) {
    const manual = getEnabledManualItems().map(txt => escapeHtml(txt));
    renderTickerFromItems(manual);
  }
}

let tickerTimer = null;
function startTickerAuto(settings) {
  stopTickerAuto();
  updateCryptoTicker(settings);
  tickerTimer = setInterval(() => updateCryptoTicker(loadTickerSettings()), Math.max(15000, settings.intervalMs || 120000));
}
function stopTickerAuto() { if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; } }

function renderTickerList() {
  const listEl = document.getElementById('ticker-list');
  if (!listEl) return;
  const items = loadTickerItems();
  const enabledMap = loadTickerEnabledMap();
  listEl.innerHTML = '';
  items.forEach((txt, idx) => {
    const li = document.createElement('li');
    li.className = 'meta-list-item';
    const checked = enabledMap[txt] !== false;
    li.innerHTML = `
      <span class="name">${escapeHtml(txt)}</span>
      <div class="meta-actions">
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)">
          <input type="checkbox" class="vis" ${checked ? 'checked' : ''}/> Показывать
        </label>
        <button class="secondary edit">Редактировать</button>
        <button class="danger del">Удалить</button>
      </div>`;
    li.querySelector('.vis')?.addEventListener('change', (ev) => {
      const on = !!ev.target.checked;
      enabledMap[txt] = on;
      saveTickerEnabledMap(enabledMap);
      renderTicker();
    });
    li.querySelector('.del')?.addEventListener('click', () => {
      const next = items.slice(0, idx).concat(items.slice(idx + 1));
      saveTickerItems(next);
      // Удаляем состояние видимости для этого текста
      delete enabledMap[txt];
      saveTickerEnabledMap(enabledMap);
      renderTickerList();
      renderTicker();
    });
    li.querySelector('.edit')?.addEventListener('click', () => {
      const nextVal = prompt('Изменить элемент', txt);
      if (nextVal && nextVal.trim()) {
        const newTxt = nextVal.trim();
        const wasEnabled = enabledMap[txt] !== false;
        items[idx] = newTxt;
        saveTickerItems(items);
        // переносим флаг видимости на новое значение
        delete enabledMap[txt];
        enabledMap[newTxt] = wasEnabled;
        saveTickerEnabledMap(enabledMap);
        renderTickerList();
        renderTicker();
      }
    });
    listEl.appendChild(li);
  });
}

function bindTickerModal() {
  const openBtn = document.getElementById('btn-open-ticker-modal');
  const modal = document.getElementById('ticker-modal');
  const closeBtn = document.getElementById('btn-close-ticker-modal');
  const addBtn = document.getElementById('ticker-add');
  const input = document.getElementById('ticker-new');
  const autoEl = document.getElementById('ticker-auto');
  const idsEl = document.getElementById('ticker-ids');
  const intervalEl = document.getElementById('ticker-interval');
  // убран переключатель статичных элементов
  if (openBtn && modal) {
    openBtn.addEventListener('click', () => { try { modal.showModal(); renderTickerList(); } catch {} });
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => { try { modal.close(); } catch {} });
  }
  if (addBtn && input) {
    addBtn.addEventListener('click', () => {
      const val = (input.value || '').trim();
      if (!val) return;
      const items = loadTickerItems();
      items.push(val);
      saveTickerItems(items);
      input.value = '';
      renderTickerList();
      renderTicker();
    });
  }
  const s = loadTickerSettings();
  if (autoEl) autoEl.checked = !!s.auto;
  if (idsEl) idsEl.value = s.ids.join(',');
  if (intervalEl) intervalEl.value = Math.round((s.intervalMs || 120000) / 1000);
  autoEl?.addEventListener('change', () => {
    const cur = loadTickerSettings();
    const next = { ...cur, auto: !!autoEl.checked };
    saveTickerSettings(next);
    if (next.auto) startTickerAuto(next); else { stopTickerAuto(); renderTicker(); }
  });
  idsEl?.addEventListener('change', () => {
    const cur = loadTickerSettings();
    const ids = (idsEl.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const next = { ...cur, ids };
    saveTickerSettings(next);
    if (next.auto) updateCryptoTicker(next);
  });
  intervalEl?.addEventListener('change', () => {
    const sec = Math.max(15, Number(intervalEl.value || 120));
    const cur = loadTickerSettings();
    const next = { ...cur, intervalMs: sec * 1000 };
    saveTickerSettings(next);
    if (next.auto) startTickerAuto(next);
  });
}

function init() {
  loadFilters();
  bindFilters();
  bindOnlineStatus();
  bindExport();
  renderTicker();
  bindTickerModal();
  const s = loadTickerSettings();
  if (s.auto) startTickerAuto(s);
  // Установить значения периода по умолчанию, если пусто
  const preset = getEl('filter-period')?.value || 'current_month';
  if (preset !== 'custom') {
    const { from, to } = periodRange(preset);
    if (getEl('filter-from')) getEl('filter-from').value = from;
    if (getEl('filter-to')) getEl('filter-to').value = to;
  }
  // Перерисовывать графики при обновлении транзакций из других модулей
  window.addEventListener('transactions-updated', () => { refreshCharts(); });
  refreshCharts();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}