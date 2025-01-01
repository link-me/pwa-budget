import { initApp } from './app.js?v=51';

// Инициализация приложения после построения DOM
window.addEventListener('DOMContentLoaded', () => { initApp(); });

// Регистрация Service Worker (отключаем в локальной среде, чтобы избежать кеширования во время разработки)
if ('serviceWorker' in navigator) {
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname);
  const params = new URLSearchParams(location.search);
  const forceSw = params.get('sw') === '1' || localStorage.getItem('dev_sw') === '1';
  const purge = params.get('purge') === '1';

  // Полный сброс кешей и сервис-воркеров при ?purge=1
  if (purge) {
    window.addEventListener('load', async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        regs.forEach(r => r.unregister());
      } catch {}
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      } catch {}
      try { localStorage.removeItem('dev_sw'); } catch {}
      try {
        const u = new URL(location.href);
        u.searchParams.delete('purge');
        if (!u.searchParams.has('sw')) u.searchParams.set('sw','1');
        location.replace(u.toString());
      } catch { location.reload(); }
    });
  }
  if (!isLocal || forceSw) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(console.error);
    });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
      if (window.caches?.keys) {
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).catch(() => {});
      }
    });
  }
}
