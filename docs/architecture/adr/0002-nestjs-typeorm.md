# ADR 0002 — NestJS + TypeORM + Postgres

> Status: draft. Finalised in M02 by `mes-architect`.

## Context

Backend stack choice for a JWT-secured REST API with relational data.

## Decision

NestJS 11 (controllers/services/DI/guards), TypeORM (migrations + repository pattern fit), Postgres 16.

## Consequences

- ✅ NestJS gives RBAC via guards, validation via pipes, DI for testability.
- ✅ TypeORM migration tooling supports the team's migration-driven workflow.
- ✅ Postgres satisfies JSONB needs (idempotency response storage) + strong ACID.

## Alternatives considered

- **Prisma.** Better DX but adds a separate `prisma generate` step and forks the repository-pattern conventions the team already uses.
- **Fastify alone.** Faster but loses the NestJS module/guard/pipe ecosystem the conventions assume.
