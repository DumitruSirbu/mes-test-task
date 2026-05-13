# Development Setup

## Prerequisites

- Node 22 LTS
- pnpm 9 (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker + Docker Compose

## First run

> **Required before `docker compose up`:** copy `.env.example` to `.env`.
> Docker Compose sources variable values (Postgres password, Redis port, etc.) from `.env`.
> Without it, compose falls back to the built-in `${VAR:-default}` values, which is fine for
> a quick first spin, but the `.env` copy is needed for any non-default config and for the
> backend container (added in M09) to receive all its variables.

```bash
git clone <repo>
cd mes-test-task
cp .env.example .env          # required — never committed, listed in .gitignore
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

## Common commands

| Command | Purpose |
|---|---|
| `pnpm -r build` | Build every workspace |
| `pnpm -r lint` | Lint every workspace |
| `pnpm -r test` | Run all test suites |
| `pnpm format` | Apply Prettier across the repo |
| `pnpm --filter backend run migration:generate -- src/migrations/<Name>` | Generate a new migration |
| `pnpm --filter backend run migration:run` | Apply pending migrations |
| `docker compose logs -f backend` | Tail backend logs |

## See also

- [docker.md](./docker.md)
- [environment.md](./environment.md)
