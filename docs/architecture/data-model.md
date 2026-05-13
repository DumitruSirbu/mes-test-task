# Data Model

> **Status:** finalised in M02 by `mes-architect`. All M03–M08 features map onto this schema. Any later change must come back here first.

The schema is migration-driven (TypeORM `synchronize: false`). DB columns are `snake_case`, TS properties `camelCase`; entity files declare both per `code-conventions.md`. All PKs are auto-increment `integer` named `<table>_id`. Every table carries `created_at` (`DEFAULT CURRENT_TIMESTAMP`); mutable tables also carry `updated_at` (`@BeforeUpdate` hook).

## Entity inventory

| Table | Purpose | Owning module | Introduced in |
|---|---|---|---|
| `users` | Auth identity for parents, students, admins | `users` | M03 |
| `courses` | Catalog of purchasable courses | `courses` | M04 |
| `purchases` | Parent's purchase of a course; idempotent | `purchases` | M04 |
| `invitations` | Single-use signed token a parent sends a student | `invitations` | M04 |
| `enrolments` | Grant: student ↔ course access | `lms` | M05 |
| `lessons` | Per-course lesson content | `lms` | M06 |
| `idempotency_keys` | Replay-safe storage for POST endpoints | `common/idempotency` | M04 |

> **Decision: no separate `parent_profiles` / `student_profiles` tables in v1.** Profile fields (`firstName`, `lastName`, `dateOfBirth`) live on `users` as nullable columns and are populated at signup (parent) or invitation redemption (student). Splitting becomes worthwhile when role-specific fields multiply; for this scope the join cost is not justified.

## ER diagram (textual)

```
users (1) ───< (N) purchases (1) ───< (N) invitations
   │                                          │
   │                                          │ (on redeem)
   │                                          ▼
   └──────────────< (N) enrolments >──────────┘
                          │
                          ▼
                       courses (1) ───< (N) lessons
                          ▲
                          │
                       enrolments.course_id ──► courses.course_id

users (1) ───< (N) idempotency_keys   [logical link, no FK enforcement: rows can outlive users in audit retention]
```

## PostgreSQL ENUM types

Every fixed-value status/role column in this schema is a **native PostgreSQL ENUM**, not a `varchar(N) + CHECK`. The catalogue:

```sql
CREATE TYPE user_role        AS ENUM ('PARENT', 'STUDENT', 'ADMIN');
CREATE TYPE course_subject   AS ENUM ('MATHS', 'ENGLISH', 'SCIENCE');
CREATE TYPE purchase_status  AS ENUM ('COMPLETED');
CREATE TYPE invitation_status AS ENUM ('ISSUED', 'REDEEMED', 'EXPIRED');
```

**Why native ENUM over `varchar + CHECK`:**

- **Compact storage** — ENUMs are stored as a 4-byte OID reference into the type catalog, not the literal string. Cheaper than `varchar(16)` per row.
- **Native sort order** — ENUMs sort by declaration order, not lexicographically. Useful when status order has meaning (`ISSUED < REDEEMED < EXPIRED`).
- **Type-safe at the DB layer** — an unrecognised literal fails at parse time with a clear `invalid input value for enum` error; CHECK constraint violations are reported as generic constraint errors.
- **Centralised vocabulary** — the type definition is the single DB-side source of truth; new columns reusing the type cannot drift.

**v2 upgrade path:**

- **Adding values** is non-blocking since PostgreSQL 12: `ALTER TYPE purchase_status ADD VALUE 'PENDING'` and `... ADD VALUE 'FAILED'` are the planned v2 migrations. No table rewrite.
- **Removing values** is not supported directly — it requires a column-rewrite migration (cast column to text, drop the type, create a new type, cast back). Treat the value set as append-mostly.
- **Renaming values** is supported via `ALTER TYPE ... RENAME VALUE 'OLD' TO 'NEW'` since PG 10.

**TypeORM mapping rule:** entity columns use `@Column({ type: 'enum', enum: UserRoleEnum, enumName: 'user_role' })` so the generated migration matches the manual `CREATE TYPE`. Always pass `enumName` explicitly — never let TypeORM auto-name the type (it generates `<table>_<column>_enum`, which then drifts from the manual DDL).

A `purchase` belongs to one parent (`users.user_id` where `role = UserRoleEnum.PARENT`) and one `course`. Each purchase produces exactly one `invitation` in the same transaction. When the invitation is redeemed a STUDENT user is created — see the **Redeem flow** section below for the strict single-account-per-email rule — and an `enrolments` row is written for `(student_user_id, course_id)`. Lessons are read-only per `course`.

## Redeem flow (single-account-per-email invariant)

`POST /invitations/redeem` accepts `{ token, password, firstName, lastName, dateOfBirth }`. The handler resolves three cases by email:

| Pre-existing user with the invitation's `student_email`? | Outcome |
|---|---|
| No row | Create new `users` row with `role = UserRoleEnum.STUDENT`; insert `enrolments` row; mark invitation redeemed |
| Yes — any role (`PARENT`, `STUDENT`, `ADMIN`) | Throw `InvitationEmailConflictError` (code `INVITATION_EMAIL_CONFLICT`, HTTP 410) |

v1 enforces a strict **one identity per email** rule across all roles. There is no "link to existing account" path; if a parent invites a student whose email already exists in any role, the parent must use a different email. This keeps the invitation flow oracle-resistant (see `auth-and-rbac.md`) and removes the need to verify a password during redemption.

### Atomic redeem transition

The status flip uses a single conditional UPDATE:

```sql
UPDATE invitations
   SET status = 'REDEEMED', redeemed_at = now()
 WHERE token_hash = $1
   AND status = 'ISSUED'
   AND expires_at > now()
RETURNING invitation_id, purchase_id, student_email;
```

Zero rows affected is the canonical failure path — the handler then disambiguates by reading the row by `token_hash` and throws one of the domain error classes defined in ADR 0005:

- not found → throw `InvitationNotFoundError` (code `INVITATION_NOT_FOUND`, HTTP 410)
- `status = 'REDEEMED'` → throw `InvitationAlreadyRedeemedError` (code `INVITATION_ALREADY_REDEEMED`, HTTP 410)
- `expires_at <= now()` → throw `InvitationExpiredError` (code `INVITATION_EXPIRED`, HTTP 410)

All three (plus the `InvitationEmailConflictError` branch above) return HTTP 410 with the same body shape and similar response time (no early-exit branches), per the security oracle policy in `auth-and-rbac.md`. The global `HttpExceptionFilter` (ADR 0005) is what renders the response; services only throw the typed `DomainError` subclass.

## `users`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | `integer` | PK, auto-increment | |
| `email` | `varchar(255)` | NOT NULL, UNIQUE | citext-style lower-case at write |
| `password_hash` | `varchar(255)` | NOT NULL | argon2id encoded string |
| `role` | `user_role` | NOT NULL | PG native ENUM; mirrors `UserRoleEnum` |
| `first_name` | `varchar(80)` | NULL | filled at signup (parent) / redeem (student) |
| `last_name` | `varchar(80)` | NULL | same |
| `date_of_birth` | `date` | NULL | student onboarding only |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | `@BeforeUpdate` |

**Indexes:** (see consolidated table below)
- `IDX_users_email_unique` UNIQUE on `email`
- `IDX_users_role` on `role` (admin listings filter by role)

**Rationale:**
- Role as a native PG ENUM (`user_role`): 4-byte storage, declaration-order sorting, and a type-safe error if an unknown literal is written. Mirrors `UserRoleEnum` in `packages/shared` — the TS enum is still the canonical vocabulary; the DB type is the persistence-layer enforcement of it. See the "PostgreSQL ENUM types" section above.
- Email unique constraint is the single source of truth for "one identity per email", whether parent or student. A pre-existing user with that email — regardless of role — causes redeem to throw `InvitationEmailConflictError` (HTTP 410). There is no link-to-existing-account path in v1; single-account-per-email is the invariant.

## `courses`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `course_id` | `integer` | PK, auto-increment | |
| `subject` | `course_subject` | NOT NULL | PG native ENUM; mirrors `CourseSubjectEnum` |
| `year_from` | `smallint` | NOT NULL | inclusive school year, e.g. 5 |
| `year_to` | `smallint` | NOT NULL | inclusive |
| `title` | `varchar(120)` | NOT NULL | seeded, e.g. "Maths Year 7" |
| `price_pence` | `integer` | NOT NULL, CHECK >= 0 | money in minor units; £199 → 19900 |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** (see consolidated table below)
- `IDX_courses_subject_year_unique` UNIQUE on `(subject, year_from, year_to)` — prevents duplicate catalog rows; leading column `subject` also covers any subject-prefixed admin filter

> A standalone `IDX_courses_subject` was considered and rejected — the composite UNIQUE already covers `subject`-prefix lookups, and `courses` is a tiny read-mostly table where duplicating index maintenance has no upside. See the consolidated section.

**Seed data (M04 migration):**
- Maths Y5, Y6, Y7, Y8, Y9, Y10, Y11, Y12, Y13
- English Y5–Y13
- Science Y5–Y11
- All at `price_pence = 19900` (£199)

## `purchases`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `purchase_id` | `integer` | PK, auto-increment | |
| `parent_user_id` | `integer` | NOT NULL, FK → `users.user_id` ON DELETE RESTRICT | enforces parent existence |
| `course_id` | `integer` | NOT NULL, FK → `courses.course_id` ON DELETE RESTRICT | |
| `status` | `purchase_status` | NOT NULL | PG native ENUM; mirrors `PurchaseStatusEnum`. v1 declares the type with a single value `'COMPLETED'`; `PENDING` / `FAILED` are deferred to v2 and added via `ALTER TYPE purchase_status ADD VALUE ...` (non-blocking on PG 12+) when a real PSP is integrated |
| `amount_pence` | `integer` | NOT NULL, CHECK >= 0 | snapshot of price at purchase time |
| `idempotency_key` | `varchar(64)` | NOT NULL | client-supplied opaque key; denormalised from `idempotency_keys.key` so the per-table UNIQUE below acts as a secondary safety net — see ADR 0006 |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** (see consolidated table below)
- `IDX_purchases_parent` on `parent_user_id` (used by `GET /me/purchases`; also satisfies the FK-indexing convention)
- `IDX_purchases_status` on `status` (admin listings)
- `IDX_purchases_parent_idemkey_unique` UNIQUE on `(parent_user_id, idempotency_key)` — second layer of defence; the primary idempotency check lives in `idempotency_keys`. A UNIQUE-violation on either index is caught by `IdempotencyInterceptor` and either translated into the idempotent-replay response, or wrapped as `IdempotencyKeyReusedError` (code `IDEMPOTENCY_KEY_REUSED`, HTTP 409) when the request body matches but the original response has not yet been stored, or wrapped as `IdempotencyBodyMismatchError` (code `IDEMPOTENCY_BODY_MISMATCH`, HTTP 409) when the request body differs. The raw `QueryFailedError` MUST NOT surface as a 500 (it is passed as `cause` on the wrapping `DomainError` for log correlation — see ADR 0005).

**State machine:** v1 inserts the row directly as `COMPLETED` inside the purchase transaction. `PENDING` / `FAILED` are not part of the v1 state space; they enter the `purchase_status` ENUM via `ALTER TYPE ... ADD VALUE` when v2 introduces a real (asynchronous) payment provider.

## `invitations`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `invitation_id` | `integer` | PK, auto-increment | |
| `purchase_id` | `integer` | NOT NULL, FK → `purchases.purchase_id` ON DELETE CASCADE | |
| `token_hash` | `char(64)` | NOT NULL, UNIQUE | hex-encoded SHA-256 of the opaque token; the plaintext token is **never** stored — it lives only in the email link delivered to the recipient |
| `student_email` | `varchar(255)` | NOT NULL | target — must not match any existing `users.email` (rejected at redeem; see Redeem flow) |
| `status` | `invitation_status` | NOT NULL | PG native ENUM; mirrors `InvitationStatusEnum` |
| `expires_at` | `timestamptz` | NOT NULL | issued at + 14 days |
| `redeemed_at` | `timestamptz` | NULL | set by `POST /invitations/redeem` |
| `email_sent_at` | `timestamptz` | NULL | set by the BullMQ processor in M08; column is created up-front in the `CreateInvitationsTable` migration to avoid an ALTER later |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Token generation & storage:**
- Token is `crypto.randomBytes(32)` base64url-encoded (≥ 256 bits of entropy).
- Backend stores **only** SHA-256 of the token in `token_hash`. Lookups are constant-time: SHA-256 the incoming token, then `WHERE token_hash = $1`.
- The HMAC-signed `invitationId.nonce` scheme considered in earlier drafts is rejected — leaking the table contents would let an attacker reverse-derive any token. With hashed storage, a DB dump exposes no live tokens.

**Indexes:** (see consolidated table below)
- `IDX_invitations_token_hash_unique` UNIQUE on `token_hash` — lookup by hashed token is the hot path (`POST /invitations/redeem`, `GET /invitations/:token/meta`)
- `IDX_invitations_purchase` on `purchase_id` — FK index; supports `POST /admin/invitations/:id/resend` adjacent reads and CASCADE delete from `purchases`

**State machine:** `ISSUED → REDEEMED` (success) or `ISSUED → EXPIRED` (after `expires_at`, lazy transition on read). Re-redeem from `REDEEMED` returns 410 `INVITATION_ALREADY_REDEEMED`. See **Redeem flow** above for the atomic conditional UPDATE.

## `enrolments`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `enrolment_id` | `integer` | PK, auto-increment | |
| `student_user_id` | `integer` | NOT NULL, FK → `users.user_id` ON DELETE CASCADE | |
| `course_id` | `integer` | NOT NULL, FK → `courses.course_id` ON DELETE RESTRICT | |
| `source_invitation_id` | `integer` | NULL, FK → `invitations.invitation_id` ON DELETE SET NULL | audit link |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** (see consolidated table below)
- `IDX_enrolments_student` on `student_user_id` (used by `GET /me/courses`; FK index)
- `IDX_enrolments_student_course_unique` UNIQUE on `(student_user_id, course_id)` — one grant per pair; leading column also services the enrolment check on `GET /courses/:id/lessons` and `GET /lessons/:id`

## `lessons`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `lesson_id` | `integer` | PK, auto-increment | |
| `course_id` | `integer` | NOT NULL, FK → `courses.course_id` ON DELETE CASCADE | |
| `title` | `varchar(160)` | NOT NULL | |
| `body` | `text` | NOT NULL | Markdown-ish; rendered safely on the client |
| `order_index` | `smallint` | NOT NULL | display order within the course |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** (see consolidated table below)
- `IDX_lessons_course_order_unique` UNIQUE on `(course_id, order_index)` — stable ordering; leading column `course_id` also covers FK lookups + CASCADE delete from `courses`

**Seed (M06):** 3–5 placeholder lessons per course.

## `idempotency_keys`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `idempotency_key_id` | `integer` | PK, auto-increment | |
| `key` | `varchar(64)` | NOT NULL | client-supplied opaque key (UUID v4 recommended), max 64 chars; the interceptor validates length 8–64 and charset `[A-Za-z0-9_-]` before any DB read |
| `user_id` | `integer` | NOT NULL | scope keys per caller (no FK — see note) |
| `endpoint` | `varchar(120)` | NOT NULL | e.g. `POST /purchases` |
| `request_hash` | `varchar(64)` | NOT NULL | sha-256 of canonicalised body; lets us 409 on key reuse with different body |
| `response_status` | `smallint` | NOT NULL | HTTP status of the original response |
| `response_body` | `jsonb` | NOT NULL | original response, replayed verbatim |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | retention: 24h sweep (out of scope for v1) |

**Indexes:** (see consolidated table below)
- `IDX_idempotency_keys_user_endpoint_key_unique` UNIQUE on `(user_id, endpoint, key)` — the lookup index; scoped to user to prevent cross-tenant key collisions

**Why no FK on `user_id`:** keys are retained for audit even if the user is deleted, and we want the interceptor to never block on FK validation when reading a replay.

**UNIQUE-violation translation:** when two concurrent purchase attempts race past the SELECT and both try to INSERT, Postgres raises a `23505` on `IDX_idempotency_keys_user_endpoint_key_unique` (or the per-table `IDX_purchases_parent_idemkey_unique` safety-net). The `IdempotencyInterceptor` catches the `QueryFailedError`, re-reads the stored row, and returns the canonical replay response. If the stored row's `request_hash` does not match the incoming body, the interceptor throws `IdempotencyBodyMismatchError` (code `IDEMPOTENCY_BODY_MISMATCH`, HTTP 409) instead. The raw `QueryFailedError` is never surfaced as a 500 — it is passed as `cause` on whichever `DomainError` the interceptor decides to throw (see ADR 0005).

## Indexes (consolidated)

This section is the single source of truth for every index created across the schema. Inline `Indexes` blocks in the per-table sections above repeat the names for readability; if the two ever drift, **this table wins**. Migrations create indexes explicitly (no `synchronize: true` — see ADR 0002).

### FK indexing convention

PostgreSQL does **not** automatically create an index for foreign-key columns. The convention for v1:

> **Every FK column gets a BTREE index unless the parent table is small enough (e.g. `courses`, with ~30 seed rows) that a sequential scan is always cheaper than an index lookup.**

The convention serves two cases that show up in this schema:

- **JOIN / lookup performance** for queries that filter children by parent (e.g. `purchases` by `parent_user_id`, `invitations` by `purchase_id`).
- **CASCADE delete performance** — when a parent row is deleted, Postgres must locate every child row referencing it; without an index on the FK column that scan is sequential.

Where a FK column happens to be the leading column of an existing composite index (e.g. `lessons.course_id` in `IDX_lessons_course_order_unique`), that composite covers the FK and no separate index is added.

### Index inventory

| Table | Index name | Columns | Type | Justification (query / endpoint) | Status |
|---|---|---|---|---|---|
| `users` | `IDX_users_email_unique` | `(email)` | UNIQUE | `POST /auth/login` (find by email); `POST /auth/signup` duplicate check; `POST /invitations/redeem` existing-user conflict check; enforces single-identity-per-email invariant | PRE-EXISTING |
| `users` | `IDX_users_role` | `(role)` | BTREE | `GET /admin/*` user listings filter by role. Indexed on the `user_role` ENUM column — PG indexes ENUMs identically to varchar (BTREE on the 4-byte OID), justification unchanged | PRE-EXISTING |
| `courses` | `IDX_courses_subject_year_unique` | `(subject, year_from, year_to)` | UNIQUE | Prevents duplicate catalog rows at seed time; covers `subject`-prefixed lookups | PRE-EXISTING |
| `purchases` | `IDX_purchases_parent` | `(parent_user_id)` | BTREE | `GET /me/purchases` (list parent's purchases); FK index on `parent_user_id` | PRE-EXISTING |
| `purchases` | `IDX_purchases_status` | `(status)` | BTREE | `GET /admin/*` purchase listings filter by status | PRE-EXISTING |
| `purchases` | `IDX_purchases_parent_idemkey_unique` | `(parent_user_id, idempotency_key)` | UNIQUE | Second-layer idempotency safety net for `POST /purchases`; UNIQUE-violation caught by `IdempotencyInterceptor` (see ADR 0006) | PRE-EXISTING |
| `invitations` | `IDX_invitations_token_hash_unique` | `(token_hash)` | UNIQUE | `POST /invitations/redeem` and `GET /invitations/:token/meta` — primary hot-path lookup; UNIQUE also guarantees no token-hash collision | PRE-EXISTING |
| `invitations` | `IDX_invitations_purchase` | `(purchase_id)` | BTREE | FK index — supports CASCADE delete from `purchases` and `POST /admin/invitations/:id/resend` reads | PRE-EXISTING |
| `enrolments` | `IDX_enrolments_student` | `(student_user_id)` | BTREE | `GET /me/courses` (list enrolled courses); enrolment check on `GET /courses/:id/lessons` and `GET /lessons/:id` (filter by `student_user_id` AND `course_id` — leading column of this index); FK index covers CASCADE delete from `users` | PRE-EXISTING |
| `enrolments` | `IDX_enrolments_student_course_unique` | `(student_user_id, course_id)` | UNIQUE | One enrolment per (student, course); the redeem flow relies on this for the conflict path | PRE-EXISTING |
| `lessons` | `IDX_lessons_course_order_unique` | `(course_id, order_index)` | UNIQUE | `GET /courses/:id/lessons` ordered listing; leading column `course_id` also covers FK lookups + CASCADE delete from `courses` | PRE-EXISTING |
| `idempotency_keys` | `IDX_idempotency_keys_user_endpoint_key_unique` | `(user_id, endpoint, key)` | UNIQUE | Replay-detection lookup on every idempotent POST; per-tenant scoping prevents cross-user key collisions | PRE-EXISTING |

### Considered but rejected (with reason)

| Candidate index | Reason rejected |
|---|---|
| `courses(subject)` standalone BTREE (previously `IDX_courses_subject`) | Removed. `IDX_courses_subject_year_unique` already covers `subject`-prefix queries; a duplicate single-column index just doubles write cost on a tiny, read-mostly table. |
| `invitations(status, expires_at)` (previously `IDX_invitations_status_expires`) | Removed. No v1 query filters by `(status, expires_at)`: `GET /invitations/:token/meta` and redeem look up by `token_hash` first, the conditional UPDATE in the redeem flow then re-checks `status` / `expires_at` on the single row returned by the UNIQUE token-hash lookup, and there is no expiry-sweep job in v1 (the row is lazily evaluated on read). Reintroduce when an admin "list pending invitations" endpoint or a background sweep is added — at that point a partial index `WHERE status = 'ISSUED'` becomes the right shape. |
| `invitations(student_email)` | The single-identity-per-email check at redeem time queries `users.email`, not `invitations.student_email`. No v1 query reads invitations by student email. |
| `enrolments(course_id)` | No v1 endpoint lists students by course (no admin "students in course X" view in the role matrix). The UNIQUE composite `(student_user_id, course_id)` does NOT cover lookups by `course_id` alone (non-leading column). Reintroduce if/when such an endpoint lands. |
| `purchases(course_id)` | No v1 endpoint lists purchases by course. FK convention waived because `courses` is small (sequential scan during CASCADE / JOIN is cheaper than maintaining an index — but `purchases.course_id` is `ON DELETE RESTRICT` anyway, so CASCADE perf does not apply). |
| `idempotency_keys(created_at)` | The 24h retention sweep is explicitly out of scope for v1 (see the `idempotency_keys` section above). Add this index in the same migration that introduces the sweep job. |
| Per-FK separate index where a composite already covers it (e.g. `enrolments.student_user_id` standalone, `lessons.course_id` standalone) | Avoided. The leading column of the existing composite UNIQUE is usable by the planner for FK lookups and CASCADE; an extra single-column index would just duplicate maintenance cost. |

### Per-FK coverage map

For auditability, the FK indexing convention is satisfied as follows for every FK in the schema:

| FK column | Covered by | Parent on delete |
|---|---|---|
| `purchases.parent_user_id` → `users` | `IDX_purchases_parent` | RESTRICT |
| `purchases.course_id` → `courses` | — (waived: `courses` is small, RESTRICT) | RESTRICT |
| `invitations.purchase_id` → `purchases` | `IDX_invitations_purchase` | CASCADE |
| `enrolments.student_user_id` → `users` | `IDX_enrolments_student` (also leading column of `IDX_enrolments_student_course_unique`) | CASCADE |
| `enrolments.course_id` → `courses` | — (waived: `courses` is small, RESTRICT) | RESTRICT |
| `enrolments.source_invitation_id` → `invitations` | — (audit-only, NULL-able, never queried by this column; SET NULL on delete touches a tiny number of rows in practice — reconsider if this assumption breaks) | SET NULL |
| `lessons.course_id` → `courses` | leading column of `IDX_lessons_course_order_unique` | CASCADE |

## Migrations roadmap

| Order | File | Milestone | ENUM type(s) created in `up()` |
|---|---|---|---|
| 1 | `<ts>-CreateUsersTable.ts` | M03 | `user_role` |
| 2 | `<ts>-CreateCoursesTable.ts` (+ seed) | M04 | `course_subject` |
| 3 | `<ts>-CreatePurchasesTable.ts` | M04 | `purchase_status` |
| 4 | `<ts>-CreateInvitationsTable.ts` | M04 | `invitation_status` |
| 5 | `<ts>-CreateIdempotencyKeysTable.ts` | M04 | — |
| 6 | `<ts>-CreateEnrolmentsTable.ts` | M05 | — |
| 7 | `<ts>-CreateLessonsTable.ts` (+ seed) | M06 | — |

> `invitations.email_sent_at` is included in migration 4 (`CreateInvitationsTable`) from the start. M08 only adds processor logic — no schema migration.

### ENUM lifecycle convention

> **Every migration that introduces an ENUM column creates the type in the same migration via `CREATE TYPE` (in `up()`, before the `CREATE TABLE`). The `down()` drops the type with `DROP TYPE` *after* the `DROP TABLE`, so the type's last dependent is removed first.**

Concretely:

- Migration 1 (`CreateUsersTable`): `up()` runs `CREATE TYPE user_role AS ENUM (...)` then `CREATE TABLE users (...)`. `down()` runs `DROP TABLE users` then `DROP TYPE user_role`.
- Migration 2 (`CreateCoursesTable`): same shape with `course_subject`.
- Migration 3 (`CreatePurchasesTable`): same shape with `purchase_status` (declared with the single value `'COMPLETED'` for v1).
- Migration 4 (`CreateInvitationsTable`): same shape with `invitation_status`.

Future migrations that **add a value** to an existing ENUM use `ALTER TYPE <name> ADD VALUE 'X'` (non-blocking since PG 12). Future migrations that **remove or rename a value** are column-rewrite migrations and are called out as such in their commit message.

## See also

- [overview.md](./overview.md)
- [auth-and-rbac.md](./auth-and-rbac.md) — `users.role` consumers
- [async-jobs.md](./async-jobs.md) — `invitations.email_sent_at` writer
- [adr/0006-retries-and-idempotency.md](./adr/0006-retries-and-idempotency.md)
- [../best-practices/code-conventions.md](../best-practices/code-conventions.md) — entity / migration conventions
