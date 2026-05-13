import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { InvitationEntity } from '../entity/InvitationEntity';
import { PurchaseNotFoundError } from '../../common/error/PurchaseNotFoundError';

interface IAtomicRedeemRawRow {
    invitation_id: number;
    purchase_id: number;
    token_hash: string;
    student_email: string;
    status: string;
    expires_at: Date;
    redeemed_at: Date | null;
    email_sent_at: Date | null;
    created_at: Date;
}

/**
 * Repository for `invitations`. Exposes only intention-revealing queries.
 *
 * `insertWithinTransaction` accepts an `EntityManager` so the purchase + invitation
 * insert can share a single TypeORM transaction (the whole point of the M04 atomic
 * write — see ADR 0006).
 */
@Injectable()
export class InvitationsRepository extends BaseRepository<InvitationEntity> {
    public constructor(@InjectRepository(InvitationEntity) repository: Repository<InvitationEntity>) {
        super(repository);
    }

    public async insertWithinTransaction(manager: EntityManager, input: Partial<InvitationEntity>): Promise<InvitationEntity> {
        const entity = manager.create(InvitationEntity, input);

        return manager.save(InvitationEntity, entity);
    }

    /**
     * Atomic conditional UPDATE that transitions the invitation from ISSUED → REDEEMED
     * in a single round-trip. Returns the redeemed entity on success; `null` when zero
     * rows are affected (already redeemed, expired, or token not found).
     *
     * Must run inside the caller-supplied `EntityManager` so it participates in the
     * surrounding redemption transaction.
     */
    public async atomicRedeem(manager: EntityManager, tokenHash: string): Promise<InvitationEntity | null> {
        // TypeORM 0.3 returns [rows, rowCount] for UPDATE/DELETE, not just rows.
        const [rows] = await manager.query<[IAtomicRedeemRawRow[], number]>(
            `UPDATE invitations
                SET status = 'REDEEMED', redeemed_at = now()
              WHERE token_hash = $1
                AND status = 'ISSUED'
                AND expires_at > now()
           RETURNING *`,
            [tokenHash],
        );

        if (rows.length === 0) {
            return null;
        }

        const row = rows[0];

        return manager.create(InvitationEntity, {
            invitationId: row.invitation_id,
            purchaseId: row.purchase_id,
            tokenHash: row.token_hash,
            studentEmail: row.student_email,
            status: row.status as InvitationEntity['status'],
            expiresAt: new Date(row.expires_at),
            redeemedAt: row.redeemed_at ? new Date(row.redeemed_at) : null,
            emailSentAt: row.email_sent_at ? new Date(row.email_sent_at) : null,
            createdAt: new Date(row.created_at),
        });
    }

    public async findByTokenHash(tokenHash: string): Promise<InvitationEntity | null> {
        return this.findOne({ tokenHash });
    }

    /**
     * Find invitation by token hash with purchase → course and purchase → parent user
     * relations eagerly loaded. Used by `getMetaByToken` to render the preview page.
     */
    public async findByTokenHashWithRelations(tokenHash: string): Promise<InvitationEntity | null> {
        return this.repository.findOne({
            where: { tokenHash },
            relations: { purchase: { course: true, parent: true } },
        });
    }

    public async findByPurchaseId(purchaseId: number): Promise<InvitationEntity | null> {
        return this.findOne({ purchaseId });
    }

    public async findManyByPurchaseIds(purchaseIds: number[]): Promise<InvitationEntity[]> {
        if (purchaseIds.length === 0) {
            return [];
        }

        return this.repository.createQueryBuilder('invitation').where('invitation.purchase_id IN (:...purchaseIds)', { purchaseIds }).getMany();
    }

    /**
     * Load `course_id` for a given purchase directly via raw SQL.
     * Used when the invitation's `purchase` relation is not eagerly loaded.
     * Throws `InvitationNotFoundError` when no matching purchase row exists.
     */
    public async findCourseIdByPurchaseId(manager: EntityManager, purchaseId: number): Promise<number> {
        const rows = await manager.query<Array<{ course_id: number }>>('SELECT course_id FROM purchases WHERE purchase_id = $1', [purchaseId]);

        if (rows.length === 0) {
            throw new PurchaseNotFoundError();
        }

        return rows[0].course_id;
    }
}
