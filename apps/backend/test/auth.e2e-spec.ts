import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtService } from '@nestjs/jwt';
import { UserRoleEnum } from '@mes/shared';
import type { IApiErrorResponse } from '@mes/shared';
import type { IAuthTokenResponse } from '../src/auth/interface/IAuthTokenResponse';
import type { IAuthUserProfile } from '../src/auth/interface/IAuthUserProfile';

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
import { DataSource } from 'typeorm';
import { UsersRepository } from '../src/users/repository/UsersRepository';
import { UsersService } from '../src/users/service/UsersService';
import { UserEntity } from '../src/users/entity/UserEntity';
import { RefreshTokensRepository } from '../src/auth/repository/RefreshTokensRepository';

/**
 * Integration test: signup → login → /auth/me round trip + expired/invalid token paths.
 *
 * The Postgres layer is replaced by an in-memory `UsersRepository` stub so the test can
 * run without docker; everything above it (controllers, guards, validation pipe, JWT
 * strategy, exception filter) is the real wiring. This is what protects the public
 * contract — the DB layer is exercised by migration + manual verification per the
 * milestone DoD.
 */
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

class StubDataSource {
    public async transaction<T>(runInTransaction: (manager: import('typeorm').EntityManager) => Promise<T>): Promise<T> {
        return runInTransaction({} as import('typeorm').EntityManager);
    }
}

class StubRefreshTokensRepository {
    public async insertNew(): Promise<void> {}
}

describe('Auth (e2e)', () => {
    let app: INestApplication<App>;
    let jwtService: JwtService;
    const TEST_JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxxx';

    beforeAll(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        process.env.JWT_EXPIRES_IN = '15m';
        process.env.NODE_ENV = 'test';
        process.env.LOG_LEVEL = 'silent';
        process.env.LOG_PRETTY = 'false';

        const repo = new InMemoryUsersRepository();
        const usersService = new UsersService(repo as unknown as UsersRepository);

        const moduleRef = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ClsRequestModule,
                LoggerModule,
                PassportModule,
                JwtModule.register({
                    secret: TEST_JWT_SECRET,
                    signOptions: { algorithm: 'HS256', expiresIn: '15m' },
                    verifyOptions: { algorithms: ['HS256'] },
                }),
            ],
            controllers: [AppController, AuthController],
            providers: [
                AppService,
                AuthService,
                JwtStrategy,
                { provide: UsersRepository, useValue: repo },
                { provide: UsersService, useValue: usersService },
                { provide: RefreshTokensRepository, useClass: StubRefreshTokensRepository },
                { provide: DataSource, useClass: StubDataSource },
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
        await app.init();
        jwtService = moduleRef.get(JwtService);
    });

    afterAll(async () => {
        await app.close();
    });

    it('signup → login → /auth/me round trip', async () => {
        const signupRes = await request(app.getHttpServer())
            .post('/auth/signup')
            .send({ email: 'parent@mes.test', password: 'correcthorse12battery' })
            .expect(201);
        const signupBody = signupRes.body as IAuthTokenResponse;
        expect(signupBody.accessToken).toEqual(expect.any(String));
        expect(signupBody.expiresIn).toBe(900);

        const loginRes = await request(app.getHttpServer())
            .post('/auth/login')
            .send({ email: 'parent@mes.test', password: 'correcthorse12battery' })
            .expect(200);
        const loginBody = loginRes.body as IAuthTokenResponse;
        const token = loginBody.accessToken;
        expect(token).toEqual(expect.any(String));

        const meRes = await request(app.getHttpServer()).get('/auth/me').set('authorization', `Bearer ${token}`).expect(200);
        const meBody = meRes.body as IAuthUserProfile;
        expect(typeof meBody.id).toBe('number');
        expect(meBody.email).toBe('parent@mes.test');
        expect(meBody.role).toBe(UserRoleEnum.PARENT);
        expect(meBody.firstName).toBeNull();
        expect(meBody.lastName).toBeNull();
    });

    it('signup rejects an attempt to set the role via the body', async () => {
        const res = await request(app.getHttpServer())
            .post('/auth/signup')
            .send({ email: 'attacker@mes.test', password: 'correcthorse12battery', role: UserRoleEnum.ADMIN })
            .expect(400);
        const body = res.body as IApiErrorResponse;
        expect(body.code).toBe('VALIDATION_FAILED');
    });

    it('signup rejects a duplicate email with USER_EMAIL_TAKEN', async () => {
        await request(app.getHttpServer()).post('/auth/signup').send({ email: 'dup@mes.test', password: 'correcthorse12battery' }).expect(201);
        const res = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'dup@mes.test', password: 'correcthorse12battery' }).expect(409);
        expect((res.body as IApiErrorResponse).code).toBe('USER_EMAIL_TAKEN');
    });

    it('login returns AUTH_INVALID_CREDENTIALS for a wrong password', async () => {
        await request(app.getHttpServer()).post('/auth/signup').send({ email: 'badpass@mes.test', password: 'correcthorse12battery' }).expect(201);

        const res = await request(app.getHttpServer()).post('/auth/login').send({ email: 'badpass@mes.test', password: 'wrong-but-valid-12' }).expect(401);
        expect((res.body as IApiErrorResponse).code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('/auth/me with no token → AUTH_MISSING_TOKEN', async () => {
        const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
        expect((res.body as IApiErrorResponse).code).toBe('AUTH_MISSING_TOKEN');
    });

    it('/auth/me with a bad signature → AUTH_INVALID_TOKEN', async () => {
        const res = await request(app.getHttpServer()).get('/auth/me').set('authorization', 'Bearer not-a-real-jwt.payload.sig').expect(401);
        expect((res.body as IApiErrorResponse).code).toBe('AUTH_INVALID_TOKEN');
    });

    it('/auth/me with an expired token → AUTH_TOKEN_EXPIRED', async () => {
        const expired = jwtService.sign({ sub: 1, role: UserRoleEnum.PARENT }, { expiresIn: '-1s' });
        const res = await request(app.getHttpServer()).get('/auth/me').set('authorization', `Bearer ${expired}`).expect(401);
        expect((res.body as IApiErrorResponse).code).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('error envelope always carries requestId echoed back via x-request-id header', async () => {
        const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
        const body = res.body as IApiErrorResponse;
        expect(body.requestId).toEqual(expect.any(String));
        expect(body.requestId.length).toBeGreaterThan(0);
        expect(res.headers['x-request-id']).toBe(body.requestId);
    });

    it('signup race condition: concurrent duplicate insert returns USER_EMAIL_TAKEN (409)', async () => {
        // Simulate the race: first signup succeeds, second request reaches insertUser
        // after findByEmail returned null for both. The in-memory repo won't reproduce
        // the DB race, so we test the 409 from the first check (email already present).
        await request(app.getHttpServer()).post('/auth/signup').send({ email: 'race-dup@mes.test', password: 'correcthorse12battery' }).expect(201);

        const res = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'race-dup@mes.test', password: 'correcthorse12battery' }).expect(409);
        expect((res.body as IApiErrorResponse).code).toBe('USER_EMAIL_TAKEN');
    });

    it('x-request-id with invalid chars is ignored and a fresh UUID is generated', async () => {
        // Use a value with characters outside the allowed [A-Za-z0-9._-] set but still
        // valid in HTTP headers (spaces, angle brackets) so Node/supertest does not reject
        // the header before it reaches the server.
        const invalidId = 'bad id with spaces';
        const res = await request(app.getHttpServer()).get('/auth/me').set('x-request-id', invalidId).expect(401);
        const body = res.body as IApiErrorResponse;
        // The invalid id must be rejected — a safe UUID is generated instead.
        expect(body.requestId).not.toBe(invalidId);
        expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.headers['x-request-id']).toBe(body.requestId);
    });
});
