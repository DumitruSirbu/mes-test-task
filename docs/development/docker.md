# Docker

## Services in `docker-compose.yml`

| Service | Image | Ports | Healthcheck |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | `pg_isready` |
| `redis` | `redis:7-alpine` | 6379 | `redis-cli ping` |
| `backend` (M09) | local build | 3000 | `/health/ready` |
| `web` (M09) | local build (nginx) | 5173 | `wget /` |
| `admin` (M09) | local build (nginx) | 5174 | `wget /` |

## Common commands

```bash
docker compose up -d            # start infra only (M01-M08)
docker compose up               # start everything (M09)
docker compose logs -f backend
docker compose down             # stop, keep volumes
docker compose down -v          # stop and wipe DB
```

## Migrations on container start

The backend image's entrypoint runs `pnpm run migration:run` before `node dist/main.js`. Configured in M09 via `apps/backend/docker-entrypoint.sh`.

## Volumes

- `postgres_data` — Postgres data dir.
- `redis_data` — Redis persistence (AOF).
