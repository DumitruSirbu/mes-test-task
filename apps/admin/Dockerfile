# syntax=docker/dockerfile:1.7
#
# Admin image — multi-stage build for the Vite/React admin SPA.
#
# Stages:
#   1. deps    — workspace dependency install (shared pnpm store cache).
#   2. build   — produce the static bundle in apps/admin/dist via `vite build`.
#   3. runtime — nginx:alpine serving the static bundle on port 5174.
#
# VITE_API_BASE_URL is a build-time arg because Vite inlines `import.meta.env.VITE_*`
# values into the bundle at compile time. To re-point the SPA at a different API host,
# rebuild the image with a different --build-arg.

ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.27-alpine

# ---------------------------------------------------------------------------
# Stage 1 — deps
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/admin/node_modules ./apps/admin/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/admin ./apps/admin

# Vite inlines VITE_* envs at build time; declare the contract here.
ARG VITE_API_BASE_URL=http://localhost:3010
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN pnpm --filter @mes/shared run build \
    && pnpm --filter admin run build

# ---------------------------------------------------------------------------
# Stage 3 — runtime: nginx serving the static bundle
# ---------------------------------------------------------------------------
FROM nginx:${NGINX_VERSION} AS runtime

# SPA-friendly nginx config: gzip on, fall back to index.html for client-side routing,
# listen on the same port the dev server uses so host-to-container mapping stays trivial.
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html

EXPOSE 5174

# Default nginx image already provides a sensible entrypoint + CMD; no override needed.
