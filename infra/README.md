# Infra

Deployment and data-platform assets.

```text
docker/       Production Dockerfile and local docker-compose stack
fly/          Fly.io manifest
db/postgres/  PostgreSQL schema and migration target
```

Build Docker from the repository root:

```bash
docker build -f infra/docker/Dockerfile -t hustronix .
```
