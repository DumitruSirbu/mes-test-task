import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource, EntityManager } from 'typeorm';
import { PurchaseStatusEnum } from '@mes/shared';
import { PurchasesService } from '../PurchasesService';
import { INVITATION_EMAIL_QUEUE } from '../../../notifications/const/NotificationsConsts';
import { PurchasesRepository } from '../../repository/PurchasesRepository';
import { InvitationsRepository } from '../../../invitations/repository/InvitationsRepository';
import { InvitationsService } from '../../../invitations/service/InvitationsService';
import { CoursesService } from '../../../courses/service/CoursesService';
import { IdempotencyService } from '../../../common/idempotency/service/IdempotencyService';
import { CourseEntity } from '../../../courses/entity/CourseEntity';
import { InvitationEntity } from '../../../invitations/entity/InvitationEntity';
import { PurchaseEntity } from '../../entity/PurchaseEntity';
import { CourseSubjectEnum, InvitationStatusEnum } from '@mes/shared';
import { DuplicatePurchaseForStudentError } from '../../../common/error/DuplicatePurchaseForStudentError';

type PurchasesRepositoryMock = Pick<PurchasesRepository, 'insertWithinTransaction' | 'listByParent' | 'existsCompletedForParentCourseAndStudent'>;
type InvitationsRepositoryMock = Pick<InvitationsRepository, 'findManyByPurchaseIds'>;
type InvitationsServiceMock = Pick<InvitationsService, 'issueWithinTransaction' | 'toResponseWithPlaintext'>;
type CoursesServiceMock = Pick<CoursesService, 'findByIdOrThrow'>;
type IdempotencyServiceMock = Pick<IdempotencyService, 'persistWithinTransaction' | 'findReplay'>;

describe('PurchasesService', () => {
    let service: PurchasesService;

    const insertPurchaseMock = jest.fn();
    const listByParentMock = jest.fn();
    const existsDuplicateMock = jest.fn();
    const issueInvitationMock = jest.fn();
    const toResponseMock = jest.fn();
    const findManyInvitationsMock = jest.fn();
    const findCourseMock = jest.fn();
    const persistKeyMock = jest.fn();
    const findReplayMock = jest.fn();
    const transactionMock = jest.fn();

    const fakeManager = {} as EntityManager;

    const buildCourse = (): CourseEntity => {
        const course = new CourseEntity();
        course.courseId = 7;
        course.subject = CourseSubjectEnum.MATHS;
        course.yearFrom = 7;
        course.yearTo = 7;
        course.title = 'Maths Year 7';
        course.pricePence = 19900;
        course.createdAt = new Date('2026-05-13T10:00:00Z');

        return course;
    };

    const buildPurchase = (): PurchaseEntity => {
        const purchase = new PurchaseEntity();
        purchase.purchaseId = 1;
        purchase.parentUserId = 42;
        purchase.courseId = 7;
        purchase.status = PurchaseStatusEnum.COMPLETED;
        purchase.amountPence = 19900;
        purchase.idempotencyKey = 'idem-12345678';
        purchase.createdAt = new Date('2026-05-13T10:00:00Z');
        purchase.updatedAt = new Date('2026-05-13T10:00:00Z');

        return purchase;
    };

    const buildInvitation = (): InvitationEntity => {
        const invitation = new InvitationEntity();
        invitation.invitationId = 99;
        invitation.purchaseId = 1;
        invitation.tokenHash = 'a'.repeat(64);
        invitation.studentEmail = 'student@example.com';
        invitation.status = InvitationStatusEnum.ISSUED;
        invitation.expiresAt = new Date('2026-05-27T10:00:00Z');
        invitation.createdAt = new Date('2026-05-13T10:00:00Z');

        return invitation;
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        // Default: parent has no prior matching completed purchase — precheck passes.
        existsDuplicateMock.mockResolvedValue(false);
        transactionMock.mockImplementation(async (runInTransaction: (manager: EntityManager) => Promise<unknown>) => runInTransaction(fakeManager));
        toResponseMock.mockImplementation((entity: InvitationEntity, plaintext: string) => ({
            id: entity.invitationId,
            studentEmail: entity.studentEmail,
            status: entity.status,
            expiresAt: entity.expiresAt.toISOString(),
            url: `https://example.test/invite?token=${plaintext}`,
        }));

        const dataSourceMock: Pick<DataSource, 'transaction'> = { transaction: transactionMock };

        const purchasesRepositoryMock: PurchasesRepositoryMock = {
            insertWithinTransaction: insertPurchaseMock,
            listByParent: listByParentMock,
            existsCompletedForParentCourseAndStudent: existsDuplicateMock,
        };

        const invitationsRepositoryMock: InvitationsRepositoryMock = {
            findManyByPurchaseIds: findManyInvitationsMock,
        };

        const invitationsServiceMock: InvitationsServiceMock = {
            issueWithinTransaction: issueInvitationMock,
            toResponseWithPlaintext: toResponseMock,
        };

        const coursesServiceMock: CoursesServiceMock = {
            findByIdOrThrow: findCourseMock,
        };

        const idempotencyServiceMock: IdempotencyServiceMock = {
            persistWithinTransaction: persistKeyMock,
            findReplay: findReplayMock,
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                PurchasesService,
                { provide: DataSource, useValue: dataSourceMock },
                { provide: PurchasesRepository, useValue: purchasesRepositoryMock },
                { provide: InvitationsRepository, useValue: invitationsRepositoryMock },
                { provide: InvitationsService, useValue: invitationsServiceMock },
                { provide: CoursesService, useValue: coursesServiceMock },
                { provide: IdempotencyService, useValue: idempotencyServiceMock },
                { provide: getQueueToken(INVITATION_EMAIL_QUEUE), useValue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }) } },
            ],
        }).compile();

        service = moduleRef.get(PurchasesService);
    });

    describe('createPurchase', () => {
        it('writes purchase + invitation + idempotency row inside the same transaction', async () => {
            findCourseMock.mockResolvedValue(buildCourse());
            insertPurchaseMock.mockResolvedValue(buildPurchase());
            issueInvitationMock.mockResolvedValue({ entity: buildInvitation(), plaintextToken: 'plaintext-xyz', invitationUrl: 'https://mes.test/invite/plaintext-xyz' });
            persistKeyMock.mockResolvedValue(undefined);

            const result = await service.createPurchase({
                parentUserId: 42,
                body: { courseId: 7, studentEmail: 'student@example.com' },
                idempotency: { key: 'idem-12345678', endpoint: 'POST /purchases', requestHash: 'h'.repeat(64) },
            });

            expect(transactionMock).toHaveBeenCalledTimes(1);
            expect(insertPurchaseMock).toHaveBeenCalledWith(
                fakeManager,
                expect.objectContaining({ parentUserId: 42, courseId: 7, amountPence: 19900, status: PurchaseStatusEnum.COMPLETED }),
            );
            expect(issueInvitationMock).toHaveBeenCalledWith(fakeManager, { purchaseId: 1, studentEmail: 'student@example.com' });
            expect(persistKeyMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    manager: fakeManager,
                    key: 'idem-12345678',
                    responseStatus: 201,
                    responseBody: { purchaseId: 1, invitationId: 99 },
                }),
            );
            expect(result.id).toBe(1);
            expect(result.invitation.url).toBe('https://example.test/invite?token=plaintext-xyz');
        });

        it('rolls back when invitation issuance fails (no idempotency row persisted)', async () => {
            findCourseMock.mockResolvedValue(buildCourse());
            insertPurchaseMock.mockResolvedValue(buildPurchase());
            issueInvitationMock.mockRejectedValue(new Error('synthetic invitation failure'));

            // The transaction mock rethrows whatever the callback throws — same behaviour as TypeORM.
            transactionMock.mockImplementation(async (runInTransaction: (manager: EntityManager) => Promise<unknown>) => {
                return runInTransaction(fakeManager);
            });

            await expect(
                service.createPurchase({
                    parentUserId: 42,
                    body: { courseId: 7, studentEmail: 'student@example.com' },
                    idempotency: { key: 'idem-12345678', endpoint: 'POST /purchases', requestHash: 'h'.repeat(64) },
                }),
            ).rejects.toThrow('synthetic invitation failure');

            expect(persistKeyMock).not.toHaveBeenCalled();
        });

        it('rolls back when idempotency persistence fails (purchase + invitation not visible)', async () => {
            findCourseMock.mockResolvedValue(buildCourse());
            insertPurchaseMock.mockResolvedValue(buildPurchase());
            issueInvitationMock.mockResolvedValue({ entity: buildInvitation(), plaintextToken: 'plaintext-xyz', invitationUrl: 'https://mes.test/invite/plaintext-xyz' });
            persistKeyMock.mockRejectedValue(new Error('IDEMPOTENCY_BODY_MISMATCH'));

            await expect(
                service.createPurchase({
                    parentUserId: 42,
                    body: { courseId: 7, studentEmail: 'student@example.com' },
                    idempotency: { key: 'idem-12345678', endpoint: 'POST /purchases', requestHash: 'h'.repeat(64) },
                }),
            ).rejects.toThrow('IDEMPOTENCY_BODY_MISMATCH');

            // The transaction wrapper rolls back; from the service's perspective the
            // failed call simply propagates — the caller must not see a committed purchase.
            expect(transactionMock).toHaveBeenCalledTimes(1);
        });

        it('propagates CourseNotFoundError before opening any transaction', async () => {
            findCourseMock.mockRejectedValue(new Error('COURSE_NOT_FOUND'));

            await expect(
                service.createPurchase({
                    parentUserId: 42,
                    body: { courseId: 999, studentEmail: 'student@example.com' },
                    idempotency: { key: 'idem-12345678', endpoint: 'POST /purchases', requestHash: 'h'.repeat(64) },
                }),
            ).rejects.toThrow('COURSE_NOT_FOUND');

            expect(transactionMock).not.toHaveBeenCalled();
            expect(insertPurchaseMock).not.toHaveBeenCalled();
        });

        it('throws DuplicatePurchaseForStudentError and does not open a transaction when the parent already purchased this course for this student email', async () => {
            findCourseMock.mockResolvedValue(buildCourse());
            existsDuplicateMock.mockResolvedValue(true);

            await expect(
                service.createPurchase({
                    parentUserId: 42,
                    body: { courseId: 7, studentEmail: 'student@example.com' },
                    idempotency: { key: 'idem-12345678', endpoint: 'POST /purchases', requestHash: 'h'.repeat(64) },
                }),
            ).rejects.toBeInstanceOf(DuplicatePurchaseForStudentError);

            expect(existsDuplicateMock).toHaveBeenCalledWith(42, 7, 'student@example.com');
            expect(transactionMock).not.toHaveBeenCalled();
            expect(insertPurchaseMock).not.toHaveBeenCalled();
        });

        it('proceeds normally when the parent has no matching prior completed purchase', async () => {
            findCourseMock.mockResolvedValue(buildCourse());
            // existsDuplicateMock returns false from beforeEach.
            insertPurchaseMock.mockResolvedValue(buildPurchase());
            issueInvitationMock.mockResolvedValue({ entity: buildInvitation(), plaintextToken: 'plaintext-xyz', invitationUrl: 'https://mes.test/invite/plaintext-xyz' });
            persistKeyMock.mockResolvedValue(undefined);

            await service.createPurchase({
                parentUserId: 42,
                body: { courseId: 7, studentEmail: 'student@example.com' },
                idempotency: { key: 'idem-12345678', endpoint: 'POST /purchases', requestHash: 'h'.repeat(64) },
            });

            expect(existsDuplicateMock).toHaveBeenCalledWith(42, 7, 'student@example.com');
            expect(transactionMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('listForParent', () => {
        it('returns an empty array when the parent has no purchases', async () => {
            listByParentMock.mockResolvedValue([]);

            const result = await service.listForParent(42);

            expect(result).toEqual([]);
            expect(findManyInvitationsMock).not.toHaveBeenCalled();
        });

        it('composes purchases with their courses and invitations (URL omitted)', async () => {
            const purchase = buildPurchase();
            const invitation = buildInvitation();
            listByParentMock.mockResolvedValue([purchase]);
            findCourseMock.mockResolvedValue(buildCourse());
            findManyInvitationsMock.mockResolvedValue([invitation]);

            const result = await service.listForParent(42);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(purchase.purchaseId);
            expect(result[0].invitation.id).toBe(invitation.invitationId);
            expect(result[0].invitation.url).toBe('');
        });
    });
});
