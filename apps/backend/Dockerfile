# syntax=docker/dockerfile:1.7
#
# Backend image — multi-stage build for the NestJS service.
#
# Stages:
#   1. deps     — install workspace dependencies once with the full pnpm lockfile.
#   2. build    — compile @mes/shared (type-check) and apps/backend to dist/.
#   3. runtime  — slim production image: prod-only node_modules + dist + entrypoint.
#
# The entrypoint applies pending TypeORM migrations against the compiled
# data-source before launching the Nest process (see docker-entrypoint.sh).

ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------------------
# Stage 1 — deps: install workspace dependencies
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy workspace manifests first so the dependency layer caches independently of source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2 — build: compile shared + backend
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

# Emit shared as CommonJS-compatible JS so the runtime backend can `require("@mes/shared")`
# without ts-node. The dev tsconfig stays --noEmit; tsconfig.build.json flips that for prod.
# Then nest build emits apps/backend/dist.
RUN pnpm --filter @mes/shared exec tsc -p tsconfig.build.json \
    && pnpm --filter backend run build

# Rewrite the shared package manifest so Node resolves the emitted JS at runtime instead of
# the .ts barrel. The runtime image never carries ts-node, so this swap is mandatory.
RUN node -e "const fs=require('fs');const p='packages/shared/package.json';const m=JSON.parse(fs.readFileSync(p,'utf8'));m.main='./dist/index.js';m.types='./dist/index.d.ts';m.exports={'.':{'types':'./dist/index.d.ts','default':'./dist/index.js'},'./enums/*':{'types':'./dist/enums/*.d.ts','default':'./dist/enums/*.js'},'./types/*':{'types':'./dist/types/*.d.ts','default':'./dist/types/*.js'},'./schemas/*':{'types':'./dist/schemas/*.d.ts','default':'./dist/schemas/*.js'}};fs.writeFileSync(p,JSON.stringify(m,null,2));"

# ---------------------------------------------------------------------------
# Stage 3 — runtime: production image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

WORKDIR /app

# wget is used by the compose healthcheck; tini reaps zombie processes (TypeORM CLI subprocess).
RUN apk add --no-cache wget tini \
    && corepack enable && corepack prepare pnpm@9.12.0 --activate

ENV NODE_ENV=production

# Copy the full workspace install. Migrations need the typeorm CLI from node_modules; the
# CLI runs the compiled data-source.js so ts-node is not required at runtime. Keeping the
# workspace layout intact also lets @mes/shared resolve via its workspace symlink.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml ./

COPY --from=build /repo/packages/shared ./packages/shared

COPY --from=build /repo/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /repo/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /repo/apps/backend/dist ./apps/backend/dist

COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/apps/backend

EXPOSE 3010

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
