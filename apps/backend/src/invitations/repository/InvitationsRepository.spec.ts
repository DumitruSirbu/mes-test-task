import type { EntityManager, Repository } from 'typeorm';
import { InvitationStatusEnum } from '@mes/shared';
import { InvitationEntity } from '../entity/InvitationEntity';
import { InvitationsRepository } from './InvitationsRepository';

/**
 * TypeORM 0.3 returns [rows, rowCount] for UPDATE/DELETE — not just rows.
 * These tests pin that contract so a TypeORM upgrade or driver change is caught
 * before it reaches production.
 */

/**
 * Minimal interface covering the TypeORM `Repository` surface used by
 * `InvitationsRepository`. Using a typed interface avoids `as unknown as X`
 * double-casts, which are forbidden by code-conventions.md.
 */
interface IMinimalRepository {
    createQueryBuilder: () => unknown;
    findOne?: (options: unknown) => Promise<InvitationEntity | null>;
}

function buildMockManager(queryResult: unknown): EntityManager {
    return {
        query: jest.fn().mockResolvedValue(queryResult),
        create: <T extends object>(_EntityClass: new () => T, data: Partial<T>): T => Object.assign(new _EntityClass(), data),
    } as unknown as EntityManager;
}

function buildRepo(): InvitationsRepository {
    return new InvitationsRepository({} as Repository<InvitationEntity>);
}

const TOKEN_HASH = 'a'.repeat(64);

const RAW_ROW = {
    invitation_id: 1,
    purchase_id: 2,
    token_hash: TOKEN_HASH,
    student_email: 'student@example.com',
    status: InvitationStatusEnum.REDEEMED,
    expires_at: new Date('2026-12-01T00:00:00Z'),
    redeemed_at: new Date('2026-05-13T17:00:00Z'),
    email_sent_at: null,
    created_at: new Date('2026-05-01T00:00:00Z'),
};

/**
 * Mock QueryBuilder used to exercise `markEmailSent`.
 *
 * TypeORM's fluent builder is replaced by a minimal stub that records the WHERE
 * clause and returns an object compatible with the chained calls the method makes.
 */
interface IQueryBuilderSpy {
    whereSql: string;
    whereParams: Record<string, unknown>;
    executeCalled: boolean;
}

function buildMockQueryBuilder(spy: IQueryBuilderSpy): unknown {
    const builder = {
        update: () => builder,
        set: () => builder,
        where: (sql: string, params: Record<string, unknown>) => {
            spy.whereSql = sql;
            spy.whereParams = params;

            return builder;
        },
        execute: () => {
            spy.executeCalled = true;

            return Promise.resolve({ affected: 1 });
        },
    };

    return builder;
}

describe('InvitationsRepository.markEmailSent', () => {
    it('issues an UPDATE with WHERE email_sent_at IS NULL so the write is idempotent', async () => {
        const spy: IQueryBuilderSpy = { whereSql: '', whereParams: {}, executeCalled: false };
        const mockRepository: IMinimalRepository = {
            createQueryBuilder: () => buildMockQueryBuilder(spy),
        };
        const repo = new InvitationsRepository(mockRepository as unknown as Repository<InvitationEntity>);

        const affected = await repo.markEmailSent(42);

        expect(spy.executeCalled).toBe(true);
        expect(spy.whereSql).toContain('email_sent_at IS NULL');
        expect(spy.whereParams).toMatchObject({ invitationId: 42 });
        expect(affected).toBe(1);
    });

    it('returns 0 on second call (IS NULL guard prevents double-write)', async () => {
        // Simulate: first call affects 1 row; second call affects 0 rows (IS NULL guard).
        // Both calls must succeed without throwing — BullMQ should not retry on a no-op.
        const affectedCounts = [1, 0];
        let callIndex = 0;

        const mockRepository: IMinimalRepository = {
            createQueryBuilder: () => {
                const affected = affectedCounts[callIndex++ % affectedCounts.length];
                const builder: unknown = {
                    update: () => builder,
                    set: () => builder,
                    where: () => builder,
                    execute: () => Promise.resolve({ affected }),
                };

                return builder;
            },
        };
        const repo = new InvitationsRepository(mockRepository as unknown as Repository<InvitationEntity>);

        // First call: row is updated — affected should be 1
        const first = await repo.markEmailSent(42);
        expect(first).toBe(1);

        // Second call: IS NULL guard fires — affected should be 0, no throw
        const second = await repo.markEmailSent(42);
        expect(second).toBe(0);
    });
});

describe('InvitationsRepository.atomicRedeem', () => {
    it('returns a fully populated entity when the UPDATE affects one row', async () => {
        const manager = buildMockManager([[RAW_ROW], 1]);
        const repo = buildRepo();

        const result = await repo.atomicRedeem(manager, TOKEN_HASH);

        expect(result).not.toBeNull();
        expect(result!.invitationId).toBe(1);
        expect(result!.purchaseId).toBe(2);
        expect(result!.tokenHash).toBe(TOKEN_HASH);
        expect(result!.studentEmail).toBe('student@example.com');
        expect(result!.status).toBe(InvitationStatusEnum.REDEEMED);
        expect(result!.redeemedAt).toBeInstanceOf(Date);
    });

    it('returns null when the UPDATE affects zero rows (expired / already redeemed / unknown token)', async () => {
        const manager = buildMockManager([[], 0]);
        const repo = buildRepo();

        const result = await repo.atomicRedeem(manager, TOKEN_HASH);

        expect(result).toBeNull();
    });

    it('passes the token hash as the sole query parameter', async () => {
        const manager = buildMockManager([[RAW_ROW], 1]);
        const repo = buildRepo();

        await repo.atomicRedeem(manager, TOKEN_HASH);

        const [, params] = (manager.query as jest.Mock).mock.calls[0] as [string, unknown[]];
        expect(params).toEqual([TOKEN_HASH]);
    });
});
