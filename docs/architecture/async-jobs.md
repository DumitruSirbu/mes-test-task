# Async Jobs (BullMQ)

> Status: stub. Filled in M02 by `mes-architect`, implemented in M08.

## Queues

| Queue constant | Purpose | Producer | Consumer |
|---|---|---|---|
| `INVITATION_EMAIL_QUEUE` | "Send" invitation email (logs to stdout in v1) | `PurchasesService` after transaction commit | `InvitationEmailProcessor` |

## Job: `invitation.email.send`

- Payload: `{ invitationId: number; recipientEmail: string; courseTitle: string; invitationUrl: string }`.
- Retry: `attempts: 5`, exponential backoff `{ type: 'exponential', delay: 2000 }`, capped at 60s.
- `removeOnComplete: { age: 86400, count: 1000 }`, `removeOnFail: false`.
- Idempotency: processor checks `invitations.email_sent_at IS NULL` before sending; if not null, returns success without re-sending.
- Graceful shutdown: `worker.close()` on `SIGTERM`.

## See also

- `docs/architecture/adr/0004-bullmq-for-async.md`
- `docs/architecture/adr/0006-retries-and-idempotency.md`
