# Roadmap (EN)

No dates.

- Core budgeting features (income/expense, categories, summary)
- JSON import/export
- Offline mode: Service Worker + IndexedDB
- Filters by category and date range
- UI/UX improvements (responsive, dark theme)
- Local backups and restore
- Tags and category analytics
- Charts (basic monthly totals)
- CSV export
- UI localization (RU/EN)
- Accessibility and tests
 - Deployment: unified `.env` to set API host and base prefix
 - Server logs: neutral, avoid hardcoded `127.0.0.1`, show actual address
 - Data directory: store in `projects/pwa-budget2/server/data/` (auto-created)
 - Guide: publish static on GitHub Pages and run API on any Node hosting