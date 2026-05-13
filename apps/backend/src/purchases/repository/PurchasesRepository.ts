import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PurchaseStatusEnum } from '@mes/shared';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { PurchaseEntity } from '../entity/PurchaseEntity';
import { InvitationEntity } from '../../invitations/entity/InvitationEntity';

/**
 * Repository for `purchases`. `insertWithinTransaction` participates in the caller's
 * transaction so the purchase + invitation + idempotency row commit atomically.
 */
@Injectable()
export class PurchasesRepository extends BaseRepository<PurchaseEntity> {
    public constructor(@InjectRepository(PurchaseEntity) repository: Repository<PurchaseEntity>) {
        super(repository);
    }

    public async insertWithinTransaction(manager: EntityManager, input: Partial<PurchaseEntity>): Promise<PurchaseEntity> {
        const entity = manager.create(PurchaseEntity, input);

        return manager.save(PurchaseEntity, entity);
    }

    public async listByParent(parentUserId: number): Promise<PurchaseEntity[]> {
        return this.repository.find({
            where: { parentUserId },
            order: { createdAt: 'DESC' },
        });
    }

    public async findByIdForParent(purchaseId: number, parentUserId: number): Promise<PurchaseEntity | null> {
        return this.findOne({ purchaseId, parentUserId });
    }

    /**
     * Returns true when the calling parent already holds a COMPLETED purchase for the
     * given course AND its embedded invitation targets the given student email.
     *
     * Scoped to the calling parent so the answer never depends on rows owned by other
     * parents — preventing the endpoint from acting as a (studentEmail, courseId)
     * enrolment-existence oracle for other accounts.
     */
    public async existsCompletedForParentCourseAndStudent(parentUserId: number, courseId: number, studentEmail: string): Promise<boolean> {
        const normalisedEmail = studentEmail.trim().toLowerCase();

        const match = await this.repository
            .createQueryBuilder('p')
            .innerJoin(InvitationEntity, 'i', 'i.purchase_id = p.purchase_id')
            .where('p.parent_user_id = :parentUserId', { parentUserId })
            .andWhere('p.course_id = :courseId', { courseId })
            .andWhere('p.status = :status', { status: PurchaseStatusEnum.COMPLETED })
            .andWhere('i.student_email = :studentEmail', { studentEmail: normalisedEmail })
            .select('p.purchase_id', 'purchaseId')
            .limit(1)
            .getRawOne<{ purchaseId: number }>();

        return match !== undefined;
    }
}
