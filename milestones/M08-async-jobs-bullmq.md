# M08 — Async Jobs (BullMQ)

> **Status:** pending · **Owner:** mes-orchestrator → mes-backend-nestjs → mes-qa-engineer → reviewers → mes-scribe

## Goal

When a purchase completes, an `invitation.email.send` job is enqueued. A BullMQ processor "sends" the invitation by logging the rendered email to stdout. Retry + idempotency per ADR 0006.

## Depends on

M04 (purchases produce invitations).

## Deliverables

### Backend

- `notifications/` module — `NotificationsModule` registering the BullMQ queue (constant `INVITATION_EMAIL_QUEUE`).
- `InvitationEmailProcessor` extending `WorkerHost`:
  - `attempts: 5`, exponential backoff `{ type: 'exponential', delay: 2000 }` capped at 60s
  - `removeOnComplete: { age: 86400, count: 1000 }`, `removeOnFail: false`
  - Idempotency: check `invitations.email_sent_at` IS NULL before sending; if not null, return success without re-sending.
  - On success: set `email_sent_at = now()`.
  - Graceful shutdown on `SIGTERM` (`worker.close()`).
- `PurchasesService` enqueues the job after the purchase + invitation transaction commits (NOT inside the transaction — Redis is not transactional with Postgres). Job payload: `{ invitationId, recipientEmail, courseTitle, invitationUrl }`.
- BullMQ Board (`@bull-board/express` + `@bull-board/nestjs`) mounted at `/admin/queues` behind `@Roles(UserRoleEnum.ADMIN)` — bonus signal, optional if time allows.

### Migration

- `<ts>-AddEmailSentAtToInvitations.ts` — `email_sent_at TIMESTAMPTZ NULL` column.

### Tests

- Unit: processor idempotency (calling `process` twice with same `invitationId` only "sends" once).
- Unit: processor retry behavior (throw → BullMQ retries; assert via mock).
- Integration: full purchase → assert job appears in queue → process → assert log line + `email_sent_at` set.

## Definition of Done

- After M04 purchase, the log contains "[invitation.email.send] would send to student@example.com ..." within seconds.
- Retrying the job (manually via Bull Board or test) does not produce a second log line for the same invitation.
- Worker stops cleanly on `SIGTERM` (`docker compose stop backend` — no orphaned in-flight jobs).
- All reviewers report no blockers.

## Outcome

(filled by mes-scribe at close)
