# @hustronix/os-ui

Default Hustronix OS product UI (Decision Intelligence shell).

## Stack

- Next.js App Router
- Talks to **`apps/api`** via same-origin `/api/*` rewrite (cookie session)
- Mock fixtures remain as fallback when unauthenticated

## Dev

From repo root:

```bash
npm install
npm run dev:api    # Express + WS on :3005
npm run dev:web    # this app on :3000
# or
npm run dev        # both
npm run dev:unified  # API serves this Next app on one PORT
```

Sign in at `/login` (registers against `/api/auth/*`).

## Backend mapping (ponytail)

| UI need | API |
|---------|-----|
| Alerts | `/api/notifications` |
| Decisions / commit | `/api/decisions`, `/api/decisions/commit` |
| Home metrics | `/api/mission-control/summary` |
| Execute | `/api/execution/*` |
| Settings / me | `/api/settings`, `/api/me` |
| Ask composer | live summary + canned; full agent = WebSocket `/ws` |
