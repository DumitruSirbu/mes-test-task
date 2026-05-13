# Development Setup

## Prerequisites

- Node 22 LTS
- pnpm 9 (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker + Docker Compose

## One-command startup (recommended)

```bash
git clone <repo>
cd mes-test-task
docker compose up
```

That single command builds and starts the full stack — postgres, redis, backend (NestJS,
migrations applied on boot), and web (Vite SPA served by nginx). When the output
settles, hit:

- Backend: <http://localhost:3010/health/ready>
- Web:     <http://localhost:5173>

`.env` is optional for the default config; compose falls back to the `${VAR:-default}`
values inline in `docker-compose.yml`. Copy `.env.example` to `.env` only when you need
to override something (e.g. a real `JWT_SECRET`).

See [docker.md](./docker.md) for the full image / env-injection details.

## Native dev (without backend/web containers)

For fast hot-reload iteration, run infra in Docker and the apps natively:

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres redis
pnpm --filter backend run migration:run
```

Then in separate terminals:

```bash
pnpm dev:backend   # http://localhost:3010
pnpm dev:web       # http://localhost:5173
pnpm dev:admin     # http://localhost:5174
```

When running natively, point `POSTGRES_HOST=localhost` (and `REDIS_HOST=localhost`) in
your `.env` — the compose containers expose those ports on the host.

## Common commands

| Command | Purpose |
|---|---|
| `docker compose up` | Build + start full stack |
| `docker compose down -v` | Stop + wipe volumes |
| `pnpm -r build` | Build every workspace |
| `pnpm -r lint` | Lint every workspace |
| `pnpm -r test` | Run all test suites |
| `pnpm format` | Apply Prettier across the repo |
| `pnpm --filter backend run migration:generate -- src/migration/<Name>` | Generate a new migration |
| `pnpm --filter backend run migration:run` | Apply pending migrations (native dev) |
| `docker compose logs -f backend` | Tail backend logs |

## See also

- [docker.md](./docker.md)
- [environment.md](./environment.md)
