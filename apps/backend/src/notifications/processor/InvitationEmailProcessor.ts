import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InvitationsRepository } from '../../invitations/repository/InvitationsRepository';
import { IInvitationEmailJob } from '../interface/IInvitationEmailJob';
import { INVITATION_EMAIL_QUEUE } from '../const/NotificationsConsts';

/**
 * BullMQ processor for `invitation-email` queue.
 *
 * Three-layer idempotency (ADR 0006):
 *   1. Queue-level: deterministic `jobId` on enqueue prevents duplicate jobs.
 *   2. Processor-level (here): `email_sent_at IS NULL` check skips re-sends.
 *   3. DB-level: `markEmailSent` UPDATE uses `WHERE email_sent_at IS NULL`
 *      and returns the affected row count. When `affected === 0`, another worker
 *      already committed the send — we log at `info` and return without error.
 *
 * Error taxonomy (see async-jobs.md "Errors inside processors"):
 *   - Missing / logical no-ops → early `return`, no throw (would waste retries).
 *   - Transient infra failures (DB write) → propagate as plain `Error`; BullMQ
 *     schedules the next retry. Never throw `DomainError` from a processor.
 */
@Processor(INVITATION_EMAIL_QUEUE, {
    concurrency: 2,
    lockDuration: 30_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
})
export class InvitationEmailProcessor extends WorkerHost {
    private readonly logger = new Logger(InvitationEmailProcessor.name);

    public constructor(private readonly invitationsRepository: InvitationsRepository) {
        super();
    }

    public async process(job: Job<IInvitationEmailJob>): Promise<void> {
        const { invitationId, recipientEmail, courseTitle } = job.data;

        const invitation = await this.invitationsRepository.findById(invitationId);

        if (!invitation) {
            this.logger.warn({ code: 'INVITATION_NOT_FOUND', invitationId }, 'Invitation not found — dropping job');

            return;
        }

        if (invitation.emailSentAt) {
            this.logger.log(
                { code: 'INVITATION_EMAIL_ALREADY_SENT', invitationId, sentAt: invitation.emailSentAt.toISOString() },
                'Invitation email already sent — skipping',
            );

            return;
        }

        // Log the "send" event. `recipientEmail` is PII — log only the domain.
        // `invitationUrl` contains the plaintext token and is intentionally omitted
        // from the log entirely; `invitationId` is sufficient for correlation.
        const recipientEmailDomain = recipientEmail.split('@')[1] ?? 'unknown';

        this.logger.log(
            {
                code: 'INVITATION_EMAIL_SENT',
                invitationId,
                recipientEmailDomain,
                courseTitle,
            },
            '[invitation.email.send] would send',
        );

        const affected = await this.invitationsRepository.markEmailSent(invitationId);

        if (affected === 0) {
            // Another concurrent worker won the race and already set email_sent_at.
            // This is a success — the email was sent exactly once. Log at info, not error.
            this.logger.log(
                { code: 'INVITATION_EMAIL_SEND_LOST_RACE', invitationId },
                'Lost race to mark email sent — another worker already committed; treating as success',
            );
        }
    }

    @OnWorkerEvent('completed')
    public onCompleted(job: Job): void {
        this.logger.log({ code: 'JOB_COMPLETED', jobId: job.id, queue: INVITATION_EMAIL_QUEUE }, `Job ${job.id} completed`);
    }

    @OnWorkerEvent('failed')
    public onFailed(job: Job, error: Error): void {
        this.logger.error(
            { code: 'JOB_FAILED', jobId: job.id, attempt: job.attemptsMade, maxAttempts: job.opts.attempts },
            `Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? '?'}): ${error.message}`,
        );
    }
}
