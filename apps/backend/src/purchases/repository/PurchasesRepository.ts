import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { PurchaseEntity } from '../entity/PurchaseEntity';

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
}
