import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { RefreshTokenEntity } from '../entity/RefreshTokenEntity';

interface IInsertRefreshTokenValues {
    userId: number;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
}

interface IDeleteCleanupResult {
    deletedExpired: number;
    deletedRevoked: number;
}

/**
 * Repository for `refresh_tokens`.
 *
 * All write methods accept an optional `EntityManager` so callers can enlist them
 * in an existing transaction (the rotation path in `AuthService` requires this).
 * When `manager` is provided, the method operates on the transaction's connection;
 * otherwise it falls back to the module-scoped repository.
 */
@Injectable()
export class RefreshTokensRepository extends BaseRepository<RefreshTokenEntity> {
    public constructor(
        @InjectRepository(RefreshTokenEntity)
        repository: Repository<RefreshTokenEntity>,
    ) {
        super(repository);
    }

    /** Fetch a row by its SHA-256 hash. Returns `null` when not found. */
    public async findByTokenHash(hash: string, manager?: EntityManager): Promise<RefreshTokenEntity | null> {
        const qb = manager ? manager.getRepository(RefreshTokenEntity).createQueryBuilder('rt') : this.repository.createQueryBuilder('rt');

        return qb.where('rt.token_hash = :hash', { hash }).getOne();
    }

    /**
     * `SELECT ... FOR UPDATE` — serialises concurrent refresh attempts on the same token
     * inside the rotation transaction (ADR 0007 §4). Uses `getOne()` since `token_hash`
     * has a UNIQUE constraint — at most one row can match.
     */
    public async selectForUpdate(hash: string, manager: EntityManager): Promise<RefreshTokenEntity | null> {
        return manager
            .getRepository(RefreshTokenEntity)
            .createQueryBuilder('rt')
            .where('rt.token_hash = :hash', { hash })
            .setLock('pessimistic_write')
            .getOne();
    }

    /** Insert a freshly issued refresh token row inside an active transaction. */
    public async insertNew(values: IInsertRefreshTokenValues, manager: EntityManager): Promise<RefreshTokenEntity> {
        const repo = manager.getRepository(RefreshTokenEntity);
        const entity = repo.create({
            userId: values.userId,
            familyId: values.familyId,
            tokenHash: values.tokenHash,
            expiresAt: values.expiresAt,
            revokedAt: null,
            replacedById: null,
            userAgent: values.userAgent,
            ip: values.ip,
        });

        return repo.save(entity);
    }

    /**
     * Mark a single row as revoked after rotation.
     * Sets `revoked_at = NOW()` and `replaced_by_id` to the successor's id.
     * Returns the number of rows affected (should be 1; 0 indicates a race).
     */
    public async revokeRow(id: number, replacedById: number, manager: EntityManager): Promise<number> {
        const result = await manager
            .getRepository(RefreshTokenEntity)
            .createQueryBuilder()
            .update()
            .set({ revokedAt: () => 'NOW()', replacedById })
            .where('id = :id AND revoked_at IS NULL', { id })
            .execute();

        return result.affected ?? 0;
    }

    /**
     * Mark a single row as revoked on logout, without setting `replaced_by_id`.
     * Used when the user explicitly logs out — no successor token is issued.
     * Returns the number of rows affected (idempotent: 0 if already revoked).
     */
    public async revokeRowForLogout(id: number, manager: EntityManager): Promise<number> {
        const result = await manager
            .getRepository(RefreshTokenEntity)
            .createQueryBuilder()
            .update()
            .set({ revokedAt: () => 'NOW()' })
            .where('id = :id AND revoked_at IS NULL', { id })
            .execute();

        return result.affected ?? 0;
    }

    /**
     * Revoke every active token in a family (theft path — ADR 0007 §7).
     * Returns the number of rows affected.
     */
    public async revokeFamily(familyId: string, manager?: EntityManager): Promise<number> {
        const qb = manager ? manager.getRepository(RefreshTokenEntity).createQueryBuilder() : this.repository.createQueryBuilder();

        const result = await qb
            .update(RefreshTokenEntity)
            .set({ revokedAt: () => 'NOW()' })
            .where('family_id = :familyId AND revoked_at IS NULL', { familyId })
            .execute();

        return result.affected ?? 0;
    }

    /**
     * Cleanup: delete rows outside the retention windows (ADR 0007 §10).
     *
     * Both delete passes run inside a single transaction so that a partial failure
     * does not leave the table in an inconsistent state (e.g. expired rows deleted
     * but stale-revoked rows not, or vice versa). The deletes target disjoint sets
     * so order does not matter, but the transaction keeps them atomic.
     *
     * Parameterised interval binding (`make_interval`) avoids future SQLi risk if
     * the constants are ever promoted to env-wired config values.
     *
     * @param graceDays    — rows whose `expires_at < NOW() - graceDays days` are deleted.
     * @param forensicDays — rows whose `revoked_at < NOW() - forensicDays days` are deleted.
     */
    public async deleteExpiredAndStaleRevoked(graceDays: number, forensicDays: number): Promise<IDeleteCleanupResult> {
        return this.repository.manager.connection.transaction(async (manager) => {
            const expiredResult = await manager
                .getRepository(RefreshTokenEntity)
                .createQueryBuilder()
                .delete()
                .from(RefreshTokenEntity)
                .where('expires_at < NOW() - make_interval(days => :graceDays)', { graceDays })
                .execute();

            const revokedResult = await manager
                .getRepository(RefreshTokenEntity)
                .createQueryBuilder()
                .delete()
                .from(RefreshTokenEntity)
                .where('revoked_at IS NOT NULL AND revoked_at < NOW() - make_interval(days => :forensicDays)', { forensicDays })
                .execute();

            return {
                deletedExpired: expiredResult.affected ?? 0,
                deletedRevoked: revokedResult.affected ?? 0,
            };
        });
    }

    /**
     * Count rows that have been revoked longer ago than `thresholdDays`.
     * Used by the cleanup job's retention-breach hard assertion (ADR 0007 §10).
     *
     * Parameterised `make_interval` avoids SQL injection risk if `thresholdDays`
     * is ever wired to an env var rather than a compile-time constant.
     */
    public async countPastForensicWindow(thresholdDays: number): Promise<number> {
        return this.repository.createQueryBuilder('rt').where('rt.revoked_at < NOW() - make_interval(days => :thresholdDays)', { thresholdDays }).getCount();
    }
}
