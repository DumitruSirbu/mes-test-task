/**
 * Unit tests for RefreshTokenCleanupProcessor (M10).
 *
 * Covers:
 *   - Cleanup removes only tokens past TTL grace AND revoked-forensic windows.
 *   - Logs { deletedExpired, deletedRevoked } on each run.
 *   - Retention-breach assertion: if rows remain with revoked_at > 60 days, logs
 *     REFRESH_TOKEN_RETENTION_BREACH with count.
 *   - Unknown job names are skipped with a warn log.
 */

import { RefreshTokenCleanupProcessor } from '../RefreshTokenCleanupProcessor';
import { RefreshTokensRepository } from '../../repository/RefreshTokensRepository';
import { REFRESH_TOKEN_CLEANUP_JOB } from '../../const/MaintenanceConsts';
import { REFRESH_TOKEN_GRACE_DAYS, REFRESH_TOKEN_FORENSIC_DAYS, REFRESH_TOKEN_RETENTION_BREACH_DAYS } from '../../const/AuthConsts';
import type { Job } from 'bullmq';

type RefreshTokensRepositoryMock = Pick<RefreshTokensRepository, 'deleteExpiredAndStaleRevoked' | 'countPastForensicWindow'>;

const buildJob = (name: string): Job =>
    ({
        name,
        id: 'job-1',
        opts: {},
        attemptsMade: 0,
    }) as unknown as Job;

describe('RefreshTokenCleanupProcessor', () => {
    let processor: RefreshTokenCleanupProcessor;
    let deleteExpiredAndStaleRevokedMock: jest.Mock;
    let countPastForensicWindowMock: jest.Mock;
    let logSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        deleteExpiredAndStaleRevokedMock = jest.fn().mockResolvedValue({ deletedExpired: 0, deletedRevoked: 0 });
        countPastForensicWindowMock = jest.fn().mockResolvedValue(0);

        const repoMock: RefreshTokensRepositoryMock = {
            deleteExpiredAndStaleRevoked: deleteExpiredAndStaleRevokedMock,
            countPastForensicWindow: countPastForensicWindowMock,
        };

        processor = new RefreshTokenCleanupProcessor(repoMock as unknown as RefreshTokensRepository);

        logSpy = jest.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(processor['logger'], 'error').mockImplementation(() => undefined);
        warnSpy = jest.spyOn(processor['logger'], 'warn').mockImplementation(() => undefined);
    });

    // ---------------------------------------------------------------------------
    // Delete pass
    // ---------------------------------------------------------------------------

    it('calls deleteExpiredAndStaleRevoked with the correct grace and forensic day constants', async () => {
        await processor.process(buildJob(REFRESH_TOKEN_CLEANUP_JOB));

        expect(deleteExpiredAndStaleRevokedMock).toHaveBeenCalledWith(REFRESH_TOKEN_GRACE_DAYS, REFRESH_TOKEN_FORENSIC_DAYS);
    });

    it('logs REFRESH_TOKEN_CLEANUP_DONE with deletedExpired and deletedRevoked counts', async () => {
        deleteExpiredAndStaleRevokedMock.mockResolvedValue({ deletedExpired: 5, deletedRevoked: 3 });

        await processor.process(buildJob(REFRESH_TOKEN_CLEANUP_JOB));

        expect(logSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'REFRESH_TOKEN_CLEANUP_DONE',
                deletedExpired: 5,
                deletedRevoked: 3,
            }),
            expect.any(String),
        );
    });

    it('does NOT delete rows when both counts are zero (no-op run is safe)', async () => {
        deleteExpiredAndStaleRevokedMock.mockResolvedValue({ deletedExpired: 0, deletedRevoked: 0 });

        await processor.process(buildJob(REFRESH_TOKEN_CLEANUP_JOB));

        expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ deletedExpired: 0, deletedRevoked: 0 }), expect.any(String));
        // errorSpy must NOT fire — no breach.
        const breachCalls = (errorSpy.mock.calls as Array<[unknown, ...unknown[]]>).filter(
            (c) =>
                typeof c[0] === 'object' &&
                c[0] !== null &&
                'code' in (c[0] as Record<string, unknown>) &&
                (c[0] as Record<string, unknown>)['code'] === 'REFRESH_TOKEN_RETENTION_BREACH',
        );
        expect(breachCalls).toHaveLength(0);
    });

    // ---------------------------------------------------------------------------
    // Retention-breach assertion
    // ---------------------------------------------------------------------------

    it('emits REFRESH_TOKEN_RETENTION_BREACH error log when rows remain past 60-day threshold', async () => {
        countPastForensicWindowMock.mockResolvedValue(4);

        await processor.process(buildJob(REFRESH_TOKEN_CLEANUP_JOB));

        expect(errorSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'REFRESH_TOKEN_RETENTION_BREACH',
                count: 4,
                thresholdDays: REFRESH_TOKEN_RETENTION_BREACH_DAYS,
            }),
            expect.any(String),
        );
    });

    it('checks retention breach using the 60-day threshold constant', async () => {
        await processor.process(buildJob(REFRESH_TOKEN_CLEANUP_JOB));

        expect(countPastForensicWindowMock).toHaveBeenCalledWith(REFRESH_TOKEN_RETENTION_BREACH_DAYS);
    });

    it('does NOT emit REFRESH_TOKEN_RETENTION_BREACH when count is zero', async () => {
        countPastForensicWindowMock.mockResolvedValue(0);

        await processor.process(buildJob(REFRESH_TOKEN_CLEANUP_JOB));

        const breachCalls = (errorSpy.mock.calls as Array<[unknown, ...unknown[]]>).filter(
            (c) =>
                typeof c[0] === 'object' &&
                c[0] !== null &&
                'code' in (c[0] as Record<string, unknown>) &&
                (c[0] as Record<string, unknown>)['code'] === 'REFRESH_TOKEN_RETENTION_BREACH',
        );
        expect(breachCalls).toHaveLength(0);
    });

    // ---------------------------------------------------------------------------
    // Unknown job name guard
    // ---------------------------------------------------------------------------

    it('skips processing and emits a warn log for an unknown job name', async () => {
        await processor.process(buildJob('unknown-job-name'));

        expect(deleteExpiredAndStaleRevokedMock).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ code: 'MAINTENANCE_JOB_UNKNOWN' }), expect.any(String));
    });
});
