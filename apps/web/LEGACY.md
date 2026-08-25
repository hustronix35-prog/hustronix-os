# Legacy web (`@hustronix/web`)

This package is the **previous** product shell (Tailwind dashboard: mission-control, chat, etc.).

**Default UI is now** [`apps/os-ui`](../os-ui) (the “new ui” shell).

| Command | Purpose |
|---------|---------|
| `npm run dev:web` | Default → os-ui |
| `npm run dev:web:legacy` | This package |
| `npm run build:web:legacy` | Build this package |

Unified server (`npm run dev:unified`) serves `apps/os-ui` via `config.webRoot`. Override with `HUSTRONIX_WEB_ROOT` if needed.
