// Современные графики на Chart.js с живым обновлением и анимацией
try { console.info('[charts.js] v7 loaded'); } catch {}
// Требует глобального Chart (подключается через CDN в index.html)
// Опционально подключается ChartDataLabels (CDN), для подписей значений на графиках.

// Регистрация плагина DataLabels, если доступен
try {
  if (typeof Chart !== 'undefined' && typeof window !== 'undefined' && window.ChartDataLabels) {
    Chart.register(window.ChartDataLabels);
  }
} catch (e) {
  // проглатываем, если Chart ещё не доступен в момент инициализации
}

// Плагин: аккуратный центр-текст для пончика (итого / наведённый сегмент)
const CenterTextPlugin = {
  id: 'centerText',
  afterDraw(chart) {
    if (chart.config.type !== 'doughnut') return;
    const ctx = chart.ctx;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data.length) return;
    const cx = meta.data[0].x;
    const cy = meta.data[0].y;
    const ds = chart.data.datasets[0];
    const total = (ds.data || []).reduce((a, b) => a + b, 0) || 0;
    const active = chart.getActiveElements();
    let line1 = total.toFixed(0);
    let line2 = 'Итого';
    if (active && active.length) {
      const i = active[0].index;
      const v = ds.data[i] || 0;
      const pct = Math.round((v / (total || 1)) * 100);
      line1 = `${pct}%`;
      line2 = `${chart.data.labels[i]}`;
    }
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // лёгкая тень под центр-текстом для читабельности
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#e6e8ea';
    ctx.font = '700 20px Inter, system-ui';
    ctx.fillText(line1, cx, cy - 6);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '600 13px Inter, system-ui';
    ctx.fillText(line2, cx, cy + 12);
    ctx.restore();
  }
};
try { if (typeof Chart !== 'undefined') Chart.register(CenterTextPlugin); } catch (e) {}

function ensureChart(canvas, cfg) {
  if (!canvas || typeof Chart === 'undefined') return null;
  // Зафиксируем размеры графика из CSS один раз, отключим внутренний ресайз Chart.js
  try {
    if (!canvas.__chartSized) {
      const rect = canvas.getBoundingClientRect();
      // Устанавливаем реальный размер холста из вычисленных размеров элемента
      if (rect && rect.width && rect.height) {
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        canvas.width = Math.max(1, Math.round(rect.width * (window.devicePixelRatio || 1)));
        canvas.height = Math.max(1, Math.round(rect.height * (window.devicePixelRatio || 1)));
      }
      canvas.__chartSized = true;
    }
  } catch {}
  cfg.options = cfg.options || {};
  cfg.options.responsive = false;
  cfg.options.maintainAspectRatio = false;
  const hasChart = !!canvas.__chart;
  if (!hasChart) {
    const c = new Chart(canvas.getContext('2d'), cfg);
    canvas.__chart = c;
  } else {
    const c = canvas.__chart;
    c.type = cfg.type;
    c.data = cfg.data;
    c.options = cfg.options;
    // Обновление без анимации, чтобы избежать «дёрганья» при частых изменениях
    c.update('none');
  }
  return canvas.__chart;
}

function fmtMonthLabel(ym) {
  const m = ym.slice(5, 7), y = ym.slice(2, 4);
  return `${m}.${y}`;
}

export function drawMonthlyChart(canvas, items) {
  if (!canvas || typeof Chart === 'undefined') return;
  const byMonth = new Map();
  for (const it of items) {
    const ym = (it.date || '1970-01-01').slice(0, 7);
    const cur = byMonth.get(ym) || { income: 0, expense: 0 };
    if (it.type === 'income') cur.income += Number(it.amount || 0);
    else cur.expense += Number(it.amount || 0);
    byMonth.set(ym, cur);
  }
  const labelsYm = Array.from(byMonth.keys()).sort();
  const labels = labelsYm.map(fmtMonthLabel);
  const dataIn = labelsYm.map((l) => byMonth.get(l).income);
  const dataEx = labelsYm.map((l) => byMonth.get(l).expense);

  // Пропускаем перерисовку при неизменных данных
  try {
    const sig = JSON.stringify({ labelsYm, dataIn, dataEx });
    if (canvas.__sigMonthly === sig) return;
    canvas.__sigMonthly = sig;
  } catch {}

  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Доход', data: dataIn, backgroundColor: '#10b981', borderRadius: 6 },
        { label: 'Расход', data: dataEx, backgroundColor: '#ef4444', borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { precision: 0 } },
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { mode: 'index', intersect: false },
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: '#e6e8ea',
          formatter: (v) => (v == null ? '' : Math.round(v)),
          clamp: true,
        },
      },
      // Отключаем анимацию появления, чтобы не выглядело зацикленно
      animation: false,
    },
  };
  ensureChart(canvas, cfg);
}

export function drawCategoryChart(canvas, items) {
  if (!canvas || typeof Chart === 'undefined') return;
  const totals = new Map();
  for (const it of items) {
    const cat = it.category || 'Другое';
    const amt = Number(it.amount) || 0;
    if (it.type === 'expense') totals.set(cat, (totals.get(cat) || 0) + amt);
  }
  const rows = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  const labels = rows.map(r => r[0]);
  const values = rows.map(r => r[1]);

  // Пропускаем перерисовку при неизменных данных
  try {
    const sig = JSON.stringify({ labels, values });
    if (canvas.__sigCategories === sig) return;
    canvas.__sigCategories = sig;
  } catch {}

  const cfg = {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Расход', data: values, backgroundColor: '#ef4444', borderRadius: 6 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 0, right: 6 } },
      scales: {
        x: { grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { precision: 0, padding: 0 }, beginAtZero: true },
        y: { grid: { display: false }, ticks: { padding: 4 } },
      },
      plugins: {
        legend: { display: false },
        // Отключаем встроенный тултип Chart.js — используем внешний
        tooltip: { enabled: false },
        datalabels: {
          anchor: 'end',
          align: (ctx) => {
            const ds = ctx.chart.data.datasets[0].data;
            const v = ds[ctx.dataIndex] || 0;
            const total = ds.reduce((a,b)=>a+b,0) || 1;
            const frac = v / total;
            return frac < 0.1 ? 'center' : 'end';
          },
          color: '#e6e8ea',
          formatter: (v, ctx) => {
            if (v == null) return '';
            const total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0) || 1;
            const pct = Math.round((v / total) * 100);
            // Перенос процентов на новую строку, чтобы не выходили за край
            return `${Math.round(v)}\n(${pct}%)`;
          },
          offset: -4,
          clamp: true,
          clip: true,
        },
      },
      // Выключаем любые hover-события внутри Chart.js, чтобы не было перерисовок
      events: [],
      // Отключаем анимацию появления
      animation: false,
    },
  };
  const chart = ensureChart(canvas, cfg);
  // Рассчитываем зоны попадания по столбцам для внешнего тултипа
  try {
    const meta = chart.getDatasetMeta(0);
    const total = values.reduce((a,b)=>a+b,0) || 1;
    const bars = (meta?.data || []).map((el, i) => {
      // Пытаемся получить размер бара безопасно
      const props = (typeof el.getProps === 'function')
        ? el.getProps(['x','y','base','width','height'], true)
        : { x: el.x, y: el.y, base: el.base, width: el.width, height: el.height };
      const x0 = Math.min(props.base ?? el.base ?? 0, props.x ?? el.x ?? 0);
      const x1 = Math.max(props.base ?? el.base ?? 0, props.x ?? el.x ?? 0);
      const h = (props.height ?? el.height ?? 18);
      const y0 = (props.y ?? el.y ?? 0) - h/2;
      return {
        x: x0,
        y: y0,
        w: Math.max(0, x1 - x0),
        h: h,
        label: labels[i],
        value: values[i],
        pct: Math.round(((values[i]||0) / total) * 100),
        type: 'Расход',
      };
    });
    canvas.__bars = bars;
  } catch {}

  // Навешиваем внешний тултип: показываем данные при наведении
  try {
    if (!canvas.__tooltipBound) {
      canvas.__tooltipBound = true;
      const el = ensureTooltipEl();
      const onMove = (evt) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / Math.max(1, rect.width);
        const scaleY = canvas.height / Math.max(1, rect.height);
        const px = (evt.clientX - rect.left) * scaleX;
        const py = (evt.clientY - rect.top) * scaleY;
        const bars = canvas.__bars || [];
        let hit = null;
        for (const b of bars) {
          if (px >= b.x && px <= (b.x + b.w) && py >= b.y && py <= (b.y + b.h)) { hit = b; break; }
        }
        if (!hit) { el.style.opacity = '0'; return; }
        el.innerHTML = `${hit.label}: <strong>${Math.round(hit.value)}</strong> (${hit.pct}%)`;
        el.style.opacity = '1';
        const pad = 8;
        const maxLeft = rect.right - el.offsetWidth - pad;
        const minLeft = rect.left + pad;
        const maxTop = rect.bottom - el.offsetHeight - pad;
        const minTop = rect.top + pad;
        let left = Math.min(maxLeft, Math.max(minLeft, evt.clientX + 12));
        let top = Math.min(maxTop, Math.max(minTop, evt.clientY - 10));
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      };
      const onLeave = () => { el.style.opacity = '0'; };
      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('mouseleave', onLeave);
    }
  } catch {}
}

// Создаём/получаем элемент тултипа для графиков
function ensureTooltipEl() {
  let el = document.getElementById('chart-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chart-tooltip';
    el.className = 'chart-tooltip';
    el.style.position = 'fixed';
    el.style.zIndex = '100';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    document.body.appendChild(el);
  }
  return el;
}

export function drawBalanceChart(canvas, items) {
  if (!canvas || typeof Chart === 'undefined') return;
  const byDay = new Map();
  for (const it of items) {
    const d = (it.date || '1970-01-01').slice(0, 10);
    const cur = byDay.get(d) || { inc: 0, exp: 0 };
    if (it.type === 'income') cur.inc += Number(it.amount || 0);
    else cur.exp += Number(it.amount || 0);
    byDay.set(d, cur);
  }
  const dates = Array.from(byDay.keys()).sort();
  let bal = 0;
  const series = dates.map(d => { const v = byDay.get(d); bal += (v.inc - v.exp); return bal; });

  // Пропускаем перерисовку при неизменных данных
  try {
    const sig = JSON.stringify({ dates, series });
    if (canvas.__sigBalance === sig) return;
    canvas.__sigBalance = sig;
  } catch {}

  const cfg = {
    type: 'line',
    data: { labels: dates, datasets: [{ label: 'Баланс', data: series, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)', tension: 0.3, fill: true }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(148,163,184,0.15)' } } },
      plugins: { legend: { display: false } },
      // Отключаем анимацию появления
      animation: false,
    },
  };
  ensureChart(canvas, cfg);
}

export function drawDonutChart(canvas, items, dimension = 'category') {
  if (!canvas || typeof Chart === 'undefined') return;
  const totals = new Map();
  for (const it of items) {
    if (it.type !== 'expense') continue;
    const key = (dimension === 'member' ? (it.member || '—') : dimension === 'source' ? (it.source || '—') : (it.category || 'Другое'));
    totals.set(key, (totals.get(key) || 0) + Number(it.amount || 0));
  }
  const rows = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  const labels = rows.map(r => r[0]);
  const values = rows.map(r => r[1]);

  const palette = ['#ef4444','#f59e0b','#22c55e','#3b82f6','#a855f7','#14b8a6','#eab308','#f97316','#10b981','#6366f1'];
  const colors = labels.map((_, i) => palette[i % palette.length]);

  // Пропускаем перерисовку при неизменных данных
  try {
    const sig = JSON.stringify({ dimension, labels, values });
    if (canvas.__sigDonut === sig) return;
    canvas.__sigDonut = sig;
  } catch {}

  const cfg = {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, 
      backgroundColor: (ctx) => {
        const i = ctx.dataIndex;
        const base = colors[i % colors.length];
        const arc = ctx.element;
        if (!arc || !arc.x) return base;
        const g = ctx.chart.ctx.createRadialGradient(arc.x, arc.y, arc.innerRadius, arc.x, arc.y, arc.outerRadius);
        g.addColorStop(0, shade(base, 30));
        g.addColorStop(1, shade(base, -10));
        return g;
      },
      borderColor: '#0b0f14', borderWidth: 2, hoverOffset: 10 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 12 } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.parsed;
              const total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0) || 1;
              const pct = Math.round((v / total) * 100);
              return `${ctx.label}: ${v.toFixed(0)} (${pct}%)`;
            }
          }
        },
        datalabels: {
          color: '#0b0f14',
          backgroundColor: 'rgba(255,255,255,0.92)',
          borderRadius: 6,
          borderColor: 'rgba(0,0,0,0.15)',
          borderWidth: 1,
          padding: 5,
          formatter: (v, ctx) => {
            const total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0) || 1;
            const pct = Math.round((v / total) * 100);
            return `${pct}%`;
          },
          display: (ctx) => {
            const v = ctx.dataset.data[ctx.dataIndex];
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
            return (v / total) > 0.05; // немного снизили порог для видимости
          }
        },
        centerText: {},
      },
      // Отключаем анимацию появления
      animation: false,
      cutout: '65%',
    },
  };
  ensureChart(canvas, cfg);
}
// Плагин: мягкие тени под сегментами доната
const DonutShadowPlugin = {
  id: 'donutShadow',
  beforeDatasetDraw(chart, args) {
    if (chart.config.type !== 'doughnut') return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
  },
  afterDatasetDraw(chart, args) {
    if (chart.config.type !== 'doughnut') return;
    const ctx = chart.ctx;
    ctx.restore();
  }
};
try { if (typeof Chart !== 'undefined') Chart.register(DonutShadowPlugin); } catch (e) {}

// Вспомогательное: лёгкий радиальный градиент для сегмента
function toRGB(hex) {
  const h = hex.replace('#','');
  const bigint = parseInt(h.length===3 ? h.split('').map(x=>x+x).join('') : h, 16);
  return { r: (bigint>>16)&255, g: (bigint>>8)&255, b: bigint&255 };
}
function shade(hex, amt) {
  const { r,g,b } = toRGB(hex);
  const clamp = (v)=>Math.max(0, Math.min(255, v));
  return `rgb(${clamp(r+amt)}, ${clamp(g+amt)}, ${clamp(b+amt)})`;
}