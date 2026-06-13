# Hustronix OS

Hustronix is a decision and execution platform: an Express/WebSocket API, a Next.js mission-control UI, shared API contracts, deployment infrastructure, and operational scripts.

## Repository Layout

```text
apps/
  api/              Express API, WebSocket server, agent runtime, SQLite adapter
  web/              Next.js App Router frontend
packages/
  shared/           Shared DTOs, enums, and schemas used by API and web
infra/
  docker/           Dockerfile and local production-like Compose stack
  fly/              Fly.io deployment manifest
  db/postgres/      PostgreSQL schema and migration target
ops/
  scripts/          QA, migrations, smoke checks, report utilities
docs/               Product, integration, and security documentation
data/               Local SQLite runtime data (ignored except .gitkeep)
```

## Quick Start

```bash
npm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
npm run dev
```

Open `http://localhost:3000`.

Development defaults:

| Service | Command | Port |
| --- | --- | --- |
| API + Web | `npm run dev` | API 3005, web 3000 |
| API only | `npm run dev:api` | 3005 |
| Web only | `npm run dev:web` | 3000 |
| Unified dev | `npm run dev:unified` | 3000 |

## Environment

Root `.env` is for the API and shared server-side secrets. `apps/web/.env.local` is for Next.js and local proxy settings.

Important variables:

- `ALLOWED_ORIGINS` - browser origins allowed to call the API, usually `http://localhost:3000` in dev.
- `APP_ORIGIN` - public UI origin for OAuth and redirects.
- `MISSION_CONTROL_API_KEY` - change the example value before production.
- `SQLITE_PATH` - SQLite file path, default `./data/hustronix.db`; containers use `/app/data/hustronix.db`.
- `API_PROXY_TARGET` - web server rewrite target for `/api/*` in split dev mode.

See `.env.example` and `apps/web/.env.example` for the full set.

## Common Commands

```bash
npm run build          # shared + API + web
npm run start:unified  # production unified server after build
npm run security:launch
npm run qa:ui
npm run db:pg:migrate
```

Workspace-specific commands:

```bash
npm -w @hustronix/api run build
npm -w @hustronix/web run lint
npm -w @hustronix/shared run build
```

## Production Runtime

The preferred production mode is the unified server: API, WebSocket, and Next.js served from one process and one port.

```bash
npm run build
NODE_ENV=production PORT=3000 npm run start:unified
```

Health check:

```bash
curl http://localhost:3000/api/health
```

## Docker

Build from the repository root:

```bash
docker build -f infra/docker/Dockerfile -t hustronix .
docker run --env-file .env -p 3000:3000 -v hustronix-data:/app/data hustronix
```

Compose:

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

## Fly.io

```bash
fly deploy -c infra/fly/fly.toml
```

Before deploying, set secrets:

```bash
fly secrets set \
  ANTHROPIC_API_KEY=... \
  MISSION_CONTROL_API_KEY=... \
  ALLOWED_ORIGINS=https://your-app.fly.dev \
  APP_ORIGIN=https://your-app.fly.dev
```

## Azure Container Apps (`app.hustronix.online`)

The production target. Bicep template, Key Vault wiring, ACR build pipeline, and a one-script deploy live in [`infra/azure/`](infra/azure/README.md).

```bash
export ACR_NAME="hustronixprod"
export RESOURCE_GROUP="hustronix-prod"
./infra/azure/deploy.sh
```

The script builds the image inside Azure (no local Docker required), rolls a new Container App revision, and prints the FQDN. CI deploys on `v*` tags via `.github/workflows/deploy-azure.yml`. Pair this with `hustronix.online` on Netlify for the marketing surface — see [`netlify-landing/`](netlify-landing/).

## Production Checklist

1. `NODE_ENV=production`
2. Change `MISSION_CONTROL_API_KEY` from the example value.
3. Set `ALLOWED_ORIGINS` and `APP_ORIGIN` to exact HTTPS origins.
4. Set `REQUIRE_HTTPS=true` behind TLS termination.
5. Generate and set `OAUTH_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`) — without this no integration can store tokens.
6. Generate and set `TOTP_ENCRYPTION_KEY` (`openssl rand -hex 32`) — required for app-based 2FA.
7. Configure LLM keys (`ANTHROPIC_API_KEY` for the coordinator, `OPENAI_API_KEY` if you flip `ACTIVE_PROVIDER`).
8. Wire per-provider integration credentials in `.env` / Key Vault (`SLACK_*`, `GITHUB_OAUTH_*`, `GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*`, `NOTION_OAUTH_*`, `JIRA_OAUTH_*`, `LINEAR_OAUTH_*`) — the boot log prints a `📡 Integrations:` summary so you can see exactly what's live.
9. Mount persistent storage for `SQLITE_PATH` (Azure Files share for ACA, named volume for Docker, persistent disk for Fly).
10. Run `npm run security:launch`.
11. Run `npm run build` and `npm run qa:ui` before release.

## Notes For Engineers

- `packages/shared` contains shared contracts only. Keep runtime logic in the owning app until duplication proves it should move.
- API routes should use `authMiddleware` and scope by `(req as any).userId`.
- UI API access should go through `apps/web/src/lib/api.ts`.
- PostgreSQL schema exists under `infra/db/postgres`; runtime is still SQLite until the repository cutover is complete.
