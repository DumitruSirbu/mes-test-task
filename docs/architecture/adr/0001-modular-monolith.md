# ADR 0001 — Modular Monolith over Microservices

> Status: draft. Finalised in M02 by `mes-architect`.

## Context

The MES test task requires a parent-purchase → student-onboarding → LMS-access flow, deliverable in 3–4 hours, runnable via a single `docker compose up`. The evaluator explicitly cares about architecture and engineering judgment.

## Decision

Build the backend as a **single NestJS service (modular monolith)** with clean module boundaries: `auth`, `users`, `courses`, `purchases`, `invitations`, `lms`, `notifications`, `admin`.

## Consequences

- ✅ Fast to ship within budget.
- ✅ Single deployable, single `docker compose up`.
- ✅ Easy cross-module transactions (purchase + invitation issuance atomicity).
- ⚠️ Future split requires extracting modules into services + introducing an API gateway or service-to-service contracts.

## Alternatives considered

- **Microservices (3+ services + gateway).** Rejected: overhead in build, deploy, debugging, and intra-service contracts exceeds the time budget. Adds genuine value only when independent teams ship on independent cadences — not the case here.
- **Serverless functions per endpoint.** Rejected: cold starts, fragmented logging/observability, harder to enforce RBAC + idempotency consistently.

## Seams for future split

If scaled, the natural cut lines are:
- `notifications` → its own service (email + push provider).
- `payments` (when real) → its own service for compliance.
- `lms` → its own service for content-heavy workloads.

These seams are deliberately preserved by the module boundary rules in the conventions doc.
