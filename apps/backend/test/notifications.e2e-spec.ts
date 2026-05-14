import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { createHash, randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import { CourseSubjectEnum, InvitationStatusEnum, PurchaseStatusEnum } from '@mes/shared';
import { Job } from 'bullmq';

import { PurchasesService } from '../src/purchases/service/PurchasesService';
import { PurchasesRepository } from '../src/purchases/repository/PurchasesRepository';
import { PurchaseEntity } from '../src/purchases/entity/PurchaseEntity';
import { CoursesService } from '../src/courses/service/CoursesService';
import { CoursesRepository } from '../src/courses/repository/CoursesRepository';
import { CourseEntity } from '../src/courses/entity/CourseEntity';
import { InvitationsService } from '../src/invitations/service/InvitationsService';
import { InvitationsRepository } from '../src/invitations/repository/InvitationsRepository';
import { InvitationEntity } from '../src/invitations/entity/InvitationEntity';
import { IdempotencyService } from '../src/common/idempotency/service/IdempotencyService';
import { IdempotencyKeysRepository } from '../src/common/idempotency/repository/IdempotencyKeysRepository';
import { IdempotencyKeyEntity } from '../src/common/idempotency/entity/IdempotencyKeyEntity';
import { InvitationEmailProcessor } from '../src/notifications/processor/InvitationEmailProcessor';
import { INVITATION_EMAIL_QUEUE, INVITATION_EMAIL_JOB_NAME } from '../src/notifications/const/NotificationsConsts';
import type { IInvitationEmailJob } from '../src/notifications/interface/IInvitationEmailJob';

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

interface IPurchaseRow {
    purchaseId: number;
    parentUserId: number;
    courseId: number;
    status: PurchaseStatusEnum;
    amountPence: number;
    idempotencyKey: string;
    createdAt: Date;
    updatedAt: Date;
}

class InMemoryPurchasesRepository {
    public readonly rows = new Map<number, IPurchaseRow>();
    private nextId = 1;

    public insertWithinTransaction(_manager: EntityManager, input: Partial<PurchaseEntity>): Promise<PurchaseEntity> {
        const row: IPurchaseRow = {
            purchaseId: this.nextId++,
            parentUserId: input.parentUserId!,
            courseId: input.courseId!,
            status: input.status!,
            amountPence: input.amountPence!,
            idempotencyKey: input.idempotencyKey!,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.rows.set(row.purchaseId, row);

        return Promise.resolve(Object.assign(new PurchaseEntity(), row));
    }

    public listByParent(parentUserId: number): Promise<PurchaseEntity[]> {
        return Promise.resolve(
            Array.from(this.rows.values())
                .filter((row) => row.parentUserId === parentUserId)
                .map((row) => Object.assign(new PurchaseEntity(), row)),
        );
    }

    public existsCompletedForParentCourseAndStudent(): Promise<boolean> {
        return Promise.resolve(false);
    }
}

interface IInvitationRow {
    invitationId: number;
    purchaseId: number;
    tokenHash: string;
    studentEmail: string;
    status: InvitationStatusEnum;
    expiresAt: Date;
    redeemedAt: Date | null;
    emailSentAt: Date | null;
    createdAt: Date;
}

class InMemoryInvitationsRepository {
    public readonly rows = new Map<number, IInvitationRow>();
    private nextId = 1;

    public insertWithinTransaction(_manager: EntityManager, input: Partial<InvitationEntity>): Promise<InvitationEntity> {
        const row: IInvitationRow = {
            invitationId: this.nextId++,
            purchaseId: input.purchaseId!,
            tokenHash: input.tokenHash!,
            studentEmail: (input.studentEmail ?? '').toLowerCase(),
            status: input.status!,
            expiresAt: input.expiresAt!,
            redeemedAt: input.redeemedAt ?? null,
            emailSentAt: input.emailSentAt ?? null,
            createdAt: new Date(),
        };
        this.rows.set(row.invitationId, row);

        return Promise.resolve(Object.assign(new InvitationEntity(), row));
    }

    public findById(invitationId: number): Promise<InvitationEntity | null> {
        const row = this.rows.get(invitationId);

        if (!row) {
            return Promise.resolve(null);
        }

        return Promise.resolve(Object.assign(new InvitationEntity(), row));
    }

    public findByTokenHash(tokenHash: string): Promise<InvitationEntity | null> {
        for (const row of this.rows.values()) {
            if (row.tokenHash === tokenHash) {
                return Promise.resolve(Object.assign(new InvitationEntity(), row));
            }
        }

        return Promise.resolve(null);
    }

    public findByPurchaseId(purchaseId: number): Promise<InvitationEntity | null> {
        for (const row of this.rows.values()) {
            if (row.purchaseId === purchaseId) {
                return Promise.resolve(Object.assign(new InvitationEntity(), row));
            }
        }

        return Promise.resolve(null);
    }

    public findManyByPurchaseIds(purchaseIds: number[]): Promise<InvitationEntity[]> {
        const set = new Set(purchaseIds);
        const matches: InvitationEntity[] = [];

        for (const row of this.rows.values()) {
            if (set.has(row.purchaseId)) {
                matches.push(Object.assign(new InvitationEntity(), row));
            }
        }

        return Promise.resolve(matches);
    }

    public markEmailSent(invitationId: number): Promise<number> {
        const row = this.rows.get(invitationId);

        if (row && !row.emailSentAt) {
            row.emailSentAt = new Date();

            return Promise.resolve(1);
        }

        return Promise.resolve(0);
    }
}

interface ICourseRow {
    courseId: number;
    subject: CourseSubjectEnum;
    yearFrom: number;
    yearTo: number;
    title: string;
    pricePence: number;
    createdAt: Date;
}

class InMemoryCoursesRepository {
    private readonly rows = new Map<number, ICourseRow>();

    public seedDefault(): void {
        this.rows.set(7, {
            courseId: 7,
            subject: CourseSubjectEnum.MATHS,
            yearFrom: 7,
            yearTo: 7,
            title: 'Maths Year 7',
            pricePence: 19900,
            createdAt: new Date('2026-05-14T10:00:00Z'),
        });
    }

    public findById(courseId: number): Promise<CourseEntity | null> {
        const row = this.rows.get(courseId);

        return Promise.resolve(row ? Object.assign(new CourseEntity(), row) : null);
    }

    public findAllOrdered(): Promise<CourseEntity[]> {
        return Promise.resolve(Array.from(this.rows.values()).map((row) => Object.assign(new CourseEntity(), row)));
    }
}

class InMemoryIdempotencyKeysRepository {
    private readonly rows = new Map<number, IdempotencyKeyEntity>();
    private nextId = 1;

    public findReplay(userId: number, endpoint: string, key: string): Promise<IdempotencyKeyEntity | null> {
        for (const row of this.rows.values()) {
            if (row.userId === userId && row.endpoint === endpoint && row.key === key) {
                return Promise.resolve(row);
            }
        }

        return Promise.resolve(null);
    }

    public insertWithinTransaction(_manager: EntityManager, input: Partial<IdempotencyKeyEntity>): Promise<IdempotencyKeyEntity> {
        const entity = Object.assign(new IdempotencyKeyEntity(), { idempotencyKeyId: this.nextId++, ...input });
        this.rows.set(entity.idempotencyKeyId, entity);

        return Promise.resolve(entity);
    }
}

// ---------------------------------------------------------------------------
// Stub DataSource — passes an empty manager through; sufficient for in-memory repos
// ---------------------------------------------------------------------------

class StubDataSource {
    public async transaction<T>(runInTransaction: (manager: EntityManager) => Promise<T>): Promise<T> {
        return runInTransaction({} as EntityManager);
    }
}

// ---------------------------------------------------------------------------
// Stub InvitationsService — only the surface used by PurchasesService.
//
// PurchasesService calls:
//   - issueWithinTransaction → create the invitation entity
//   - toResponseWithPlaintext → format the response
//   - buildInvitationUrl → construct the URL for the job payload
//
// The processor uses InvitationsRepository directly, bypassing InvitationsService.
// ---------------------------------------------------------------------------

function buildStubInvitationsService(invitationsRepo: InMemoryInvitationsRepository): Pick<InvitationsService, 'issueWithinTransaction' | 'toResponseWithPlaintext'> {
    const INVITATION_BASE_URL = 'https://mes.test/invite';

    const buildUrl = (plaintextToken: string): string => `${INVITATION_BASE_URL}/${encodeURIComponent(plaintextToken)}`;

    return {
        issueWithinTransaction: async (_manager: EntityManager, params: { purchaseId: number; studentEmail: string }) => {
            const plaintextToken = randomBytes(32).toString('base64url');
            const tokenHash = createHash('sha256').update(plaintextToken).digest('hex');
            const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

            const entity = await invitationsRepo.insertWithinTransaction(_manager, {
                purchaseId: params.purchaseId,
                tokenHash,
                studentEmail: params.studentEmail,
                status: InvitationStatusEnum.ISSUED,
                expiresAt,
            });

            return { entity, plaintextToken, invitationUrl: buildUrl(plaintextToken) };
        },
        toResponseWithPlaintext: (entity: InvitationEntity, plaintextToken: string) => ({
            id: entity.invitationId,
            studentEmail: entity.studentEmail,
            status: entity.status,
            expiresAt: entity.expiresAt.toISOString(),
            url: buildUrl(plaintextToken),
        }),
    };
}

// ---------------------------------------------------------------------------
// In-memory BullMQ Queue stub
// ---------------------------------------------------------------------------

interface IQueuedJob {
    name: string;
    data: IInvitationEmailJob;
    opts: Record<string, unknown>;
}

class InMemoryQueue {
    public readonly jobs: IQueuedJob[] = [];

    public add(name: string, data: IInvitationEmailJob, opts: Record<string, unknown>): Promise<unknown> {
        this.jobs.push({ name, data, opts });

        return Promise.resolve({ id: `job-${this.jobs.length}` });
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Integration-level tests for the full purchase → enqueue → process pipeline.
 *
 * No real Postgres or Redis is involved — in-memory stubs replace the DB layer,
 * an `InMemoryQueue` replaces BullMQ's `Queue`, and the processor is invoked
 * directly. This verifies that the end-to-end wiring (service → queue → processor
 * → repository → log) is correct without requiring external infrastructure.
 */
describe('Notifications — purchase → enqueue → process pipeline', () => {
    let purchasesService: PurchasesService;
    let processor: InvitationEmailProcessor;
    let invitationsRepo: InMemoryInvitationsRepository;
    let queueStub: InMemoryQueue;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        jest.clearAllMocks();

        invitationsRepo = new InMemoryInvitationsRepository();
        queueStub = new InMemoryQueue();
        const coursesRepo = new InMemoryCoursesRepository();
        coursesRepo.seedDefault();
        const idemRepo = new InMemoryIdempotencyKeysRepository();
        const invitationsServiceStub = buildStubInvitationsService(invitationsRepo);

        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true })],
            providers: [
                PurchasesService,
                CoursesService,
                IdempotencyService,
                InvitationEmailProcessor,
                { provide: DataSource, useClass: StubDataSource },
                { provide: PurchasesRepository, useValue: new InMemoryPurchasesRepository() },
                { provide: InvitationsRepository, useValue: invitationsRepo },
                { provide: InvitationsService, useValue: invitationsServiceStub },
                { provide: CoursesRepository, useValue: coursesRepo },
                { provide: IdempotencyKeysRepository, useValue: idemRepo },
                { provide: getQueueToken(INVITATION_EMAIL_QUEUE), useValue: queueStub },
            ],
        }).compile();

        purchasesService = moduleRef.get(PurchasesService);
        processor = moduleRef.get(InvitationEmailProcessor);

        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    it('enqueues an invitation.email.send job on the correct queue after purchase commits', async () => {
        await purchasesService.createPurchase({
            parentUserId: 1,
            body: { courseId: 7, studentEmail: 'student@example.com' },
            idempotency: { key: 'idem-00000001', endpoint: 'POST /purchases', requestHash: 'h'.repeat(64) },
        });

        expect(queueStub.jobs).toHaveLength(1);
        expect(queueStub.jobs[0].name).toBe(INVITATION_EMAIL_JOB_NAME);
        expect(queueStub.jobs[0].data.recipientEmail).toBe('student@example.com');
        expect(queueStub.jobs[0].data.courseTitle).toBe('Maths Year 7');
        expect(queueStub.jobs[0].data.invitationUrl).toMatch(/^https:\/\/mes\.test\/invite\//);
    });

    it('sets a deterministic jobId based on invitationId to prevent duplicate jobs', async () => {
        await purchasesService.createPurchase({
            parentUserId: 2,
            body: { courseId: 7, studentEmail: 'another@example.com' },
            idempotency: { key: 'idem-00000002', endpoint: 'POST /purchases', requestHash: 'x'.repeat(64) },
        });

        const job = queueStub.jobs[0];
        expect(job.opts).toMatchObject({ jobId: `invitation-email-${job.data.invitationId}` });
    });

    it('sets email_sent_at on the invitation row after the processor runs successfully', async () => {
        const purchaseResult = await purchasesService.createPurchase({
            parentUserId: 3,
            body: { courseId: 7, studentEmail: 'processed@example.com' },
            idempotency: { key: 'idem-00000003', endpoint: 'POST /purchases', requestHash: 'y'.repeat(64) },
        });

        const invitationId = purchaseResult.invitation.id;

        // Verify email_sent_at is null before processing
        const before = invitationsRepo.rows.get(invitationId);
        expect(before?.emailSentAt).toBeNull();

        const job = {
            id: 'job-proc-1',
            data: queueStub.jobs[0].data,
            opts: { attempts: 5 },
            attemptsMade: 1,
        } as unknown as Job<IInvitationEmailJob>;

        await processor.process(job);

        // Verify email_sent_at is now populated
        const after = invitationsRepo.rows.get(invitationId);
        expect(after?.emailSentAt).toBeInstanceOf(Date);
    });

    it('emits a structured log entry with INVITATION_EMAIL_SENT code when the processor sends', async () => {
        await purchasesService.createPurchase({
            parentUserId: 4,
            body: { courseId: 7, studentEmail: 'logsent@example.com' },
            idempotency: { key: 'idem-00000004', endpoint: 'POST /purchases', requestHash: 'z'.repeat(64) },
        });

        const job = {
            id: 'job-log-1',
            data: queueStub.jobs[0].data,
            opts: { attempts: 5 },
            attemptsMade: 1,
        } as unknown as Job<IInvitationEmailJob>;

        await processor.process(job);

        expect(logSpy).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'INVITATION_EMAIL_SENT' }),
            expect.stringContaining('[invitation.email.send]'),
        );
    });

    it('does not set email_sent_at a second time when the processor is invoked twice for the same invitation', async () => {
        await purchasesService.createPurchase({
            parentUserId: 5,
            body: { courseId: 7, studentEmail: 'idem2x@example.com' },
            idempotency: { key: 'idem-00000005', endpoint: 'POST /purchases', requestHash: 'w'.repeat(64) },
        });

        const jobData = queueStub.jobs[0].data;
        const makeJob = (): Job<IInvitationEmailJob> =>
            ({
                id: 'job-idem',
                data: jobData,
                opts: { attempts: 5 },
                attemptsMade: 1,
            }) as unknown as Job<IInvitationEmailJob>;

        await processor.process(makeJob());

        const firstTimestamp = invitationsRepo.rows.get(jobData.invitationId)?.emailSentAt;
        expect(firstTimestamp).toBeInstanceOf(Date);

        await processor.process(makeJob());

        const secondTimestamp = invitationsRepo.rows.get(jobData.invitationId)?.emailSentAt;
        // The IS NULL guard in markEmailSent must have preserved the original timestamp
        expect(secondTimestamp).toBe(firstTimestamp);
    });

    it('job payload carries the correct retry opts (attempts + exponential backoff)', async () => {
        await purchasesService.createPurchase({
            parentUserId: 6,
            body: { courseId: 7, studentEmail: 'opts@example.com' },
            idempotency: { key: 'idem-00000006', endpoint: 'POST /purchases', requestHash: 'v'.repeat(64) },
        });

        const { opts } = queueStub.jobs[0];
        expect(opts).toMatchObject({
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnFail: { age: expect.any(Number), count: expect.any(Number) },
        });
    });
});
