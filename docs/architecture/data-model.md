# Data Model

> Status: stub. Filled in M02 by `mes-architect`.

ER diagram + per-table column intent.

Expected entities (final list confirmed in M02):

- `users` — auth identity. Discriminated by `role` (`PARENT`, `STUDENT`, `ADMIN`).
- `parent_profiles` / `student_profiles` — role-specific data (optional split — decision in M02).
- `courses` — seeded catalog (Maths, English, Science × year range).
- `purchases` — parent's purchases. Idempotent.
- `idempotency_keys` — replay-safe POST storage.
- `invitations` — single-use, signed, expiring tokens linked to a purchase.
- `enrolments` — student ↔ course access grant.
- `lessons` — per-course content.
