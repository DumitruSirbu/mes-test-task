import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PurchaseStatusEnum } from '@mes/shared';
import type { IPurchaseResponse } from '@mes/shared';
import { PurchaseEntity } from '../entity/PurchaseEntity';
import { PurchasesRepository } from '../repository/PurchasesRepository';
import { CoursesService } from '../../courses/service/CoursesService';
import { CourseEntity } from '../../courses/entity/CourseEntity';
import { InvitationsService } from '../../invitations/service/InvitationsService';
import { InvitationsRepository } from '../../invitations/repository/InvitationsRepository';
import { InvitationEntity } from '../../invitations/entity/InvitationEntity';
import { IdempotencyService } from '../../common/idempotency/service/IdempotencyService';
import { CreatePurchaseDto } from '../dto/CreatePurchaseDto';
import { PURCHASE_CREATED_STATUS, PURCHASE_ENDPOINT_SIGNATURE } from '../const/PurchasesConsts';
import { DuplicatePurchaseForStudentError } from '../../common/error/DuplicatePurchaseForStudentError';

interface ICreateArgs {
    parentUserId: number;
    body: CreatePurchaseDto;
    idempotency: {
        key: string;
        endpoint: string;
        requestHash: string;
    };
}

interface ITransactionResult {
    purchase: PurchaseEntity;
    invitation: InvitationEntity;
    plaintextToken: string;
}

/**
 * PurchasesService — owns the atomic write of (purchase + invitation + idempotency row)
 * inside a single TypeORM transaction per ADR 0006.
 *
 * Why transactional: a partial state (purchase exists, no invitation) would leave the
 * parent paying for a grant the student can never redeem. The three INSERTs commit
 * together or none of them do.
 *
 * Failure paths:
 *   - Course missing → CourseNotFoundError (404), thrown before opening the transaction.
 *   - Parent already purchased the same course for the same student email →
 *     DuplicatePurchaseForStudentError (409), thrown before opening the transaction.
 *   - Invitation insert throws → the transaction rolls back; no purchase row is left behind.
 *   - Idempotency UNIQUE violation (concurrent racer) → `IdempotencyService` translates
 *     the QueryFailedError into `IdempotencyBodyMismatchError` (if hashes differ); the
 *     transaction rolls back and the caller retries (or the interceptor's replay path
 *     serves the original response on the second attempt).
 */
@Injectable()
export class PurchasesService {
    private readonly logger = new Logger(PurchasesService.name);

    public constructor(
        private readonly dataSource: DataSource,
        private readonly purchasesRepository: PurchasesRepository,
        private readonly invitationsRepository: InvitationsRepository,
        private readonly invitationsService: InvitationsService,
        private readonly coursesService: CoursesService,
        private readonly idempotencyService: IdempotencyService,
    ) {}

    public async createPurchase(args: ICreateArgs): Promise<IPurchaseResponse> {
        const course = await this.coursesService.findByIdOrThrow(args.body.courseId);

        await this.assertNoDuplicatePurchaseByParent(args.parentUserId, course.courseId, args.body.studentEmail);

        const result = await this.runCreateTransaction(args, course);

        this.logger.log(
            `Purchase completed: id=${result.purchase.purchaseId} parentId=${args.parentUserId} courseId=${course.courseId} invitationId=${result.invitation.invitationId}`,
        );

        return this.composeCreateResponse(result.purchase, course, result.invitation, result.plaintextToken);
    }

    public async listForParent(parentUserId: number): Promise<IPurchaseResponse[]> {
        const purchases = await this.purchasesRepository.listByParent(parentUserId);

        if (purchases.length === 0) {
            return [];
        }

        const purchaseIds = purchases.map((row) => row.purchaseId);
        const courseIds = Array.from(new Set(purchases.map((row) => row.courseId)));

        const [courses, invitations] = await Promise.all([this.coursesByIds(courseIds), this.invitationsRepository.findManyByPurchaseIds(purchaseIds)]);

        const invitationByPurchase = new Map<number, InvitationEntity>();

        for (const invitation of invitations) {
            invitationByPurchase.set(invitation.purchaseId, invitation);
        }

        return purchases.map((purchase) => {
            const course = courses.get(purchase.courseId);
            const invitation = invitationByPurchase.get(purchase.purchaseId);

            if (!course || !invitation) {
                // Should be unreachable: FKs guarantee both. Throw to make a broken invariant loud.
                throw new Error(`Purchase ${purchase.purchaseId} is missing course or invitation row — DB invariant broken.`);
            }

            return this.composeListResponse(purchase, course, invitation);
        });
    }

    /**
     * Exposed for tests + the controller's idempotency context — the endpoint signature
     * is stable across URL re-routes.
     */
    public static get endpointSignature(): string {
        return PURCHASE_ENDPOINT_SIGNATURE;
    }

    /**
     * Guard: reject with 409 if the calling parent has already completed a purchase for the
     * same course AND the same student email. Runs AFTER the course existence check so an
     * unknown courseId still surfaces as 404, not 409. No rows are written before this returns.
     *
     * Scoped to the calling parent on purpose — see DuplicatePurchaseForStudentError for the
     * privacy rationale. The strict invariant against duplicate enrolments across all parents
     * is still enforced at invitation-redemption time by the unique index on
     * `enrolments(student_user_id, course_id)` (ADR 0006). This guard is therefore best-effort
     * UX: it eliminates the most common case (same parent, same student) without leaking
     * cross-parent state.
     */
    private async assertNoDuplicatePurchaseByParent(parentUserId: number, courseId: number, studentEmail: string): Promise<void> {
        const exists = await this.purchasesRepository.existsCompletedForParentCourseAndStudent(parentUserId, courseId, studentEmail);

        if (exists) {
            throw new DuplicatePurchaseForStudentError();
        }
    }

    private async runCreateTransaction(args: ICreateArgs, course: CourseEntity): Promise<ITransactionResult> {
        return this.dataSource.transaction(async (manager) => {
            const purchase = await this.purchasesRepository.insertWithinTransaction(manager, {
                parentUserId: args.parentUserId,
                courseId: course.courseId,
                status: PurchaseStatusEnum.COMPLETED,
                amountPence: course.pricePence,
                idempotencyKey: args.idempotency.key,
            });

            const issued = await this.invitationsService.issueWithinTransaction(manager, {
                purchaseId: purchase.purchaseId,
                studentEmail: args.body.studentEmail,
            });

            // Per ADR 0006, the stored replay body MUST be the minimal `{ purchaseId, invitationId }`
            // shape — never the plaintext token or invitation URL. A DB dump of `idempotency_keys`
            // must not yield live invitation links. A replaying client gets the same minimal body
            // back on retry; the plaintext token lives ONLY in the immediate response on the wire.
            const replayBody = { purchaseId: purchase.purchaseId, invitationId: issued.entity.invitationId };

            await this.idempotencyService.persistWithinTransaction({
                manager,
                key: args.idempotency.key,
                userId: args.parentUserId,
                endpoint: args.idempotency.endpoint,
                requestHash: args.idempotency.requestHash,
                responseStatus: PURCHASE_CREATED_STATUS,
                responseBody: replayBody,
            });

            return { purchase, invitation: issued.entity, plaintextToken: issued.plaintextToken };
        });
    }

    private composeCreateResponse(purchase: PurchaseEntity, course: CourseEntity, invitation: InvitationEntity, plaintextToken: string): IPurchaseResponse {
        return {
            id: purchase.purchaseId,
            courseId: course.courseId,
            status: purchase.status,
            amountPence: purchase.amountPence,
            createdAt: purchase.createdAt.toISOString(),
            invitation: this.invitationsService.toResponseWithPlaintext(invitation, plaintextToken),
        };
    }

    private composeListResponse(purchase: PurchaseEntity, course: CourseEntity, invitation: InvitationEntity): IPurchaseResponse {
        return {
            id: purchase.purchaseId,
            courseId: course.courseId,
            status: purchase.status,
            amountPence: purchase.amountPence,
            createdAt: purchase.createdAt.toISOString(),
            invitation: {
                id: invitation.invitationId,
                studentEmail: invitation.studentEmail,
                status: invitation.status,
                expiresAt: invitation.expiresAt.toISOString(),
                // The plaintext token is never regenerated from the DB hash — the URL
                // would be unusable. Listing returns an empty URL; clients that need to
                // resend should use the admin resend endpoint (M07).
                url: '',
            },
        };
    }

    private async coursesByIds(courseIds: number[]): Promise<Map<number, CourseEntity>> {
        const map = new Map<number, CourseEntity>();

        for (const courseId of courseIds) {
            const course = await this.coursesService.findByIdOrThrow(courseId);
            map.set(courseId, course);
        }

        return map;
    }
}
