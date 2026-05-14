import crypto from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';
import type { StringValue } from 'ms';
import { UserRoleEnum } from '@mes/shared';
import type { IJwtPayload } from '@mes/shared';
import { UsersRepository } from '../../users/repository/UsersRepository';
import { UsersService } from '../../users/service/UsersService';
import { UserEntity } from '../../users/entity/UserEntity';
import { RefreshTokensRepository } from '../repository/RefreshTokensRepository';
import { UserEmailTakenError } from '../../common/error/UserEmailTakenError';
import { UnauthorizedError } from '../../common/error/UnauthorizedError';
import { RefreshTokenError } from '../../common/error/RefreshTokenError';
import {
    ARGON2_MEMORY_COST,
    ARGON2_PARALLELISM,
    ARGON2_TIME_COST,
    DEFAULT_JWT_EXPIRES_IN,
    DEFAULT_JWT_EXPIRES_IN_SECONDS,
    DUMMY_HASH_SENTINEL,
    PG_UNIQUE_VIOLATION,
    MS_PER_DAY,
    REFRESH_TOKEN_BYTES,
    REFRESH_TOKEN_TTL_DAYS,
    REFRESH_REUSE_GRACE_SECONDS,
} from '../const/AuthConsts';
import { LoginDto } from '../dto/LoginDto';
import { SignupDto } from '../dto/SignupDto';
import { IAuthTokenResponse } from '../interface/IAuthTokenResponse';
import { IAuthUserProfile } from '../interface/IAuthUserProfile';

export interface IRequestMeta {
    userAgent: string | null;
    ip: string | null;
}

export interface IRefreshTokenPair {
    raw: string;
    expiresAt: Date;
}

export interface ILoginResult {
    accessToken: IAuthTokenResponse;
    refreshToken: IRefreshTokenPair;
}

interface IGraceCacheEntry {
    successorRaw: string;
    successorExpiresAt: Date;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * AuthService — signup, login, JWT issuance, refresh-token rotation, logout.
 *
 * Refresh token lifecycle per ADR 0007:
 *   - `issueRefreshToken`   — generates an opaque 256-bit token, hashes it, inserts a row.
 *   - `refresh`             — transactional SELECT-FOR-UPDATE → validate → rotate → issue new.
 *   - `logout`              — revokes the single token identified by the cookie (not the family).
 *
 * Grace-window cache (`Map<oldTokenHash, IGraceCacheEntry>`):
 *   The successor's raw token is cached in memory for `REFRESH_REUSE_GRACE_SECONDS` so that
 *   a legitimate retry (network dropped the Set-Cookie response) can receive the same successor
 *   rather than triggering theft-path family revocation. Entries are evicted via `setTimeout`.
 *
 * Known scaling limitation: the grace cache is per-process. With multiple backend instances,
 * a retry landing on a different instance will see a cache miss and follow the theft path.
 * Acceptable for this milestone (single-node deploy); a future ADR can introduce a Redis-backed
 * cache if horizontal scaling is needed.
 */
@Injectable()
export class AuthService implements OnModuleInit {
    private readonly logger = new Logger(AuthService.name);
    private readonly jwtExpiresIn: string;

    /**
     * Per-process in-memory grace cache. Key = SHA-256 hex of the OLD (revoked) token.
     * Entries are removed automatically after `REFRESH_REUSE_GRACE_SECONDS * 1000` ms.
     *
     * @see IGraceCacheEntry
     */
    private readonly graceCache = new Map<string, IGraceCacheEntry>();

    /**
     * Pre-computed dummy hash used on the unknown-email path to keep timing constant
     * regardless of whether an email exists. Starts as the compile-time sentinel so
     * `verifyDummy` never throws a format error before `onModuleInit` completes.
     */
    private dummyHash: string = DUMMY_HASH_SENTINEL;

    public constructor(
        private readonly usersRepository: UsersRepository,
        private readonly usersService: UsersService,
        private readonly jwtService: JwtService,
        private readonly refreshTokensRepository: RefreshTokensRepository,
        /**
         * Transactional orchestration is kept at the service level pending convention
         * clarification on cross-aggregate transactions (see deferred item in M10 review).
         * Future ADR amendment may move this into a dedicated TransactionCoordinator or
         * unit-of-work helper inside the repository layer.
         */
        private readonly dataSource: DataSource,
        configService: ConfigService,
    ) {
        this.jwtExpiresIn = configService.get<string>('JWT_EXPIRES_IN') ?? DEFAULT_JWT_EXPIRES_IN;
    }

    public async onModuleInit(): Promise<void> {
        this.dummyHash = await this.hashPassword('__dummy__');
    }

    public async signup(input: SignupDto, meta: IRequestMeta): Promise<ILoginResult> {
        const existing = await this.usersRepository.findByEmail(input.email);

        if (existing) {
            throw new UserEmailTakenError();
        }

        const passwordHash = await this.hashPassword(input.password);
        let user: UserEntity;

        try {
            user = await this.usersRepository.insertUser({
                email: input.email,
                passwordHash,
                role: UserRoleEnum.PARENT,
                firstName: input.firstName ?? null,
                lastName: input.lastName ?? null,
            });
        } catch (error) {
            if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
                throw new UserEmailTakenError();
            }

            throw error;
        }

        this.logger.log(`User signed up: id=${user.userId} role=${user.role}`);

        const accessToken = this.issueToken(user);
        const refreshToken = await this.issueRefreshToken(user.userId, meta);

        return { accessToken, refreshToken };
    }

    public async login(input: LoginDto, meta: IRequestMeta): Promise<ILoginResult> {
        const user = await this.usersRepository.findByEmail(input.email);

        if (!user) {
            // Constant-ish cost: verify against the dummy hash so timing does not reveal absence.
            await this.verifyDummy(input.password);
            throw new UnauthorizedError('AUTH_INVALID_CREDENTIALS');
        }

        const matches = await argon2.verify(user.passwordHash, input.password);

        if (!matches) {
            throw new UnauthorizedError('AUTH_INVALID_CREDENTIALS');
        }

        void this.rehashIfNeeded(user, input.password).catch((err) =>
            this.logger.warn(`Transparent argon2 re-hash scheduling failed for user ${user.userId}: ${(err as Error).message}`),
        );

        const accessToken = this.issueToken(user);
        const refreshToken = await this.issueRefreshToken(user.userId, meta);

        return { accessToken, refreshToken };
    }

    public async getProfile(userId: number): Promise<IAuthUserProfile> {
        const user = await this.usersService.findById(userId);

        if (!user) {
            // The JWT was valid but the user row is gone (deleted between sign + lookup).
            throw new UnauthorizedError('AUTH_INVALID_TOKEN');
        }

        return {
            id: user.userId,
            email: user.email,
            role: user.role,
            firstName: user.firstName ?? null,
            lastName: user.lastName ?? null,
        };
    }

    /**
     * Rotate a refresh token.
     *
     * Happy path (inside a DB transaction):
     *   1. SELECT … FOR UPDATE on the old row.
     *   2. Validate expiry and revocation state.
     *   3. Insert new row (same `family_id`, fresh `expires_at`).
     *   4. Mark old row revoked + `replaced_by_id = newId`.
     *   5. Commit.
     *   6. Cache old→new mapping for the grace window.
     *
     * Returns the new raw refresh token and a fresh access JWT.
     */
    public async refresh(rawToken: string, meta: IRequestMeta): Promise<ILoginResult> {
        const hash = this.hashToken(rawToken);

        interface IRotationResult {
            loginResult: ILoginResult;
            newRaw: string;
            newExpiresAt: Date;
        }

        const outcome = await this.dataSource.transaction(async (manager) => {
            const row = await this.refreshTokensRepository.selectForUpdate(hash, manager);

            if (!row) {
                throw new RefreshTokenError('REFRESH_TOKEN_INVALID');
            }

            const now = new Date();

            if (row.expiresAt <= now) {
                throw new RefreshTokenError('REFRESH_TOKEN_EXPIRED');
            }

            if (row.revokedAt !== null) {
                return this.handleRevokedToken(row, hash, meta, now, manager);
            }

            // Happy path: generate new token, insert, revoke old.
            const newExpiresAt = this.computeExpiresAt(REFRESH_TOKEN_TTL_DAYS);
            const newRaw = this.generateRawToken();
            const newHash = this.hashToken(newRaw);

            const newRow = await this.refreshTokensRepository.insertNew(
                {
                    userId: row.userId,
                    familyId: row.familyId,
                    tokenHash: newHash,
                    expiresAt: newExpiresAt,
                    userAgent: meta.userAgent,
                    ip: meta.ip,
                },
                manager,
            );

            await this.refreshTokensRepository.revokeRow(row.id, newRow.id, manager);

            const user = await this.usersService.findById(row.userId);

            if (!user) {
                // User was deleted mid-rotation. Roll back the issued token by letting
                // the transaction abort, then asynchronously revoke the family so no
                // other active tokens for this deleted user can be replayed.
                void this.refreshTokensRepository.revokeFamily(row.familyId).catch((err) =>
                    this.logger.warn(
                        { code: 'REVOKE_FAMILY_AFTER_DELETED_USER', familyId: row.familyId, reason: (err as Error).message },
                        'Post-abort family revocation failed — tokens may linger until TTL',
                    ),
                );

                throw new RefreshTokenError('REFRESH_TOKEN_INVALID');
            }

            const loginResult: ILoginResult = {
                accessToken: this.issueToken(user),
                refreshToken: { raw: newRaw, expiresAt: newExpiresAt },
            };

            return { loginResult, newRaw, newExpiresAt } satisfies IRotationResult;
        });

        // Grace-window cache is written ONLY after the transaction has committed
        // successfully. Writing inside the callback would poison the cache if a
        // later step throws and the DB rolls back, leaving a stale successor pointer.
        if ('newRaw' in outcome) {
            this.setGraceEntry(hash, outcome.newRaw, outcome.newExpiresAt);

            return outcome.loginResult;
        }

        return outcome;
    }

    /**
     * Revoke the single token identified by the raw cookie value. Idempotent.
     * Does NOT revoke the entire family — two devices log out independently (ADR 0007 §11).
     */
    public async logout(rawToken: string | null | undefined): Promise<void> {
        if (!rawToken) {
            return;
        }

        const hash = this.hashToken(rawToken);
        const row = await this.refreshTokensRepository.findByTokenHash(hash);

        if (!row || row.revokedAt !== null) {
            // Already revoked or never existed — idempotent success.
            return;
        }

        await this.dataSource.transaction(async (manager) => {
            await this.refreshTokensRepository.revokeRowForLogout(row.id, manager);
        });
    }

    // ---------------------------------------------------------------------------
    // Token-issuance helpers
    // ---------------------------------------------------------------------------

    public issueToken(user: UserEntity): IAuthTokenResponse {
        const payload: Pick<IJwtPayload, 'sub' | 'role'> = { sub: user.userId, role: user.role };
        // assertJwtConfig validated the format of jwtExpiresIn against JWT_EXPIRES_IN_REGEX.
        // The single `as` narrows from the wider `string` returned by ConfigService to the
        // branded template-literal union `StringValue` required by jsonwebtoken's sign API.
        const accessToken = this.jwtService.sign(payload, { expiresIn: this.jwtExpiresIn as StringValue });

        return { accessToken, expiresIn: this.toExpiresInSeconds(this.jwtExpiresIn) };
    }

    public async issueRefreshToken(userId: number, meta: IRequestMeta): Promise<IRefreshTokenPair> {
        const raw = this.generateRawToken();
        const hash = this.hashToken(raw);
        const familyId = crypto.randomUUID();
        const expiresAt = this.computeExpiresAt(REFRESH_TOKEN_TTL_DAYS);

        await this.dataSource.transaction(async (manager) => {
            await this.refreshTokensRepository.insertNew(
                {
                    userId,
                    familyId,
                    tokenHash: hash,
                    expiresAt,
                    userAgent: meta.userAgent,
                    ip: meta.ip,
                },
                manager,
            );
        });

        return { raw, expiresAt };
    }

    // ---------------------------------------------------------------------------
    // Revocation helpers
    // ---------------------------------------------------------------------------

    private async handleRevokedToken(
        row: import('../entity/RefreshTokenEntity').RefreshTokenEntity,
        hash: string,
        meta: IRequestMeta,
        now: Date,
        manager: import('typeorm').EntityManager,
    ): Promise<ILoginResult> {
        const graceCached = this.graceCache.get(hash);
        const withinGraceWindow = row.revokedAt !== null && now.getTime() - row.revokedAt.getTime() < REFRESH_REUSE_GRACE_SECONDS * 1_000;
        const uaMatch = row.userAgent === meta.userAgent;

        if (graceCached && withinGraceWindow && uaMatch) {
            // Grace path: return the cached successor verbatim without refreshing its expiry.
            const user = await this.usersService.findById(row.userId);

            if (!user) {
                throw new UnauthorizedError('AUTH_INVALID_TOKEN');
            }

            return {
                accessToken: this.issueToken(user),
                refreshToken: {
                    raw: graceCached.successorRaw,
                    expiresAt: graceCached.successorExpiresAt,
                },
            };
        }

        // Theft path: revoke the entire family.
        // Note: concurrent rotation of two tokens in the same family could theoretically
        // deadlock here (each holds a FOR UPDATE on its own row while waiting to acquire
        // the other). Not observed in practice at current scale; deferred per M10 review.
        await this.refreshTokensRepository.revokeFamily(row.familyId, manager);

        const ipPrefix = this.maskIp(meta.ip);

        this.logger.warn(
            {
                code: 'REFRESH_TOKEN_REUSED',
                userId: row.userId,
                familyId: row.familyId,
                ipPrefix,
                uaMatch,
            },
            'Refresh token reuse detected — family revoked',
        );

        throw new RefreshTokenError('REFRESH_TOKEN_REUSED');
    }

    // ---------------------------------------------------------------------------
    // Crypto utilities
    // ---------------------------------------------------------------------------

    /** Generate a cryptographically random opaque token. */
    private generateRawToken(): string {
        return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    }

    /** SHA-256 hex of the raw token. Deterministic, never reversed. */
    public hashToken(raw: string): string {
        return crypto.createHash('sha256').update(raw).digest('hex');
    }

    private computeExpiresAt(days: number): Date {
        const ms = Date.now() + days * MS_PER_DAY;

        return new Date(ms);
    }

    // ---------------------------------------------------------------------------
    // Grace-cache management
    // ---------------------------------------------------------------------------

    private setGraceEntry(oldHash: string, successorRaw: string, successorExpiresAt: Date): void {
        const existing = this.graceCache.get(oldHash);

        if (existing) {
            clearTimeout(existing.timer);
        }

        const timer = setTimeout(() => {
            this.graceCache.delete(oldHash);
        }, REFRESH_REUSE_GRACE_SECONDS * 1_000);

        this.graceCache.set(oldHash, { successorRaw, successorExpiresAt, timer });
    }

    // ---------------------------------------------------------------------------
    // IP masking for security logs
    // ---------------------------------------------------------------------------

    /**
     * Return a /24 (IPv4) or /64 (IPv6) prefix suitable for correlation logs.
     * Avoids logging the full IP at the warn level while still helping forensics.
     */
    private maskIp(ip: string | null): string {
        if (!ip) {
            return 'unknown';
        }

        if (ip.includes(':')) {
            // IPv6 — keep first four groups (/64 equivalent).
            const groups = ip.split(':');

            return groups.slice(0, 4).join(':') + '::/64';
        }

        // IPv4 — mask last octet (/24).
        const octets = ip.split('.');

        if (octets.length !== 4) {
            return 'unknown';
        }

        return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
    }

    // ---------------------------------------------------------------------------
    // Password helpers (unchanged from M03)
    // ---------------------------------------------------------------------------

    private async hashPassword(plain: string): Promise<string> {
        return argon2.hash(plain, {
            type: argon2.argon2id,
            memoryCost: ARGON2_MEMORY_COST,
            timeCost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
        });
    }

    private async verifyDummy(plain: string): Promise<void> {
        try {
            await argon2.verify(this.dummyHash, plain);
        } catch (error) {
            this.logger.warn({ code: 'ARGON2_DUMMY_VERIFY_FAILED', reason: (error as Error).message }, 'Argon2 dummy verify threw unexpectedly');
        }
    }

    private async rehashIfNeeded(user: UserEntity, plain: string): Promise<void> {
        const needsRehash = argon2.needsRehash(user.passwordHash, {
            memoryCost: ARGON2_MEMORY_COST,
            timeCost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
        });

        if (!needsRehash) {
            return;
        }

        try {
            const fresh = await this.hashPassword(plain);
            await this.usersService.updatePasswordHash(user.userId, fresh);
        } catch (error) {
            // Re-hash is best-effort; the login itself already succeeded.
            this.logger.warn(`Transparent argon2 re-hash failed for user ${user.userId}: ${(error as Error).message}`);
        }
    }

    private toExpiresInSeconds(expiresIn: string): number {
        // Accept '15m', '900s', '1h', '1d'.
        const match = /^(\d+)([smhd])$/.exec(expiresIn.trim());

        if (!match) {
            return DEFAULT_JWT_EXPIRES_IN_SECONDS;
        }

        const value = Number(match[1]);
        const unit = match[2];
        const unitToSeconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
        const seconds = value * unitToSeconds[unit];

        return seconds;
    }
}

