import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { InvitationEntity } from '../entity/InvitationEntity';

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

    public async findByTokenHash(tokenHash: string): Promise<InvitationEntity | null> {
        return this.findOne({ tokenHash });
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
}
