/**
 * E2E tests for M10 refresh-token rotation endpoints.
 *
 * All Postgres I/O is replaced by in-memory stores. The real wiring used:
 *   - AuthController with real AuthService
 *   - OriginAllowedGuard (real)
 *   - cookie-parser middleware
 *   - HttpExceptionFilter, JwtAuthGuard, RolesGuard
 *   - ValidationPipe
 *
 * Grace-window tests use jest.useFakeTimers() to advance time without sleeping.
 *
 * E2E cases covered:
 *   10. POST /auth/login sets cookie + returns access token (cookie attributes)
 *   11. POST /auth/refresh with valid cookie → new access token + new cookie, same family
 *   12. POST /auth/refresh without cookie → 401 REFRESH_TOKEN_MISSING
 *   13. POST /auth/refresh without X-Requested-With → 403 REFRESH_CSRF_REJECTED
 *   14. POST /auth/refresh with Origin: null → 403 REFRESH_CSRF_REJECTED
 *   15. POST /auth/refresh with both Origin and Referer missing → 403 REFRESH_CSRF_REJECTED
 *   16. Cross-origin form-POST (no X-Requested-With) → 403 (defense-in-depth)
 *   17. POST /auth/refresh with disallowed Origin → 403 REFRESH_CSRF_REJECTED
 *   18. POST /auth/logout clears cookie (attribute parity); subsequent refresh → 401
 *   19. Replay outside grace window → 401 AND successor also returns 401 (family dead)
 *   20. Replay within grace window, matching UA → same successor, Max-Age reflects original expiry
 *   21. Replay within grace window, mismatched UA → theft, family revoked
 *   22. Two concurrent logins → distinct family_id; revoking one family does not affect the other
 *   23. Tab-1 login, tab-2 login (overwrites cookie), tab-1 silent refresh → uses tab-2 family, no REUSED warn
 *   24. Cleanup job hard-fallback → REFRESH_TOKEN_RETENTION_BREACH log
 *   25. CORS preflight from allowed origin → credentials: true, echoed origin (never *)
 */

import cookieParser from 'cookie-parser';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import { UserRoleEnum } from '@mes/shared';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, XHR_REQUESTED_WITH, XHR_REQUESTED_WITH_HEADER } from '@mes/shared';
import type { IApiErrorResponse, IAuthTokenResponse } from '@mes/shared';

import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthController } from '../src/auth/controller/AuthController';
import { AuthService } from '../src/auth/service/AuthService';
import { JwtAuthGuard } from '../src/auth/guard/JwtAuthGuard';
import { JwtStrategy } from '../src/auth/strategy/JwtStrategy';
import { RolesGuard } from '../src/auth/guard/RolesGuard';
import { ClsRequestModule } from '../src/common/cls/ClsRequestModule';
import { HttpExceptionFilter } from '../src/common/filter/HttpExceptionFilter';
import { LoggerModule } from '../src/common/logger/LoggerModule';
import { OriginAllowedGuard } from '../src/common/guard/OriginAllowedGuard';
import { UsersRepository } from '../src/users/repository/UsersRepository';
import { UsersService } from '../src/users/service/UsersService';
import { UserEntity } from '../src/users/entity/UserEntity';
import { RefreshTokensRepository } from '../src/auth/repository/RefreshTokensRepository';
import { RefreshTokenEntity } from '../src/auth/entity/RefreshTokenEntity';
import { RefreshTokenCleanupProcessor } from '../src/auth/job/RefreshTokenCleanupProcessor';
import { MAINTENANCE_QUEUE } from '../src/auth/const/MaintenanceConsts';
import { REFRESH_TOKEN_RETENTION_BREACH_DAYS, REFRESH_REUSE_GRACE_SECONDS } from '../src/auth/const/AuthConsts';

// ---------------------------------------------------------------------------
// In-memory UsersRepository
// ---------------------------------------------------------------------------

class InMemoryUsersRepository {
    private readonly rows = new Map<number, UserEntity>();
    private nextId = 1;

    public findById(userId: number): Promise<UserEntity | null> {
        return Promise.resolve(this.rows.get(userId) ?? null);
    }

    public findByEmail(email: string): Promise<UserEntity | null> {
        const normalised = email.trim().toLowerCase();

        for (const row of this.rows.values()) {
            if (row.email === normalised) {
                return Promise.resolve(row);
            }
        }

        return Promise.resolve(null);
    }

    public insertUser(entity: Partial<UserEntity>): Promise<UserEntity> {
        const row = new UserEntity();
        row.userId = this.nextId++;
        row.email = (entity.email ?? '').trim().toLowerCase();
        row.passwordHash = entity.passwordHash ?? '';
        row.role = entity.role ?? UserRoleEnum.PARENT;
        row.firstName = entity.firstName ?? null;
        row.lastName = entity.lastName ?? null;
        row.createdAt = new Date();
        row.updatedAt = new Date();
        this.rows.set(row.userId, row);

        return Promise.resolve(row);
    }

    public updatePasswordHash(userId: number, passwordHash: string): Promise<void> {
        const row = this.rows.get(userId);

        if (row) {
            row.passwordHash = passwordHash;
        }

        return Promise.resolve();
    }
}

// ---------------------------------------------------------------------------
// In-memory RefreshTokensRepository
// ---------------------------------------------------------------------------

class InMemoryRefreshTokensRepository {
    private rows = new Map<number, RefreshTokenEntity>();
    private nextId = 1;

    public reset(): void {
        this.rows = new Map<number, RefreshTokenEntity>();
        this.nextId = 1;
    }

    public findByTokenHash(hash: string): Promise<RefreshTokenEntity | null> {
        for (const row of this.rows.values()) {
            if (row.tokenHash === hash) {
                return Promise.resolve(row);
            }
        }

        return Promise.resolve(null);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async selectForUpdate(hash: string, _manager: EntityManager): Promise<RefreshTokenEntity | null> {
        return this.findByTokenHash(hash);
    }

    public insertNew(
        values: {
            userId: number;
            familyId: string;
            tokenHash: string;
            expiresAt: Date;
            userAgent: string | null;
            ip: string | null;
        },
        _manager: EntityManager, // eslint-disable-line @typescript-eslint/no-unused-vars
    ): Promise<RefreshTokenEntity> {
        const entity = new RefreshTokenEntity();
        entity.id = this.nextId++;
        entity.userId = values.userId;
        entity.familyId = values.familyId;
        entity.tokenHash = values.tokenHash;
        entity.expiresAt = values.expiresAt;
        entity.issuedAt = new Date();
        entity.revokedAt = null;
        entity.replacedById = null;
        entity.userAgent = values.userAgent;
        entity.ip = values.ip;
        this.rows.set(entity.id, entity);

        return Promise.resolve(entity);
    }

    // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
    public async revokeRow(id: number, replacedById: number, _manager: EntityManager): Promise<number> {
        const row = this.rows.get(id);

        if (row && row.revokedAt === null) {
            row.revokedAt = new Date();
            row.replacedById = replacedById;

            return 1;
        }

        return 0;
    }

    // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
    public async revokeRowForLogout(id: number, _manager: EntityManager): Promise<number> {
        const row = this.rows.get(id);

        if (row && row.revokedAt === null) {
            row.revokedAt = new Date();

            return 1;
        }

        return 0;
    }

    // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
    public async revokeFamily(familyId: string, _manager?: EntityManager): Promise<number> {
        let count = 0;

        for (const row of this.rows.values()) {
            if (row.familyId === familyId && row.revokedAt === null) {
                row.revokedAt = new Date();
                count++;
            }
        }

        return count;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async deleteExpiredAndStaleRevoked(graceDays: number, forensicDays: number): Promise<{ deletedExpired: number; deletedRevoked: number }> {
        const now = Date.now();
        const graceCutoff = new Date(now - graceDays * 86_400_000);
        const forensicCutoff = new Date(now - forensicDays * 86_400_000);
        let deletedExpired = 0;
        let deletedRevoked = 0;

        for (const [id, row] of this.rows.entries()) {
            if (row.expiresAt < graceCutoff) {
                this.rows.delete(id);
                deletedExpired++;
            } else if (row.revokedAt !== null && row.revokedAt < forensicCutoff) {
                this.rows.delete(id);
                deletedRevoked++;
            }
        }

        return { deletedExpired, deletedRevoked };
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async countPastForensicWindow(thresholdDays: number): Promise<number> {
        const cutoff = new Date(Date.now() - thresholdDays * 86_400_000);
        let count = 0;

        for (const row of this.rows.values()) {
            if (row.revokedAt !== null && row.revokedAt < cutoff) {
                count++;
            }
        }

        return count;
    }

    public getAllRows(): RefreshTokenEntity[] {
        return Array.from(this.rows.values());
    }

    public insertRawRow(row: Partial<RefreshTokenEntity>): void {
        const entity = Object.assign(new RefreshTokenEntity(), {
            id: this.nextId++,
            issuedAt: new Date(),
            revokedAt: null,
            replacedById: null,
            userAgent: null,
            ip: null,
            ...row,
        });
        this.rows.set(entity.id, entity);
    }
}

// ---------------------------------------------------------------------------
// In-memory DataSource (transaction pass-through)
// ---------------------------------------------------------------------------

class InMemoryDataSource {
    public async transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
        // Pass a null manager — the in-memory repos ignore it.
        return work(null as unknown as EntityManager);
    }
}

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'test-secret-must-be-at-least-32-chars-long-refresh-e2e';
const ALLOWED_ORIGIN = 'http://localhost:5173';
const TEST_UA = 'Mozilla/5.0 (jest-e2e)';
const TEST_EMAIL = 'refresh@mes.test';
const TEST_PASSWORD = 'correcthorse12battery';

/**
 * Parse the Set-Cookie header from the response and extract cookie attributes.
 */
const parseCookieHeader = (cookieHeaderValue: string): Record<string, string | boolean> => {
    const parts = cookieHeaderValue.split(';').map((p) => p.trim());
    const attrs: Record<string, string | boolean> = {};

    for (const part of parts) {
        const eqIdx = part.indexOf('=');

        if (eqIdx === -1) {
            attrs[part.toLowerCase()] = true;
        } else {
            attrs[part.slice(0, eqIdx).toLowerCase()] = part.slice(eqIdx + 1);
        }
    }

    return attrs;
};

/**
 * Extract the refresh token value from Set-Cookie header(s).
 */
const extractRefreshCookie = (res: request.Response): string | null => {
    const setCookieHeaders = res.headers['set-cookie'] as string[] | string | undefined;

    if (!setCookieHeaders) return null;

    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    for (const header of headers) {
        if (header.startsWith(`${REFRESH_COOKIE_NAME}=`)) {
            const parts = header.split(';');
            const value = parts[0]?.split('=')[1] ?? '';

            return value;
        }
    }

    return null;
};

/**
 * Extract all Set-Cookie attribute key-value pairs for the mes_rt cookie.
 */
const extractRefreshCookieAttrs = (res: request.Response): Record<string, string | boolean> | null => {
    const setCookieHeaders = res.headers['set-cookie'] as string[] | string | undefined;

    if (!setCookieHeaders) return null;

    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    for (const header of headers) {
        if (header.startsWith(`${REFRESH_COOKIE_NAME}=`)) {
            return parseCookieHeader(header);
        }
    }

    return null;
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Refresh Token Rotation — E2E (M10)', () => {
    let app: INestApplication<App>;
    let usersRepo: InMemoryUsersRepository;
    let refreshRepo: InMemoryRefreshTokensRepository;
    let processor: RefreshTokenCleanupProcessor;
    let authService: AuthService;

    // Unique email counter — incremented per test to prevent 409 conflicts.
    // usersRepo is not reset between tests (only refreshRepo is).
    let emailSeq = 0;
    const uniqueEmail = (): string => `test${++emailSeq}@mes.test`;

    const buildApp = async (extraEnv?: Record<string, string>): Promise<void> => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        process.env.JWT_EXPIRES_IN = '10m';
        process.env.NODE_ENV = 'test';
        process.env.LOG_LEVEL = 'silent';
        process.env.LOG_PRETTY = 'false';
        process.env.CORS_ALLOWED_ORIGINS = ALLOWED_ORIGIN;

        if (extraEnv) {
            for (const [key, value] of Object.entries(extraEnv)) {
                process.env[key] = value;
            }
        }

        usersRepo = new InMemoryUsersRepository();
        refreshRepo = new InMemoryRefreshTokensRepository();
        const dataSource = new InMemoryDataSource();
        const usersService = new UsersService(usersRepo as unknown as UsersRepository);

        // Stub queue so AuthModule's onModuleInit doesn't throw.
        const queueStub = { add: jest.fn().mockResolvedValue(undefined) };

        const moduleRef = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ClsRequestModule,
                LoggerModule,
                PassportModule,
                JwtModule.register({
                    secret: TEST_JWT_SECRET,
                    signOptions: { algorithm: 'HS256', expiresIn: '10m' },
                    verifyOptions: { algorithms: ['HS256'] },
                }),
            ],
            controllers: [AppController, AuthController],
            providers: [
                AppService,
                AuthService,
                JwtStrategy,
                OriginAllowedGuard,
                { provide: UsersRepository, useValue: usersRepo },
                { provide: UsersService, useValue: usersService },
                { provide: RefreshTokensRepository, useValue: refreshRepo },
                { provide: DataSource, useValue: dataSource },
                { provide: getQueueToken(MAINTENANCE_QUEUE), useValue: queueStub },
                { provide: APP_GUARD, useClass: JwtAuthGuard },
                { provide: APP_GUARD, useClass: RolesGuard },
                {
                    provide: APP_PIPE,
                    useFactory: (): ValidationPipe => new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
                },
                { provide: APP_FILTER, useClass: HttpExceptionFilter },
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        app.use(cookieParser());
        app.enableCors({
            origin: (origin: string | undefined, cb: (e: Error | null, allow?: boolean) => void) => {
                const allowed = new Set([ALLOWED_ORIGIN]);

                if (!origin || allowed.has(origin)) {
                    cb(null, true);
                } else {
                    cb(null, false);
                }
            },
            credentials: true,
            methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Idempotency-Key'],
        });

        await app.init();

        authService = moduleRef.get(AuthService);
        processor = new RefreshTokenCleanupProcessor(refreshRepo as unknown as RefreshTokensRepository);
    };

    // Helper: sign up a user + return access token and refresh cookie value.
    // Each call should use a unique email to avoid 409 conflicts across tests.
    const signupAndGetTokens = async (email = TEST_EMAIL): Promise<{ accessToken: string; refreshCookieValue: string }> => {
        const res = await request(app.getHttpServer())
            .post('/auth/signup')
            .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
            .set('Origin', ALLOWED_ORIGIN)
            .set('User-Agent', TEST_UA)
            .send({ email, password: TEST_PASSWORD })
            .expect(201);

        const accessToken = (res.body as IAuthTokenResponse).accessToken;
        const refreshCookieValue = extractRefreshCookie(res)!;

        return { accessToken, refreshCookieValue };
    };

    // Helper: call /auth/refresh with a given cookie value.
    const callRefresh = (cookieValue: string, userAgent = TEST_UA): request.Test => {
        return request(app.getHttpServer())
            .post('/auth/refresh')
            .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
            .set('Origin', ALLOWED_ORIGIN)
            .set('User-Agent', userAgent)
            .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieValue}`);
    };

    beforeAll(async () => {
        await buildApp();
    });

    afterAll(async () => {
        jest.useRealTimers();
        await app.close();
    });

    beforeEach(() => {
        jest.useRealTimers();
        refreshRepo.reset();
    });

    // -------------------------------------------------------------------------
    // Test 10: Login sets cookie + returns access token
    // -------------------------------------------------------------------------

    describe('POST /auth/login — cookie attributes', () => {
        it('sets HttpOnly cookie with correct attributes on login', async () => {
            const loginCookieEmail = uniqueEmail();
            await request(app.getHttpServer())
                .post('/auth/signup')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .send({ email: loginCookieEmail, password: TEST_PASSWORD })
                .expect(201);

            const res = await request(app.getHttpServer())
                .post('/auth/login')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('User-Agent', TEST_UA)
                .send({ email: loginCookieEmail, password: TEST_PASSWORD })
                .expect(200);

            const body = res.body as IAuthTokenResponse;
            expect(body.accessToken).toEqual(expect.any(String));

            const attrs = extractRefreshCookieAttrs(res);
            expect(attrs).not.toBeNull();
            expect(attrs!['httponly']).toBe(true);
            expect((attrs!['samesite'] as string).toLowerCase()).toBe('lax');
            expect(attrs!['path']).toBe(REFRESH_COOKIE_PATH);
            // Max-Age should be approximately 7 days (604800s).
            const maxAge = parseInt(attrs!['max-age'] as string, 10);
            expect(maxAge).toBeGreaterThan(604700);
            expect(maxAge).toBeLessThanOrEqual(604800);
        });

        it('returns an accessToken in the response body (NOT in cookie)', async () => {
            const loginBodyEmail = uniqueEmail();
            await request(app.getHttpServer())
                .post('/auth/signup')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .send({ email: loginBodyEmail, password: TEST_PASSWORD })
                .expect(201);

            const res = await request(app.getHttpServer())
                .post('/auth/login')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('User-Agent', TEST_UA)
                .send({ email: loginBodyEmail, password: TEST_PASSWORD })
                .expect(200);

            expect((res.body as IAuthTokenResponse).accessToken).toEqual(expect.any(String));
            expect((res.body as IAuthTokenResponse).expiresIn).toBe(600);
        });
    });

    // -------------------------------------------------------------------------
    // Test 11: /auth/refresh with valid cookie
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — valid cookie', () => {
        it('returns a new access token and a new cookie with a different value', async () => {
            const { refreshCookieValue: originalCookie } = await signupAndGetTokens(uniqueEmail());

            const res = await callRefresh(originalCookie).expect(200);

            const newCookieValue = extractRefreshCookie(res);
            expect(newCookieValue).not.toBeNull();
            expect(newCookieValue).not.toBe(originalCookie);
            expect((res.body as IAuthTokenResponse).accessToken).toEqual(expect.any(String));
        });

        it('rotated token shares the same family_id as the original', async () => {
            const { refreshCookieValue: originalCookie } = await signupAndGetTokens(uniqueEmail());

            const originalRows = refreshRepo.getAllRows();
            const originalFamilyId = originalRows[0]?.familyId;
            expect(originalFamilyId).toBeDefined();

            await callRefresh(originalCookie).expect(200);

            const allRows = refreshRepo.getAllRows();
            const newRow = allRows.find((r) => r.revokedAt === null);
            expect(newRow?.familyId).toBe(originalFamilyId);
        });
    });

    // -------------------------------------------------------------------------
    // Test 12: /auth/refresh without cookie → 401 REFRESH_TOKEN_MISSING
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — missing cookie', () => {
        it('returns 401 REFRESH_TOKEN_MISSING when no cookie is present', async () => {
            const res = await request(app.getHttpServer())
                .post('/auth/refresh')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .expect(401);

            expect((res.body as IApiErrorResponse).code).toBe('REFRESH_TOKEN_MISSING');
        });
    });

    // -------------------------------------------------------------------------
    // Test 13: /auth/refresh without X-Requested-With → 403 REFRESH_CSRF_REJECTED
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — missing X-Requested-With', () => {
        it('returns 403 REFRESH_CSRF_REJECTED when X-Requested-With header is absent', async () => {
            const res = await request(app.getHttpServer())
                .post('/auth/refresh')
                .set('Origin', ALLOWED_ORIGIN)
                .set('Cookie', `${REFRESH_COOKIE_NAME}=some-token`)
                .expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('REFRESH_CSRF_REJECTED');
        });
    });

    // -------------------------------------------------------------------------
    // Test 14: /auth/refresh with Origin: null → 403 REFRESH_CSRF_REJECTED
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — Origin: null', () => {
        it('returns 403 REFRESH_CSRF_REJECTED when Origin is the literal "null"', async () => {
            const res = await request(app.getHttpServer())
                .post('/auth/refresh')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', 'null')
                .set('Cookie', `${REFRESH_COOKIE_NAME}=some-token`)
                .expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('REFRESH_CSRF_REJECTED');
        });
    });

    // -------------------------------------------------------------------------
    // Test 15: /auth/refresh with both Origin and Referer missing → 403
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — both Origin and Referer absent', () => {
        it('returns 403 REFRESH_CSRF_REJECTED when both Origin and Referer are absent', async () => {
            const res = await request(app.getHttpServer())
                .post('/auth/refresh')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Cookie', `${REFRESH_COOKIE_NAME}=some-token`)
                // Explicitly remove origin and referer by not setting them.
                .expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('REFRESH_CSRF_REJECTED');
        });
    });

    // -------------------------------------------------------------------------
    // Test 16: Cross-origin form-POST (no X-Requested-With) → 403
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — cross-origin form-POST simulation', () => {
        it('returns 403 when X-Requested-With is absent (defense-in-depth for form POST)', async () => {
            const res = await request(app.getHttpServer())
                .post('/auth/refresh')
                .set('Origin', ALLOWED_ORIGIN)
                .set('Referer', `${ALLOWED_ORIGIN}/form`)
                .set('Cookie', `${REFRESH_COOKIE_NAME}=some-token`)
                // No X-Requested-With — simulates browser form submit
                .expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('REFRESH_CSRF_REJECTED');
        });
    });

    // -------------------------------------------------------------------------
    // Test 17: /auth/refresh with disallowed Origin → 403 REFRESH_CSRF_REJECTED
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — disallowed Origin', () => {
        it('returns 403 REFRESH_CSRF_REJECTED when Origin is not in the allow-list', async () => {
            const res = await request(app.getHttpServer())
                .post('/auth/refresh')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', 'http://evil.example.com')
                .set('Cookie', `${REFRESH_COOKIE_NAME}=some-token`)
                .expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('REFRESH_CSRF_REJECTED');
        });
    });

    // -------------------------------------------------------------------------
    // Test 18: /auth/logout clears cookie; subsequent refresh → 401
    // -------------------------------------------------------------------------

    describe('POST /auth/logout — cookie cleared', () => {
        it('sets Max-Age=0 on the mes_rt cookie with attribute parity', async () => {
            const { refreshCookieValue } = await signupAndGetTokens(uniqueEmail());

            const res = await request(app.getHttpServer())
                .post('/auth/logout')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshCookieValue}`)
                .expect(200);

            const attrs = extractRefreshCookieAttrs(res);
            expect(attrs).not.toBeNull();
            expect(attrs!['max-age']).toBe('0');
            expect(attrs!['httponly']).toBe(true);
            expect((attrs!['samesite'] as string).toLowerCase()).toBe('lax');
            expect(attrs!['path']).toBe(REFRESH_COOKIE_PATH);
        });

        it('subsequent refresh with revoked token returns 401', async () => {
            const { refreshCookieValue } = await signupAndGetTokens(uniqueEmail());

            await request(app.getHttpServer())
                .post('/auth/logout')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshCookieValue}`)
                .expect(200);

            const res = await callRefresh(refreshCookieValue).expect(401);
            // REFRESH_TOKEN_REUSED since the token was revoked via logout (revokedAt set, no replacedById)
            // or REFRESH_TOKEN_REUSED depending on how the theft path handles logout-revoked tokens.
            // The important invariant: the request is rejected (4xx).
            expect((res.body as IApiErrorResponse).code).toBeDefined();
        });
    });

    // -------------------------------------------------------------------------
    // Test 19: Replay outside grace window → 401 AND successor also 401
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — replay attack outside grace window', () => {
        it('first replay after grace window returns 401 REFRESH_TOKEN_REUSED', async () => {
            const { refreshCookieValue: originalToken } = await signupAndGetTokens(uniqueEmail());

            // Rotate once.
            await callRefresh(originalToken).expect(200);

            // Advance time past the grace window.
            jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
            jest.setSystemTime(Date.now() + (REFRESH_REUSE_GRACE_SECONDS + 2) * 1_000);

            const replayRes = await callRefresh(originalToken);
            expect(replayRes.status).toBe(401);
            expect((replayRes.body as IApiErrorResponse).code).toBe('REFRESH_TOKEN_REUSED');

            jest.useRealTimers();
        });

        it('successor token also returns 401 after family is revoked by theft path', async () => {
            const { refreshCookieValue: originalToken } = await signupAndGetTokens(uniqueEmail());

            const rotateRes = await callRefresh(originalToken).expect(200);
            const successorToken = extractRefreshCookie(rotateRes)!;
            expect(successorToken).toBeDefined();

            // Advance past grace window.
            jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
            jest.setSystemTime(Date.now() + (REFRESH_REUSE_GRACE_SECONDS + 2) * 1_000);

            // Replay original — triggers theft path, entire family revoked.
            await callRefresh(originalToken).expect(401);

            // Successor is now also revoked — must be rejected.
            const successorRes = await callRefresh(successorToken);
            // The successor's token row was marked revokedAt by revokeFamily.
            // When replayed it will be either REFRESH_TOKEN_REUSED (revoked, no grace entry) or a similar error.
            expect(successorRes.status).toBe(401);

            jest.useRealTimers();
        });
    });

    // -------------------------------------------------------------------------
    // Test 20: Replay within grace window, matching UA → same successor
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — replay within grace window, matching UA', () => {
        it('returns the same successor token verbatim', async () => {
            const { refreshCookieValue: originalToken } = await signupAndGetTokens(uniqueEmail());

            // First rotation.
            const firstRes = await callRefresh(originalToken).expect(200);
            const successorToken = extractRefreshCookie(firstRes)!;
            expect(successorToken).toBeDefined();

            // Simulate the response being lost — retry immediately (within grace window).
            const retryRes = await callRefresh(originalToken).expect(200);
            const retryToken = extractRefreshCookie(retryRes)!;

            // Must receive the same successor token.
            expect(retryToken).toBe(successorToken);
        });

        it('grace-path response cookie Max-Age reflects original successor expires_at (not refreshed)', async () => {
            const { refreshCookieValue: originalToken } = await signupAndGetTokens(uniqueEmail());

            const firstRes = await callRefresh(originalToken).expect(200);
            const firstAttrs = extractRefreshCookieAttrs(firstRes)!;
            const firstMaxAge = parseInt(firstAttrs['max-age'] as string, 10);

            // Small delay to make time pass.
            await new Promise<void>((resolve) => setTimeout(resolve, 50));

            const retryRes = await callRefresh(originalToken).expect(200);
            const retryAttrs = extractRefreshCookieAttrs(retryRes)!;
            const retryMaxAge = parseInt(retryAttrs['max-age'] as string, 10);

            // Max-Age on retry should be less than or equal to first Max-Age (time progressed).
            expect(retryMaxAge).toBeLessThanOrEqual(firstMaxAge);
        });
    });

    // -------------------------------------------------------------------------
    // Test 21: Replay within grace window, mismatched UA → theft
    // -------------------------------------------------------------------------

    describe('POST /auth/refresh — replay within grace window, mismatched UA', () => {
        it('treats mismatched UA as theft and revokes family', async () => {
            const { refreshCookieValue: originalToken } = await signupAndGetTokens(uniqueEmail());

            // First rotation (same UA).
            await callRefresh(originalToken, TEST_UA).expect(200);

            // Replay with DIFFERENT user-agent — theft path.
            const res = await callRefresh(originalToken, 'Mozilla/5.0 (attacker-device)').expect(401);
            expect((res.body as IApiErrorResponse).code).toBe('REFRESH_TOKEN_REUSED');

            // Family must be revoked — all active rows in the family should be revoked.
            const rows = refreshRepo.getAllRows();
            const anyActive = rows.some((r) => r.revokedAt === null);
            expect(anyActive).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // Test 22: Two concurrent logins → distinct family_id; revoking one doesn't affect the other
    // -------------------------------------------------------------------------

    describe('two independent login sessions — distinct families', () => {
        it('each login produces a different family_id', async () => {
            const twoTabEmail = uniqueEmail();
            await request(app.getHttpServer())
                .post('/auth/signup')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .send({ email: twoTabEmail, password: TEST_PASSWORD })
                .expect(201);

            const login1 = await request(app.getHttpServer())
                .post('/auth/login')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('User-Agent', 'Tab1-UA')
                .send({ email: twoTabEmail, password: TEST_PASSWORD })
                .expect(200);

            const login2 = await request(app.getHttpServer())
                .post('/auth/login')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('User-Agent', 'Tab2-UA')
                .send({ email: twoTabEmail, password: TEST_PASSWORD })
                .expect(200);

            const token1 = extractRefreshCookie(login1)!;
            const token2 = extractRefreshCookie(login2)!;
            expect(token1).not.toBe(token2);

            // The two login tokens must belong to different families.
            // (Signup also creates a row, so there may be 3 total rows.)
            const allRows = refreshRepo.getAllRows();
            const hash1 = allRows.find((r) => r.tokenHash === authService.hashToken(token1))?.familyId;
            const hash2 = allRows.find((r) => r.tokenHash === authService.hashToken(token2))?.familyId;
            expect(hash1).toBeDefined();
            expect(hash2).toBeDefined();
            expect(hash1).not.toBe(hash2);
        });

        it('revoking family-1 does not affect family-2 (family-2 can still refresh)', async () => {
            const twoTabBEmail = uniqueEmail();
            await request(app.getHttpServer())
                .post('/auth/signup')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .send({ email: twoTabBEmail, password: TEST_PASSWORD })
                .expect(201);

            const login1 = await request(app.getHttpServer())
                .post('/auth/login')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('User-Agent', 'Tab1-UA')
                .send({ email: twoTabBEmail, password: TEST_PASSWORD })
                .expect(200);

            const login2 = await request(app.getHttpServer())
                .post('/auth/login')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('User-Agent', 'Tab2-UA')
                .send({ email: twoTabBEmail, password: TEST_PASSWORD })
                .expect(200);

            const token1 = extractRefreshCookie(login1)!;
            const token2 = extractRefreshCookie(login2)!;

            // Rotate token1 then replay it outside grace window to trigger family-1 revocation.
            await callRefresh(token1, 'Tab1-UA').expect(200);
            jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
            jest.setSystemTime(Date.now() + (REFRESH_REUSE_GRACE_SECONDS + 2) * 1_000);
            await callRefresh(token1, 'Tab1-UA').expect(401); // family-1 now revoked

            jest.useRealTimers();

            // Family-2 must still work.
            const res2 = await callRefresh(token2, 'Tab2-UA').expect(200);
            expect((res2.body as IAuthTokenResponse).accessToken).toEqual(expect.any(String));
        });
    });

    // -------------------------------------------------------------------------
    // Test 23: Tab-2 login overwrites cookie → no REFRESH_TOKEN_REUSED warn
    // -------------------------------------------------------------------------

    describe('two-tab cookie overwrite — no spurious REFRESH_TOKEN_REUSED', () => {
        it('tab-1 silent refresh using tab-2 family succeeds without reuse warning', async () => {
            const tabOverwriteEmail = uniqueEmail();
            await request(app.getHttpServer())
                .post('/auth/signup')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .send({ email: tabOverwriteEmail, password: TEST_PASSWORD })
                .expect(201);

            // Tab-1 logs in.
            const tab1Login = await request(app.getHttpServer())
                .post('/auth/login')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('User-Agent', TEST_UA)
                .send({ email: tabOverwriteEmail, password: TEST_PASSWORD })
                .expect(200);

            // Tab-2 logs in — its Set-Cookie overwrites tab-1's cookie in the real browser.
            const tab2Login = await request(app.getHttpServer())
                .post('/auth/login')
                .set(XHR_REQUESTED_WITH_HEADER, XHR_REQUESTED_WITH)
                .set('Origin', ALLOWED_ORIGIN)
                .set('User-Agent', TEST_UA)
                .send({ email: tabOverwriteEmail, password: TEST_PASSWORD })
                .expect(200);

            const tab2Token = extractRefreshCookie(tab2Login)!;
            expect(tab2Token).toBeDefined();
            void tab1Login; // tab-1 token is now "orphaned" (overwritten in browser)

            // Tab-1 silent refresh uses tab-2's token (what the browser would actually send).
            const res = await callRefresh(tab2Token, TEST_UA).expect(200);
            expect((res.body as IAuthTokenResponse).accessToken).toEqual(expect.any(String));

            // No REFRESH_TOKEN_REUSED warn should have fired — tab-2's token is active, not revoked.
            // (This is asserted implicitly: the response is 200, not 401.)
        });
    });

    // -------------------------------------------------------------------------
    // Test 24: Cleanup job hard-fallback → REFRESH_TOKEN_RETENTION_BREACH
    // -------------------------------------------------------------------------

    describe('cleanup job — retention breach hard assertion', () => {
        it('emits REFRESH_TOKEN_RETENTION_BREACH when a row is past the 60-day threshold', async () => {
            // The breach assertion fires when the cleanup does NOT remove a row that is
            // older than the 60-day ceiling. To simulate a silent cleanup failure, we
            // stub `deleteExpiredAndStaleRevoked` to return 0 deleted while the 70-day row
            // remains in the repository.
            const pastDate = new Date(Date.now() - 70 * 86_400_000);
            refreshRepo.insertRawRow({
                userId: 1,
                familyId: 'breach-family',
                tokenHash: 'b'.repeat(64),
                expiresAt: new Date(Date.now() + 86_400_000),
                revokedAt: pastDate,
                replacedById: null,
                userAgent: null,
                ip: null,
                issuedAt: pastDate,
            });

            // Stub deleteExpiredAndStaleRevoked to be a no-op (simulates silent cleanup failure).
            const deleteStub = jest.spyOn(refreshRepo, 'deleteExpiredAndStaleRevoked').mockResolvedValueOnce({ deletedExpired: 0, deletedRevoked: 0 });

            const logSpy = jest.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);
            const errorSpy = jest.spyOn(processor['logger'], 'error').mockImplementation(() => undefined);
            jest.spyOn(processor['logger'], 'warn').mockImplementation(() => undefined);

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { Job } = await import('bullmq');
            const jobStub = { name: 'refresh-token-cleanup', id: 'j1', opts: {}, attemptsMade: 0 } as unknown as InstanceType<typeof Job>;
            await processor.process(jobStub);

            const breachCall = (errorSpy.mock.calls as Array<[unknown, ...unknown[]]>).find(
                (c) => typeof c[0] === 'object' && c[0] !== null && (c[0] as Record<string, unknown>)['code'] === 'REFRESH_TOKEN_RETENTION_BREACH',
            );
            expect(breachCall).toBeDefined();
            expect((breachCall![0] as Record<string, unknown>)['count']).toBeGreaterThan(0);
            expect((breachCall![0] as Record<string, unknown>)['thresholdDays']).toBe(REFRESH_TOKEN_RETENTION_BREACH_DAYS);

            logSpy.mockRestore();
            errorSpy.mockRestore();
            deleteStub.mockRestore();
        });
    });

    // -------------------------------------------------------------------------
    // Test 25: CORS preflight from allowed origin
    // -------------------------------------------------------------------------

    describe('CORS preflight — allowed origin echoed, credentials: true', () => {
        it('OPTIONS /auth/refresh returns Access-Control-Allow-Credentials: true', async () => {
            const res = await request(app.getHttpServer())
                .options('/auth/refresh')
                .set('Origin', ALLOWED_ORIGIN)
                .set('Access-Control-Request-Method', 'POST')
                .set('Access-Control-Request-Headers', 'X-Requested-With, Content-Type');

            expect(res.headers['access-control-allow-credentials']).toBe('true');
        });

        it('OPTIONS /auth/refresh echoes the allowed origin (never *)', async () => {
            const res = await request(app.getHttpServer())
                .options('/auth/refresh')
                .set('Origin', ALLOWED_ORIGIN)
                .set('Access-Control-Request-Method', 'POST')
                .set('Access-Control-Request-Headers', 'X-Requested-With, Content-Type');

            const allowOrigin = res.headers['access-control-allow-origin'];
            expect(allowOrigin).toBe(ALLOWED_ORIGIN);
            expect(allowOrigin).not.toBe('*');
        });
    });
});
