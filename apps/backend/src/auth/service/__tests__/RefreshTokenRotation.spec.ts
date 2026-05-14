/**
 * Unit tests for M10 refresh-token rotation logic in AuthService.
 *
 * Covers:
 *   - Token hashing (deterministic, raw never stored)
 *   - Rotation: new token with same family_id, old row revoked + replaced_by_id set, single transaction
 *   - Reuse-detection theft path: revoked token outside grace window → family revoked, warn logged, 401
 *   - Reuse-detection grace path: revoked token within grace window, matching UA → successor returned verbatim
 *   - Reuse-detection grace path: mismatched UA → treated as theft
 *   - Expired token → REFRESH_TOKEN_EXPIRED, no family revocation
 *   - signup vs login produce identical token shape
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { UserRoleEnum } from '@mes/shared';
import { AuthService } from '../AuthService';
import { UsersRepository } from '../../../users/repository/UsersRepository';
import { UsersService } from '../../../users/service/UsersService';
import { RefreshTokensRepository } from '../../repository/RefreshTokensRepository';
import { RefreshTokenError } from '../../../common/error/RefreshTokenError';
import { UserEntity } from '../../../users/entity/UserEntity';
import {
    ARGON2_MEMORY_COST,
    ARGON2_PARALLELISM,
    ARGON2_TIME_COST,
    REFRESH_REUSE_GRACE_SECONDS,
} from '../../const/AuthConsts';
import type { IRefreshTokenPair } from '../AuthService';
import type { ICreateUserInput } from '../../../users/interface/ICreateUserInput';

type RefreshTokensRepositoryMock = Pick<
    RefreshTokensRepository,
    'insertNew' | 'findByTokenHash' | 'selectForUpdate' | 'revokeRow' | 'revokeRowForLogout' | 'revokeFamily'
>;

const META = { userAgent: 'Mozilla/5.0 (jest)', ip: '10.0.0.1' };
const DIFFERENT_UA_META = { userAgent: 'Mozilla/5.0 (different-device)', ip: '10.0.0.2' };

const buildUser = (overrides?: Partial<UserEntity>): UserEntity => {
    const entity = new UserEntity();
    entity.userId = 1;
    entity.email = 'user@mes.test';
    entity.passwordHash = 'hash-placeholder';
    entity.role = UserRoleEnum.PARENT;
    entity.firstName = null;
    entity.lastName = null;
    entity.createdAt = new Date();
    entity.updatedAt = new Date();

    return Object.assign(entity, overrides ?? {});
};

const buildTokenRow = (
    overrides?: Partial<{
        id: number;
        tokenHash: string;
        expiresAt: Date;
        revokedAt: Date | null;
        replacedById: number | null;
        familyId: string;
        userId: number;
        userAgent: string | null;
        ip: string | null;
        issuedAt: Date;
    }>,
) => {
    const base = {
        id: 10,
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        revokedAt: null,
        replacedById: null,
        familyId: 'family-uuid-v4',
        userId: 1,
        userAgent: META.userAgent,
        ip: META.ip,
        issuedAt: new Date(),
    };

    return Object.assign(base, overrides ?? {});
};

describe('AuthService — refresh-token rotation (M10)', () => {
    let service: AuthService;

    const insertNewMock = jest.fn();
    const findByTokenHashMock = jest.fn();
    const selectForUpdateMock = jest.fn();
    const revokeRowMock = jest.fn();
    const revokeRowForLogoutMock = jest.fn();
    const revokeFamilyMock = jest.fn();
    const findByIdServiceMock = jest.fn();
    const findByEmailMock = jest.fn();
    const insertUserMock = jest.fn();
    const signMock = jest.fn().mockReturnValue('jwt-access-token');

    const managerMock = { getRepository: jest.fn(), save: jest.fn() };
    const transactionMock = jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(managerMock));
    const dataSourceMock = { transaction: transactionMock };

    beforeEach(async () => {
        jest.clearAllMocks();
        jest.useRealTimers();
        signMock.mockReturnValue('jwt-access-token');
        transactionMock.mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(managerMock));
        insertNewMock.mockResolvedValue(buildTokenRow({ id: 99 }));
        revokeRowMock.mockResolvedValue(1);
        revokeRowForLogoutMock.mockResolvedValue(1);
        revokeFamilyMock.mockResolvedValue(1);
        findByIdServiceMock.mockResolvedValue(buildUser());

        const refreshTokensRepositoryMock: RefreshTokensRepositoryMock = {
            insertNew: insertNewMock,
            findByTokenHash: findByTokenHashMock,
            selectForUpdate: selectForUpdateMock,
            revokeRow: revokeRowMock,
            revokeRowForLogout: revokeRowForLogoutMock,
            revokeFamily: revokeFamilyMock,
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: UsersRepository, useValue: { findByEmail: findByEmailMock, insertUser: insertUserMock, updatePasswordHash: jest.fn() } },
                { provide: UsersService, useValue: { findById: findByIdServiceMock, findByEmail: jest.fn(), updatePasswordHash: jest.fn() } },
                { provide: JwtService, useValue: { sign: signMock } },
                { provide: RefreshTokensRepository, useValue: refreshTokensRepositoryMock },
                { provide: DataSource, useValue: dataSourceMock },
                { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('10m') } },
            ],
        }).compile();

        service = moduleRef.get(AuthService);
        await moduleRef.init();
    });

    // -------------------------------------------------------------------------
    // Token hashing
    // -------------------------------------------------------------------------

    describe('hashToken', () => {
        it('produces a 64-character hex string (SHA-256)', () => {
            const hash = service.hashToken('some-raw-token');

            expect(hash).toHaveLength(64);
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('is deterministic: same input always yields same output', () => {
            const raw = 'deterministic-token-abc123';

            expect(service.hashToken(raw)).toBe(service.hashToken(raw));
        });

        it('produces different hashes for different inputs', () => {
            expect(service.hashToken('tokenA')).not.toBe(service.hashToken('tokenB'));
        });

        it('raw token value never appears in the hash output', () => {
            const raw = 'my-secret-refresh-token-raw-value';
            const hash = service.hashToken(raw);

            expect(hash).not.toContain(raw);
        });
    });

    // -------------------------------------------------------------------------
    // Rotation: happy path
    // -------------------------------------------------------------------------

    describe('refresh — happy path (rotation)', () => {
        it('inserts a new token row with the same family_id', async () => {
            const existingRow = buildTokenRow({ familyId: 'stable-family-id' });
            selectForUpdateMock.mockResolvedValue(existingRow);

            await service.refresh('raw-valid-token', META);

            expect(insertNewMock).toHaveBeenCalledTimes(1);
            const insertCall = (insertNewMock.mock.calls[0] as [{ familyId: string }, unknown])[0];
            expect(insertCall.familyId).toBe('stable-family-id');
        });

        it('marks the old row revoked with replaced_by_id pointing to the new row', async () => {
            const existingRow = buildTokenRow({ id: 10 });
            const newRow = buildTokenRow({ id: 99 });
            selectForUpdateMock.mockResolvedValue(existingRow);
            insertNewMock.mockResolvedValue(newRow);

            await service.refresh('raw-valid-token', META);

            expect(revokeRowMock).toHaveBeenCalledWith(10, 99, managerMock);
        });

        it('runs insert and revoke inside a single transaction (same manager)', async () => {
            selectForUpdateMock.mockResolvedValue(buildTokenRow());
            insertNewMock.mockResolvedValue(buildTokenRow({ id: 99 }));

            await service.refresh('raw-valid-token', META);

            // Both insertNew and revokeRow must receive the same transaction manager.
            const insertManager = (insertNewMock.mock.calls[0] as [unknown, typeof managerMock])[1];
            const revokeManager = (revokeRowMock.mock.calls[0] as [unknown, unknown, typeof managerMock])[2];
            expect(insertManager).toBe(managerMock);
            expect(revokeManager).toBe(managerMock);
        });

        it('returns a new raw token (different from the input) and an access token', async () => {
            selectForUpdateMock.mockResolvedValue(buildTokenRow());

            const result = await service.refresh('raw-valid-token', META);

            expect(result.accessToken.accessToken).toBe('jwt-access-token');
            expect(result.refreshToken.raw).toBeDefined();
            expect(typeof result.refreshToken.raw).toBe('string');
            expect(result.refreshToken.raw.length).toBeGreaterThan(0);
            expect(result.refreshToken.expiresAt).toBeInstanceOf(Date);
        });

        it('rollback: when insertNew throws, revokeRow is never called and old token remains valid', async () => {
            selectForUpdateMock.mockResolvedValue(buildTokenRow());
            const insertError = new Error('unique constraint violation');
            insertNewMock.mockRejectedValue(insertError);

            // The transaction mock propagates the error.
            await expect(service.refresh('raw-valid-token', META)).rejects.toThrow('unique constraint violation');
            expect(revokeRowMock).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // Reuse-detection — theft path
    // -------------------------------------------------------------------------

    describe('refresh — reuse-detection theft path', () => {
        it('revokes the entire family when a revoked token is replayed outside the grace window', async () => {
            const revokedAt = new Date(Date.now() - (REFRESH_REUSE_GRACE_SECONDS + 5) * 1_000);
            const row = buildTokenRow({ revokedAt, replacedById: 20 });
            selectForUpdateMock.mockResolvedValue(row);

            await expect(service.refresh('old-revoked-token', META)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });

            expect(revokeFamilyMock).toHaveBeenCalledWith('family-uuid-v4', managerMock);
        });

        it('emits REFRESH_TOKEN_REUSED warn log with userId, familyId, uaMatch fields', async () => {
            const revokedAt = new Date(Date.now() - (REFRESH_REUSE_GRACE_SECONDS + 5) * 1_000);
            const row = buildTokenRow({ revokedAt, replacedById: 20, userId: 42, familyId: 'theft-family' });
            selectForUpdateMock.mockResolvedValue(row);

            const warnSpy = jest.spyOn(service['logger'], 'warn');

            await expect(service.refresh('old-revoked-token', META)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });

            expect(warnSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    code: 'REFRESH_TOKEN_REUSED',
                    userId: 42,
                    familyId: 'theft-family',
                }),
                expect.any(String),
            );
        });

        it('throws RefreshTokenError with code REFRESH_TOKEN_REUSED (401)', async () => {
            const revokedAt = new Date(Date.now() - (REFRESH_REUSE_GRACE_SECONDS + 5) * 1_000);
            selectForUpdateMock.mockResolvedValue(buildTokenRow({ revokedAt, replacedById: 20 }));

            const error = await service.refresh('old-revoked-token', META).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(RefreshTokenError);
            expect((error as RefreshTokenError).httpStatus).toBe(401);
            expect((error as RefreshTokenError).code).toBe('REFRESH_TOKEN_REUSED');
        });

        it('revokes the family when the grace cache is absent even if within grace window timing (no cache entry = theft)', async () => {
            // Grace window timing within 10s, but graceCache has NO entry for this hash
            // (simulates a different server instance or cache eviction).
            const revokedAt = new Date(Date.now() - 2_000); // 2s ago — within grace
            const row = buildTokenRow({ revokedAt, replacedById: 20 });
            selectForUpdateMock.mockResolvedValue(row);
            // graceCache is empty (fresh service instance, no prior successful refresh)

            await expect(service.refresh('no-cache-token', META)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
            expect(revokeFamilyMock).toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // Reuse-detection — grace path
    // -------------------------------------------------------------------------

    describe('refresh — reuse-detection grace path', () => {
        const setupGraceCache = async (): Promise<{ rawToken: string; successorRaw: string; successorExpiresAt: Date }> => {
            // First refresh: succeed normally to populate the grace cache.
            const rawToken = 'original-raw-token';
            selectForUpdateMock.mockResolvedValue(buildTokenRow({ revokedAt: null }));
            const firstResult = await service.refresh(rawToken, META);
            const successorRaw = firstResult.refreshToken.raw;
            const successorExpiresAt = firstResult.refreshToken.expiresAt;

            return { rawToken, successorRaw, successorExpiresAt };
        };

        it('returns the successor token verbatim (same raw) on retry within grace window with matching UA', async () => {
            const { rawToken, successorRaw, successorExpiresAt } = await setupGraceCache();

            // Now simulate the retry: old token arrives as revoked, revokedAt = just now
            const revokedAt = new Date(Date.now() - 1_000); // 1s ago — within 10s grace
            const rawHash = service.hashToken(rawToken);
            selectForUpdateMock.mockResolvedValue(
                buildTokenRow({ tokenHash: rawHash, revokedAt, replacedById: 99 }),
            );

            const graceResult = await service.refresh(rawToken, META);

            expect(graceResult.refreshToken.raw).toBe(successorRaw);
            expect(graceResult.refreshToken.expiresAt.getTime()).toBe(successorExpiresAt.getTime());
        });

        it('successor expires_at is NOT refreshed (stays the same as the first rotation)', async () => {
            const { rawToken, successorExpiresAt } = await setupGraceCache();

            const revokedAt = new Date(Date.now() - 1_000);
            const rawHash = service.hashToken(rawToken);
            selectForUpdateMock.mockResolvedValue(
                buildTokenRow({ tokenHash: rawHash, revokedAt, replacedById: 99 }),
            );

            const graceResult = await service.refresh(rawToken, META);

            // The expiresAt must equal the original successor's — it was NOT reset.
            expect(graceResult.refreshToken.expiresAt.getTime()).toBe(successorExpiresAt.getTime());
        });

        it('does NOT revoke the family on the grace path', async () => {
            const { rawToken } = await setupGraceCache();

            const revokedAt = new Date(Date.now() - 1_000);
            const rawHash = service.hashToken(rawToken);
            selectForUpdateMock.mockResolvedValue(
                buildTokenRow({ tokenHash: rawHash, revokedAt, replacedById: 99 }),
            );

            await service.refresh(rawToken, META);

            // revokeFamily must NOT have been called during the grace-path call.
            // It may have been called 0 times total (it was not called during the first refresh either).
            const graceCalls = revokeFamilyMock.mock.calls.length;
            expect(graceCalls).toBe(0);
        });

        it('does NOT emit a REFRESH_TOKEN_REUSED warn log on the grace path', async () => {
            const { rawToken } = await setupGraceCache();

            const revokedAt = new Date(Date.now() - 1_000);
            const rawHash = service.hashToken(rawToken);
            selectForUpdateMock.mockResolvedValue(
                buildTokenRow({ tokenHash: rawHash, revokedAt, replacedById: 99 }),
            );

            const warnSpy = jest.spyOn(service['logger'], 'warn');
            await service.refresh(rawToken, META);

            const reuseWarnCalls = (warnSpy.mock.calls as Array<[unknown, ...unknown[]]>).filter(
                (call) => typeof call[0] === 'object' && call[0] !== null && 'code' in (call[0] as Record<string, unknown>) && (call[0] as Record<string, unknown>)['code'] === 'REFRESH_TOKEN_REUSED',
            );
            expect(reuseWarnCalls).toHaveLength(0);
        });

        it('treats mismatched UA within grace window as theft and revokes the family', async () => {
            const { rawToken } = await setupGraceCache();

            const revokedAt = new Date(Date.now() - 1_000);
            const rawHash = service.hashToken(rawToken);
            selectForUpdateMock.mockResolvedValue(
                buildTokenRow({ tokenHash: rawHash, revokedAt, replacedById: 99, userAgent: META.userAgent }),
            );

            // Use a DIFFERENT user-agent — should be treated as theft.
            await expect(service.refresh(rawToken, DIFFERENT_UA_META)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
            expect(revokeFamilyMock).toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // Expired token
    // -------------------------------------------------------------------------

    describe('refresh — expired token', () => {
        it('throws REFRESH_TOKEN_EXPIRED (401) when the token is past expires_at', async () => {
            const expiredRow = buildTokenRow({ expiresAt: new Date(Date.now() - 1_000) });
            selectForUpdateMock.mockResolvedValue(expiredRow);

            const error = await service.refresh('expired-token', META).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(RefreshTokenError);
            expect((error as RefreshTokenError).code).toBe('REFRESH_TOKEN_EXPIRED');
            expect((error as RefreshTokenError).httpStatus).toBe(401);
        });

        it('does NOT call revokeFamily when the token is expired', async () => {
            const expiredRow = buildTokenRow({ expiresAt: new Date(Date.now() - 1_000) });
            selectForUpdateMock.mockResolvedValue(expiredRow);

            await service.refresh('expired-token', META).catch(() => undefined);

            expect(revokeFamilyMock).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // signup vs login — identical token shape
    // -------------------------------------------------------------------------

    describe('signup vs login — refresh token parity', () => {
        const buildHashedPasswordUser = async (): Promise<UserEntity> => {
            const passwordHash = await argon2.hash('password-abc-123', {
                type: argon2.argon2id,
                memoryCost: ARGON2_MEMORY_COST,
                timeCost: ARGON2_TIME_COST,
                parallelism: ARGON2_PARALLELISM,
            });

            return buildUser({ passwordHash });
        };

        it('signup and login both produce a refreshToken with a raw string and a future expiresAt', async () => {
            // Signup path.
            findByEmailMock.mockResolvedValue(null);
            insertUserMock.mockImplementation((input: ICreateUserInput) =>
                Promise.resolve(buildUser({ ...input })),
            );

            const signupResult = await service.signup({ email: 'a@b.test', password: 'password-abc-123' }, META);

            expect(typeof signupResult.refreshToken.raw).toBe('string');
            expect(signupResult.refreshToken.raw.length).toBeGreaterThan(0);
            expect(signupResult.refreshToken.expiresAt).toBeInstanceOf(Date);
            expect(signupResult.refreshToken.expiresAt.getTime()).toBeGreaterThan(Date.now());

            // Login path.
            const hashedUser = await buildHashedPasswordUser();
            findByEmailMock.mockResolvedValue(hashedUser);

            const loginResult = await service.login({ email: 'a@b.test', password: 'password-abc-123' }, META);

            expect(typeof loginResult.refreshToken.raw).toBe('string');
            expect(loginResult.refreshToken.raw.length).toBeGreaterThan(0);
            expect(loginResult.refreshToken.expiresAt).toBeInstanceOf(Date);
            expect(loginResult.refreshToken.expiresAt.getTime()).toBeGreaterThan(Date.now());
        });

        it('signup and login both call insertNew with a 64-char hex token_hash', async () => {
            // Signup.
            findByEmailMock.mockResolvedValue(null);
            insertUserMock.mockImplementation((input: ICreateUserInput) =>
                Promise.resolve(buildUser({ ...input })),
            );
            await service.signup({ email: 'c@d.test', password: 'password-abc-123' }, META);

            const signupInsertArgs = (insertNewMock.mock.calls[0] as [{ tokenHash: string }, unknown])[0];
            expect(signupInsertArgs.tokenHash).toHaveLength(64);
            expect(signupInsertArgs.tokenHash).toMatch(/^[0-9a-f]{64}$/);

            insertNewMock.mockClear();

            // Login.
            const hashedUser = await buildHashedPasswordUser();
            findByEmailMock.mockResolvedValue(hashedUser);
            await service.login({ email: 'c@d.test', password: 'password-abc-123' }, META);

            const loginInsertArgs = (insertNewMock.mock.calls[0] as [{ tokenHash: string }, unknown])[0];
            expect(loginInsertArgs.tokenHash).toHaveLength(64);
            expect(loginInsertArgs.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('signup and login refresh tokens carry a family_id (UUID)', async () => {
            findByEmailMock.mockResolvedValue(null);
            insertUserMock.mockImplementation((input: ICreateUserInput) =>
                Promise.resolve(buildUser({ ...input })),
            );
            await service.signup({ email: 'e@f.test', password: 'password-abc-123' }, META);

            const signupInsertArgs = (insertNewMock.mock.calls[0] as [{ familyId: string }, unknown])[0];
            expect(signupInsertArgs.familyId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            );
        });
    });

    // -------------------------------------------------------------------------
    // UNIQUE constraint: inserting duplicate hash must fail
    // -------------------------------------------------------------------------

    describe('UNIQUE(token_hash) constraint enforcement', () => {
        it('propagates the DB unique-violation error when a duplicate token_hash is inserted', async () => {
            const { QueryFailedError } = await import('typeorm');
            const uniqueError = new QueryFailedError('INSERT', [], { code: '23505' } as unknown as Error);
            insertNewMock.mockRejectedValueOnce(uniqueError);

            findByEmailMock.mockResolvedValue(null);
            insertUserMock.mockImplementation((input: ICreateUserInput) => Promise.resolve(buildUser({ ...input })));

            // The token-insert unique violation must propagate (not be swallowed).
            await expect(service.signup({ email: 'dup@mes.test', password: 'password-abc-123' }, META)).rejects.toThrow();
        });
    });
});
