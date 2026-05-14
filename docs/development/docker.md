# Docker

## One-command startup

```bash
cp .env.example .env     # optional — compose defaults will work without it
docker compose up        # builds + starts postgres, redis, backend, web, admin
```

The first `docker compose up` builds the backend, web, and admin images (~30 s on a warm
Docker cache); subsequent runs reuse the cached layers. Tear down with `docker compose down`
(keep volumes) or `docker compose down -v` (wipe DB).

## Services in `docker-compose.yml`

| Service    | Image / Source                  | Host Port | Healthcheck                       |
|------------|---------------------------------|-----------|-----------------------------------|
| `postgres` | `postgres:16-alpine`            | 5432      | `pg_isready`                      |
| `redis`    | `redis:7-alpine`                | 6379      | `redis-cli ping`                  |
| `backend`  | `apps/backend/Dockerfile`       | 3010      | `wget /health/ready`              |
| `web`      | `apps/web/Dockerfile` (nginx)   | 5173      | `wget /`                          |
| `admin`    | `apps/admin/Dockerfile` (nginx) | 5174      | `wget /`                          |

`backend` depends on healthy `postgres` + `redis`; `web` and `admin` depend on healthy `backend`.
This means `docker compose up` blocks until the stack is reachable — no manual sequencing.

If the host's 5432 or 6379 ports are occupied by another project, override per-run:

```bash
POSTGRES_PORT=55432 REDIS_PORT=56379 docker compose up
```

## Backend image (multi-stage)

`apps/backend/Dockerfile` produces a slim Node 22 runtime image:

1. **deps** — `pnpm install --frozen-lockfile` against the workspace manifests only.
2. **build** — compiles `@mes/shared` (CommonJS-compatible JS via `tsconfig.build.json`)
   and the backend (`nest build` → `apps/backend/dist`). Rewrites `packages/shared/package.json`
   so the runtime image resolves `@mes/shared` to its compiled `dist/index.js`, not the
   `.ts` source — the runtime image carries no ts-node.
3. **runtime** — `node:22-alpine` + `tini` (PID 1 reaper) + `wget` (healthcheck) +
   the workspace `node_modules`, compiled `dist/`, and the shared package.

`apps/backend/docker-entrypoint.sh` runs **before** the Nest process every boot:

```sh
node ./node_modules/typeorm/cli.js migration:run -d dist/data-source.js
exec node dist/main.js
```

Migration failures abort the boot — a backend that runs against a stale schema is worse
than one that refuses to start (see ADR 0005). The typeorm CLI is invoked against the
**compiled** data-source, so the runtime image does not need ts-node.

## Web image (multi-stage)

`apps/web/Dockerfile` produces an `nginx:alpine` image serving the static Vite bundle:

1. **deps + build** — same workspace install recipe, then `vite build` emits
   `apps/web/dist/`. `VITE_API_BASE_URL` is a **build-time arg** (Vite inlines
   `import.meta.env.VITE_*` at compile time); rebuild the image to re-point the SPA
   at a different API host.
2. **runtime** — `nginx:1.27-alpine` with `apps/web/nginx.conf` (gzip on, long-cache
   hashed assets, SPA fallback to `/index.html` for the hash-router).

## Admin image (multi-stage)

`apps/admin/Dockerfile` follows the same pattern as the web image:

1. **deps + build** — workspace install, builds `@mes/shared` then `admin` via `vite build`,
   emitting `apps/admin/dist/`. `VITE_API_BASE_URL` is a build-time arg.
2. **runtime** — `nginx:1.27-alpine` with `apps/admin/nginx.conf` listening on port 5174
   (gzip on, long-cache hashed assets, SPA fallback to `/index.html` for HashRouter).

## Env injection strategy

Docker Compose automatically loads the root `.env` file for `${VAR:-default}` interpolation
inside `docker-compose.yml`. That interpolation is **file-level only** — it does not reach
the container's process env automatically.

**Postgres and Redis** receive their config through their `environment:` blocks. Those
vars are part of each image's expected env contract, so compose injects them directly.

**Backend** declares `env_file: - .env` (with `required: false`) so the container's
`process.env.*` is populated at runtime. Compose-level `environment:` overrides force
`POSTGRES_HOST=postgres` and `REDIS_HOST=redis` regardless of what the host's `.env`
points at (e.g. `localhost` for native-dev workflow). All sensitive vars (`JWT_SECRET`)
flow in via env interpolation only — never baked into image layers (see `.dockerignore`).

**Web** and **Admin** each receive `VITE_API_BASE_URL` as a build-time `args:` value. No
runtime env file is needed because static bundles have no `process.env` access.

**Copy `.env.example` to `.env` before the first `docker compose up`** if you need to
override any default (e.g. set a real `JWT_SECRET`). Without it, compose falls back to
the `${VAR:-default}` defaults baked into `docker-compose.yml`, which is sufficient for
local development.

**Never bake a `.env` file into an image via `COPY .env`.** The `.dockerignore` at the
repo root explicitly excludes `.env` (and `.env.*` except `.env.example`) so secrets
cannot leak into image layers via the build context.

`.env` is listed in `.gitignore`; only `.env.example` is committed.

## Common commands

```bash
docker compose up                   # build + start full stack (foreground)
docker compose up -d                # detached
docker compose up -d postgres redis # infra only (for native pnpm dev)
docker compose build                # build images without starting
docker compose logs -f backend      # tail backend logs
docker compose down                 # stop, keep volumes
docker compose down -v              # stop and wipe DB
```

## Volumes

- `postgres_data` — Postgres data dir.
- `redis_data` — Redis persistence (AOF).
