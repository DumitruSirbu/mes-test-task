# Docker

## Services in `docker-compose.yml`

| Service | Image | Ports | Healthcheck |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | `pg_isready` |
| `redis` | `redis:7-alpine` | 6379 | `redis-cli ping` |
| `backend` (M09) | local build | 3010 | `/health/ready` |
| `web` (M09) | local build (nginx) | 5173 | `wget /` |
| `admin` (M09) | local build (nginx) | 5174 | `wget /` |

## Env injection strategy

Docker Compose automatically loads the root `.env` file for `${VAR:-default}` interpolation
inside `docker-compose.yml`. That interpolation is **file-level only** — it does not reach
the container's process env automatically.

**Postgres and Redis** receive their config through their `environment:` blocks. Those vars are
part of each image's expected env contract, so compose injects them directly; no `env_file:`
is needed on those services.

**App services (backend, web, admin — added in M09) MUST declare `env_file: - .env`** so
that `process.env.*` reads inside the container are populated at runtime. Interpolation alone
is not enough.

**Copy `.env.example` to `.env` before the first `docker compose up`.** Without it, compose
falls back to the `${VAR:-default}` defaults baked into `docker-compose.yml`, which is
sufficient for a quick spin but not for any non-default config.

**Never bake a `.env` file into an image via `COPY .env`.** Doing so embeds secrets into
image layers, which persist in the image history even after the file is removed in a later
layer. Always inject env vars at runtime via `env_file:` on the compose service (dev) or
via orchestrator secrets (Kubernetes / ECS) in production.

`.env` is listed in `.gitignore`; only `.env.example` is committed.

## Future: backend service (M09)

Add this block to `docker-compose.yml` under `services:` when containerising the backend in M09.
Do **not** add it before then — the service definition belongs in the same PR that adds the Dockerfile.

```yaml
backend:
  build:
    context: .
    dockerfile: apps/backend/Dockerfile
    target: runtime
  container_name: mes-backend
  restart: unless-stopped
  env_file:
    - path: .env
      required: false       # inject all vars at runtime — never COPY .env into the image
  environment:
    POSTGRES_HOST: postgres # override host to the compose service name
    REDIS_HOST: redis
  ports:
    - '${BACKEND_PORT:-3010}:${BACKEND_PORT:-3010}'
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
  healthcheck:
    test: ['CMD-SHELL', 'wget -qO- http://localhost:${BACKEND_PORT:-3010}/health/ready || exit 1']
    interval: 10s
    timeout: 5s
    retries: 10
```

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
