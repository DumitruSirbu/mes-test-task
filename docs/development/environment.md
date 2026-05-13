# Environment Variables

See `.env.example` for the full canonical list with safe defaults.

| Variable | Required | Default | Used by | Purpose |
|---|---|---|---|---|
| `POSTGRES_USER` | ✅ | `mes` | postgres + backend | DB user |
| `POSTGRES_PASSWORD` | ✅ | `mes_dev_password` | postgres + backend | DB password — change in prod |
| `POSTGRES_DB` | ✅ | `mes` | postgres + backend | DB name |
| `POSTGRES_HOST` | ✅ | `postgres` | backend | DB host (use `localhost` for local dev) |
| `POSTGRES_PORT` | ✅ | `5432` | backend | DB port |
| `REDIS_HOST` | ✅ | `redis` | backend | Redis host |
| `REDIS_PORT` | ✅ | `6379` | backend | Redis port |
| `REDIS_PASSWORD` | ❌ | (empty) | backend | Optional Redis auth |
| `NODE_ENV` | ✅ | `development` | backend | Environment marker |
| `BACKEND_PORT` | ✅ | `3000` | backend | HTTP port |
| `JWT_SECRET` | ✅ | (dev-only default) | backend | JWT signing secret — REQUIRED in prod |
| `JWT_EXPIRES_IN` | ❌ | `15m` | backend | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | ❌ | `7d` | backend | Refresh token TTL (if implemented) |
| `LOG_LEVEL` | ❌ | `info` | backend | pino log level |
| `LOG_PRETTY` | ❌ | `true` | backend | Pretty-print logs in dev |
| `CORS_ORIGINS` | ❌ | localhost defaults | backend | Comma-separated allow-list |
| `INVITATION_TOKEN_TTL_HOURS` | ❌ | `72` | backend | Invitation expiry |
| `WEB_PORT` | ❌ | `5173` | web | Vite dev/preview port |
| `ADMIN_PORT` | ❌ | `5174` | admin | Vite dev/preview port |
| `VITE_API_BASE_URL` | ✅ | `http://localhost:3000` | web + admin | Backend base URL (build-time) |
