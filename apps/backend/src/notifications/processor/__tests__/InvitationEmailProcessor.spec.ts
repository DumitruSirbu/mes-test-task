import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InvitationStatusEnum } from '@mes/shared';
import { InvitationEmailProcessor } from '../InvitationEmailProcessor';
import { InvitationsRepository } from '../../../invitations/repository/InvitationsRepository';
import { InvitationEntity } from '../../../invitations/entity/InvitationEntity';
import { IInvitationEmailJob } from '../../interface/IInvitationEmailJob';

type InvitationsRepositoryMock = Pick<InvitationsRepository, 'findById' | 'markEmailSent'>;

function buildInvitation(overrides?: Partial<InvitationEntity>): InvitationEntity {
    const entity = new InvitationEntity();
    entity.invitationId = 1;
    entity.purchaseId = 10;
    entity.tokenHash = 'a'.repeat(64);
    entity.studentEmail = 'student@example.com';
    entity.status = InvitationStatusEnum.ISSUED;
    entity.expiresAt = new Date('2027-01-01T00:00:00Z');
    entity.redeemedAt = null;
    entity.emailSentAt = null;
    entity.createdAt = new Date('2026-05-14T10:00:00Z');

    return Object.assign(entity, overrides ?? {});
}

function buildJob(overrides?: Partial<IInvitationEmailJob>): Job<IInvitationEmailJob> {
    return {
        id: 'job-1',
        data: {
            invitationId: 1,
            recipientEmail: 'student@example.com',
            courseTitle: 'Maths Year 7',
            invitationUrl: 'https://mes.test/invite/abc123',
            ...overrides,
        },
        opts: { attempts: 5 },
        attemptsMade: 1,
    } as unknown as Job<IInvitationEmailJob>;
}

describe('InvitationEmailProcessor', () => {
    let processor: InvitationEmailProcessor;
    const findByIdMock = jest.fn();
    const markEmailSentMock = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();

        const repoMock: InvitationsRepositoryMock = {
            findById: findByIdMock,
            markEmailSent: markEmailSentMock,
        };

        processor = new InvitationEmailProcessor(repoMock as InvitationsRepository);

        // Silence logger output in tests
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    describe('process — idempotency', () => {
        it('calls markEmailSent once when email_sent_at is null on first invocation', async () => {
            findByIdMock.mockResolvedValue(buildInvitation({ emailSentAt: null }));
            markEmailSentMock.mockResolvedValue(1);

            await processor.process(buildJob());

            expect(markEmailSentMock).toHaveBeenCalledTimes(1);
            expect(markEmailSentMock).toHaveBeenCalledWith(1);
        });

        it('skips markEmailSent on a second invocation when email_sent_at is already set', async () => {
            // First call — not sent yet
            findByIdMock.mockResolvedValueOnce(buildInvitation({ emailSentAt: null }));
            markEmailSentMock.mockResolvedValue(1);
            await processor.process(buildJob());

            // Second call — email_sent_at is now populated (simulating the DB state after the first call)
            findByIdMock.mockResolvedValueOnce(buildInvitation({ emailSentAt: new Date('2026-05-14T10:01:00Z') }));

            await processor.process(buildJob());

            // markEmailSent must have been called exactly once across both invocations
            expect(markEmailSentMock).toHaveBeenCalledTimes(1);
        });

        it('logs the INVITATION_EMAIL_ALREADY_SENT code and returns without sending when email is already sent', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'log');
            findByIdMock.mockResolvedValue(buildInvitation({ emailSentAt: new Date('2026-05-14T10:00:00Z') }));

            await processor.process(buildJob());

            expect(markEmailSentMock).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVITATION_EMAIL_ALREADY_SENT' }), expect.any(String));
        });

        it('logs the INVITATION_EMAIL_SENT code and the course title on a successful send', async () => {
            const logSpy = jest.spyOn(Logger.prototype, 'log');
            findByIdMock.mockResolvedValue(buildInvitation({ emailSentAt: null }));
            markEmailSentMock.mockResolvedValue(1);

            await processor.process(buildJob({ courseTitle: 'Chemistry Year 9' }));

            expect(logSpy).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'INVITATION_EMAIL_SENT', courseTitle: 'Chemistry Year 9' }),
                expect.any(String),
            );
        });

        it('does NOT include invitationUrl in the INVITATION_EMAIL_SENT log payload (PII / token safety)', async () => {
            const logSpy = jest.spyOn(Logger.prototype, 'log');
            findByIdMock.mockResolvedValue(buildInvitation({ emailSentAt: null }));
            markEmailSentMock.mockResolvedValue(1);

            await processor.process(buildJob());

            const sentCall = (logSpy.mock.calls as [Record<string, unknown>, string][]).find(([meta]) => meta.code === 'INVITATION_EMAIL_SENT');
            expect(sentCall).toBeDefined();
            expect(sentCall![0]).not.toHaveProperty('invitationUrl');
        });

        it('logs INVITATION_EMAIL_SEND_LOST_RACE at info when markEmailSent returns 0 (concurrent worker won)', async () => {
            const logSpy = jest.spyOn(Logger.prototype, 'log');
            findByIdMock.mockResolvedValue(buildInvitation({ emailSentAt: null }));
            // Simulate: IS NULL guard in DB fired — another worker already committed
            markEmailSentMock.mockResolvedValue(0);

            await processor.process(buildJob());

            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVITATION_EMAIL_SEND_LOST_RACE' }), expect.any(String));
        });
    });

    describe('process — retry behavior', () => {
        it('propagates the error thrown by markEmailSent so BullMQ can retry', async () => {
            findByIdMock.mockResolvedValue(buildInvitation({ emailSentAt: null }));
            markEmailSentMock.mockRejectedValue(new Error('DB connection lost'));

            await expect(processor.process(buildJob())).rejects.toThrow('DB connection lost');
        });

        it('propagates the error thrown by findById so BullMQ can retry', async () => {
            findByIdMock.mockRejectedValue(new Error('query timeout'));

            await expect(processor.process(buildJob())).rejects.toThrow('query timeout');
        });

        it('returns without throwing (drops the job) when the invitation row does not exist', async () => {
            findByIdMock.mockResolvedValue(null);

            // Missing invitation is a logical no-op — should not throw (would waste retries)
            await expect(processor.process(buildJob())).resolves.toBeUndefined();
            expect(markEmailSentMock).not.toHaveBeenCalled();
        });

        it('logs INVITATION_NOT_FOUND and does not call markEmailSent when row is missing', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn');
            findByIdMock.mockResolvedValue(null);

            await processor.process(buildJob());

            expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVITATION_NOT_FOUND' }), expect.any(String));
            expect(markEmailSentMock).not.toHaveBeenCalled();
        });
    });

    describe('process — email domain redaction', () => {
        it('logs the email domain rather than the full address for PII safety', async () => {
            const logSpy = jest.spyOn(Logger.prototype, 'log');
            findByIdMock.mockResolvedValue(buildInvitation({ emailSentAt: null }));
            markEmailSentMock.mockResolvedValue(1);

            await processor.process(buildJob({ recipientEmail: 'alice@school.edu' }));

            expect(logSpy).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'INVITATION_EMAIL_SENT', recipientEmailDomain: 'school.edu' }),
                expect.any(String),
            );
        });
    });
});
