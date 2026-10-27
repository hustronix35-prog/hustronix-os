# Hustronix OS unified production image (API + WebSocket + Next.js os-ui on one PORT).
# Build from repo root:
#   docker build -f infra/docker/Dockerfile -t hustronix .

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ curl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/os-ui/package.json ./apps/os-ui/package.json
# Lockfile lists @hustronix/web; package.json is enough for workspace resolution (not built in image).
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/os-ui ./apps/os-ui
ENV UNIFIED_SERVER=1
RUN npm run build:all

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV UNIFIED_SERVER=1
ENV SQLITE_PATH=/app/data/hustronix.db

WORKDIR /app
RUN mkdir -p /app/data

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/os-ui/package.json ./apps/os-ui/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --omit=dev

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/public ./apps/api/public
COPY --from=build /app/apps/os-ui/.next ./apps/os-ui/.next
COPY --from=build /app/apps/os-ui/public ./apps/os-ui/public
COPY --from=build /app/apps/os-ui/next.config.ts ./apps/os-ui/next.config.ts
COPY --from=build /app/apps/os-ui/package.json ./apps/os-ui/package.json

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -sf "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["node", "apps/api/dist/unified-server.js"]
