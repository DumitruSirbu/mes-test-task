import type { EntityManager, Repository } from 'typeorm';
import { InvitationStatusEnum } from '@mes/shared';
import { InvitationEntity } from '../entity/InvitationEntity';
import { InvitationsRepository } from './InvitationsRepository';

/**
 * TypeORM 0.3 returns [rows, rowCount] for UPDATE/DELETE — not just rows.
 * These tests pin that contract so a TypeORM upgrade or driver change is caught
 * before it reaches production.
 */

function buildMockManager(queryResult: unknown): EntityManager {
    return {
        query: jest.fn().mockResolvedValue(queryResult),
        create: <T extends object>(_EntityClass: new () => T, data: Partial<T>): T =>
            Object.assign(new _EntityClass(), data),
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
