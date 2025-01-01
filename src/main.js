import { initApp } from './app.js?v=7';

// Инициализация приложения после построения DOM
window.addEventListener('DOMContentLoaded', () => { initApp(); });

// Регистрация Service Worker (отключаем в локальной среде, чтобы избежать кеширования во время разработки)
if ('serviceWorker' in navigator) {
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!isLocal) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(console.error);
    });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    });
  }
}
