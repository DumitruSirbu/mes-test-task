import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RefreshTokensRepository } from '../repository/RefreshTokensRepository';
import {
    MAINTENANCE_QUEUE,
    MAINTENANCE_WORKER_LOCK_DURATION_MS,
    MAINTENANCE_WORKER_STALLED_INTERVAL_MS,
    REFRESH_TOKEN_CLEANUP_JOB,
} from '../const/MaintenanceConsts';
import { REFRESH_TOKEN_GRACE_DAYS, REFRESH_TOKEN_FORENSIC_DAYS, REFRESH_TOKEN_RETENTION_BREACH_DAYS } from '../const/AuthConsts';

/**
 * BullMQ processor for the `refresh-token-cleanup` job on the `maintenance` queue.
 *
 * Runs daily at 03:00 UTC (cron registered in `AuthModule`).
 *
 * Two delete passes per ADR 0007 §10:
 *   1. `expires_at < now() - 7 days`  (TTL forensic grace — `REFRESH_TOKEN_GRACE_DAYS`).
 *   2. `revoked_at < now() - 30 days` (revocation forensic grace — `REFRESH_TOKEN_FORENSIC_DAYS`).
 *
 * After the deletes, a retention-breach assertion fires if any row has been revoked
 * longer than `REFRESH_TOKEN_RETENTION_BREACH_DAYS` ago — catching silent cleanup failures
 * that would leave PII columns (`user_agent`, `ip`) past the forensic window.
 */
@Processor(MAINTENANCE_QUEUE, {
    concurrency: 1,
    lockDuration: MAINTENANCE_WORKER_LOCK_DURATION_MS,
    stalledInterval: MAINTENANCE_WORKER_STALLED_INTERVAL_MS,
    maxStalledCount: 1,
})
export class RefreshTokenCleanupProcessor extends WorkerHost {
    private readonly logger = new Logger(RefreshTokenCleanupProcessor.name);

    public constructor(private readonly refreshTokensRepository: RefreshTokensRepository) {
        super();
    }

    public async process(job: Job): Promise<void> {
        if (job.name !== REFRESH_TOKEN_CLEANUP_JOB) {
            this.logger.warn({ code: 'MAINTENANCE_JOB_UNKNOWN', jobName: job.name }, `Unknown job name — skipping`);

            return;
        }

        await this.runCleanup();
    }

    private async runCleanup(): Promise<void> {
        const { deletedExpired, deletedRevoked } = await this.refreshTokensRepository.deleteExpiredAndStaleRevoked(
            REFRESH_TOKEN_GRACE_DAYS,
            REFRESH_TOKEN_FORENSIC_DAYS,
        );

        this.logger.log(
            {
                code: 'REFRESH_TOKEN_CLEANUP_DONE',
                deletedExpired,
                deletedRevoked,
            },
            `Refresh token cleanup completed`,
        );

        await this.assertRetentionBreach();
    }

    private async assertRetentionBreach(): Promise<void> {
        const count = await this.refreshTokensRepository.countPastForensicWindow(REFRESH_TOKEN_RETENTION_BREACH_DAYS);

        if (count > 0) {
            this.logger.error(
                {
                    code: 'REFRESH_TOKEN_RETENTION_BREACH',
                    count,
                    thresholdDays: REFRESH_TOKEN_RETENTION_BREACH_DAYS,
                },
                `Retention breach: ${count} refresh token row(s) exceed the ${REFRESH_TOKEN_RETENTION_BREACH_DAYS}-day forensic window`,
            );
        }
    }

    @OnWorkerEvent('completed')
    public onCompleted(job: Job): void {
        this.logger.log({ code: 'JOB_COMPLETED', jobId: job.id, queue: MAINTENANCE_QUEUE }, `Job ${job.id} (${job.name}) completed`);
    }

    @OnWorkerEvent('failed')
    public onFailed(job: Job, error: Error): void {
        this.logger.error(
            {
                code: 'JOB_FAILED',
                jobId: job.id,
                jobName: job.name,
                attempt: job.attemptsMade,
                maxAttempts: job.opts.attempts,
                queue: MAINTENANCE_QUEUE,
            },
            `Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? '?'}): ${error.message}`,
        );
    }
}
