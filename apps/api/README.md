# @hustronix/api

Express API, WebSocket server, SQLite adapter, agent runtime, auth, security middleware, and integrations.

## Commands

```bash
npm -w @hustronix/api run dev
npm -w @hustronix/api run build
npm -w @hustronix/api run start
npm -w @hustronix/api run dev:unified
```

Source lives in `src/`; production output goes to `dist/`.

## Runtime Paths

- Root `.env` is loaded from the workspace root.
- In development, `apps/web/.env.local` is merged without overriding root `.env`.
- SQLite defaults to `SQLITE_PATH=./data/hustronix.db`, resolved from the workspace root.
- Static legacy assets are served from `apps/api/public`.
