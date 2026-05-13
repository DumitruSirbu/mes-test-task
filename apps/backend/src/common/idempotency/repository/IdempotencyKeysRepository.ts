import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BaseRepository } from '../../repository/BaseRepository';
import { IdempotencyKeyEntity } from '../entity/IdempotencyKeyEntity';

/**
 * Repository for `idempotency_keys`. The lookup path (`findReplay`) runs OUTSIDE any
 * transaction — it's the cheap pre-handler short-circuit. The insert path runs INSIDE
 * the caller's transaction (`insertWithinTransaction`) so the response row + business
 * row commit atomically per ADR 0006.
 */
@Injectable()
export class IdempotencyKeysRepository extends BaseRepository<IdempotencyKeyEntity> {
    public constructor(@InjectRepository(IdempotencyKeyEntity) repository: Repository<IdempotencyKeyEntity>) {
        super(repository);
    }

    public async findReplay(userId: number, endpoint: string, key: string): Promise<IdempotencyKeyEntity | null> {
        return this.findOne({ userId, endpoint, key });
    }

    public async insertWithinTransaction(manager: EntityManager, input: Partial<IdempotencyKeyEntity>): Promise<IdempotencyKeyEntity> {
        const entity = manager.create(IdempotencyKeyEntity, input);

        return manager.save(IdempotencyKeyEntity, entity);
    }
}
