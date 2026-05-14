/**
 * Payload carried by every `invitation.email.send` BullMQ job.
 *
 * Contains everything the processor needs in the happy path without an extra DB
 * round-trip. The processor still reads the `invitations` row to perform the
 * idempotency check (`email_sent_at IS NULL`).
 *
 * Note: `IInvitationEmailJob` lives here rather than `packages/shared/` because
 * it is a backend-only concern (no frontend consumes it). If a second service ever
 * needs it, move it to shared via `mes-shared-maintainer`.
 */
export interface IInvitationEmailJob {
    invitationId: number;
    recipientEmail: string;
    courseTitle: string;
    invitationUrl: string;
}
