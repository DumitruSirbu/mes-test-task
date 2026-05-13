# Development Setup

## Prerequisites

- Node 22 LTS
- pnpm 9 (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker + Docker Compose

## First run

```bash
git clone <repo>
cd mes-test-task
cp .env.example .env
pnpm install
docker compose up -d postgres redis
pnpm --filter backend run migration:run
```

Then in separate terminals:

```bash
pnpm dev:backend   # http://localhost:3000
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
