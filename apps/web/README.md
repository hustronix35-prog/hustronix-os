# @hustronix/web

Next.js App Router frontend for Hustronix mission control.

## Commands

```bash
npm -w @hustronix/web run dev
npm -w @hustronix/web run build
npm -w @hustronix/web run start
npm -w @hustronix/web run lint
```

## Environment

Copy `.env.example` to `.env.local`.

- Leave `NEXT_PUBLIC_API_URL` empty to use same-origin `/api/*` rewrites.
- Set `API_PROXY_TARGET=http://127.0.0.1:3005` for split local dev.
- Set `NEXT_PUBLIC_WS_URL` only when WebSocket runs on a separate origin.
# Hustronix UI (production frontend)

Next.js 16 (App Router). Requires **Node.js 20+**.

## Run against the API

1. Start the backend from the repo root: `npm run dev` (default `http://127.0.0.1:3005`).
2. Copy `.env.example` to `.env.local` and adjust URLs if needed.
3. From this folder: `npm run dev` (default `http://localhost:3000`).

The API must allow your origin (`ALLOWED_ORIGINS` in the backend `.env`, defaults include `http://localhost:3000`).

### Wiring

| Area | Status |
|------|--------|
| Mission Control, Execute, Signals, Chat | Live API / WebSocket |
| Settings → General → Session | Login/register → sets `localStorage` `hustronix_userId` |
| Settings → Connections | Live `GET /api/connections` + Sync |
| Reports, Teams, Profile | UI mock data only (not wired yet) |

A red **API health** banner appears if `/api/health` is unreachable.

## Build

```bash
npm run build
npm start
```
