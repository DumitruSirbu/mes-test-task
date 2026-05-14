import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { UserRoleEnum, CourseSubjectEnum, PurchaseStatusEnum } from '@mes/shared';
import type { IApiErrorResponse, IPaginated } from '@mes/shared';

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
import { UsersRepository } from '../src/users/repository/UsersRepository';
import { UsersService } from '../src/users/service/UsersService';
import { UserEntity } from '../src/users/entity/UserEntity';
import { PurchasesRepository } from '../src/purchases/repository/PurchasesRepository';
import { PurchaseEntity } from '../src/purchases/entity/PurchaseEntity';
import { CoursesRepository } from '../src/courses/repository/CoursesRepository';
import { CourseEntity } from '../src/courses/entity/CourseEntity';
import { AdminController } from '../src/admin/controller/AdminController';
import { AdminService } from '../src/admin/service/AdminService';
import { IAdminParentRow } from '../src/admin/interface/IAdminParentRow';
import { DataSource } from 'typeorm';
import { RefreshTokensRepository } from '../src/auth/repository/RefreshTokensRepository';

/**
 * E2E integration tests for the admin panel endpoints.
 *
 * Postgres is replaced by in-memory stubs. All NestJS layers above (guards, pipe,
 * exception filter, JWT strategy) are the real wiring — identical to production.
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

    public findPaginatedByRole(role: UserRoleEnum, skip: number, take: number): Promise<[UserEntity[], number]> {
        const all = Array.from(this.rows.values())
            .filter((r) => r.role === role)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const page = all.slice(skip, skip + take);

        return Promise.resolve([page, all.length]);
    }
}

class InMemoryPurchasesRepository {
    private readonly rows = new Map<number, PurchaseEntity>();
    private nextId = 1;

    public seed(parentUserId: number, courseId: number): void {
        const entity = new PurchaseEntity();
        entity.purchaseId = this.nextId++;
        entity.parentUserId = parentUserId;
        entity.courseId = courseId;
        entity.status = PurchaseStatusEnum.COMPLETED;
        entity.amountPence = 19900;
        entity.idempotencyKey = `idem-seed-${entity.purchaseId}`;
        entity.createdAt = new Date();
        entity.updatedAt = new Date();
        this.rows.set(entity.purchaseId, entity);
    }

    public findPaginated(skip: number, take: number): Promise<[PurchaseEntity[], number]> {
        const all = Array.from(this.rows.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const page = all.slice(skip, skip + take);

        return Promise.resolve([page, all.length]);
    }

    // Stub out remaining surface used by PurchasesService (not exercised here).
    public insertWithinTransaction(): Promise<never> {
        return Promise.reject(new Error('not implemented in stub'));
    }

    public listByParent(): Promise<PurchaseEntity[]> {
        return Promise.resolve([]);
    }

    public existsCompletedForParentCourseAndStudent(): Promise<boolean> {
        return Promise.resolve(false);
    }

    public findByIdForParent(): Promise<PurchaseEntity | null> {
        return Promise.resolve(null);
    }
}

class InMemoryCoursesRepository {
    private readonly rows = new Map<number, CourseEntity>();
    private nextId = 1;

    public seed(): void {
        const entity = new CourseEntity();
        entity.courseId = this.nextId++;
        entity.title = 'Maths Year 7';
        entity.subject = CourseSubjectEnum.MATHS;
        entity.yearFrom = 7;
        entity.yearTo = 7;
        entity.pricePence = 19900;
        entity.createdAt = new Date();
        this.rows.set(entity.courseId, entity);
    }

    public findPaginated(skip: number, take: number): Promise<[CourseEntity[], number]> {
        const all = Array.from(this.rows.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const page = all.slice(skip, skip + take);

        return Promise.resolve([page, all.length]);
    }

    public findAllOrdered(): Promise<CourseEntity[]> {
        return Promise.resolve(Array.from(this.rows.values()));
    }

    public findById(courseId: number): Promise<CourseEntity | null> {
        return Promise.resolve(this.rows.get(courseId) ?? null);
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

describe('Admin (e2e)', () => {
    let app: INestApplication<App>;
    let jwtService: JwtService;
    let usersRepo: InMemoryUsersRepository;
    let purchasesRepo: InMemoryPurchasesRepository;
    let coursesRepo: InMemoryCoursesRepository;

    const TEST_JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxxx';

    const signToken = (userId: number, role: UserRoleEnum): string => jwtService.sign({ sub: userId, role }, { expiresIn: '15m' });

    beforeAll(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        process.env.JWT_EXPIRES_IN = '15m';
        process.env.NODE_ENV = 'test';
        process.env.LOG_LEVEL = 'silent';
        process.env.LOG_PRETTY = 'false';

        usersRepo = new InMemoryUsersRepository();
        purchasesRepo = new InMemoryPurchasesRepository();
        coursesRepo = new InMemoryCoursesRepository();

        // Seed one of each role plus an admin.
        await usersRepo.insertUser({ email: 'parent@mes.test', passwordHash: 'unused', role: UserRoleEnum.PARENT });
        await usersRepo.insertUser({ email: 'student@mes.test', passwordHash: 'unused', role: UserRoleEnum.STUDENT });
        await usersRepo.insertUser({ email: 'admin@mes.test', passwordHash: 'unused', role: UserRoleEnum.ADMIN });

        purchasesRepo.seed(1, 7);
        coursesRepo.seed();

        const usersService = new UsersService(usersRepo as unknown as UsersRepository);

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
            controllers: [AppController, AuthController, AdminController],
            providers: [
                AppService,
                AuthService,
                JwtStrategy,
                AdminService,
                { provide: UsersRepository, useValue: usersRepo },
                { provide: UsersService, useValue: usersService },
                { provide: PurchasesRepository, useValue: purchasesRepo },
                { provide: CoursesRepository, useValue: coursesRepo },
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

    describe('GET /admin/parents', () => {
        it('ADMIN receives paginated parent list', async () => {
            const token = signToken(3, UserRoleEnum.ADMIN);
            const res = await request(app.getHttpServer()).get('/admin/parents').set('Authorization', `Bearer ${token}`).expect(200);
            const body = res.body as IPaginated<IAdminParentRow>;
            expect(body.total).toBeGreaterThanOrEqual(1);
            expect(body.page).toBe(1);
            expect(body.limit).toBe(20);
            expect(Array.isArray(body.data)).toBe(true);
            expect(body.data[0]).toMatchObject({ email: 'parent@mes.test' });
        });

        it('applies default pagination when page and limit are omitted', async () => {
            const token = signToken(3, UserRoleEnum.ADMIN);
            const res = await request(app.getHttpServer()).get('/admin/parents').set('Authorization', `Bearer ${token}`).expect(200);
            const body = res.body as IPaginated<IAdminParentRow>;
            expect(body.page).toBe(1);
            expect(body.limit).toBe(20);
        });

        it('rejects unauthenticated request with 401 AUTH_MISSING_TOKEN', async () => {
            const res = await request(app.getHttpServer()).get('/admin/parents').expect(401);
            expect((res.body as IApiErrorResponse).code).toBe('AUTH_MISSING_TOKEN');
        });

        it('rejects PARENT role with 403 AUTH_FORBIDDEN_ROLE', async () => {
            const token = signToken(1, UserRoleEnum.PARENT);
            const res = await request(app.getHttpServer()).get('/admin/parents').set('Authorization', `Bearer ${token}`).expect(403);
            expect((res.body as IApiErrorResponse).code).toBe('AUTH_FORBIDDEN_ROLE');
        });

        it('rejects invalid pagination: page=0 → 400 VALIDATION_FAILED', async () => {
            const token = signToken(3, UserRoleEnum.ADMIN);
            const res = await request(app.getHttpServer()).get('/admin/parents?page=0').set('Authorization', `Bearer ${token}`).expect(400);
            expect((res.body as IApiErrorResponse).code).toBe('VALIDATION_FAILED');
        });

        it('rejects invalid pagination: limit=200 exceeds MAX_PAGE_LIMIT → 400 VALIDATION_FAILED', async () => {
            const token = signToken(3, UserRoleEnum.ADMIN);
            const res = await request(app.getHttpServer()).get('/admin/parents?limit=200').set('Authorization', `Bearer ${token}`).expect(400);
            expect((res.body as IApiErrorResponse).code).toBe('VALIDATION_FAILED');
        });
    });

    describe('GET /admin/students', () => {
        it('ADMIN receives paginated student list', async () => {
            const token = signToken(3, UserRoleEnum.ADMIN);
            const res = await request(app.getHttpServer()).get('/admin/students').set('Authorization', `Bearer ${token}`).expect(200);
            const body = res.body as IPaginated<{ email: string }>;
            expect(body.total).toBeGreaterThanOrEqual(1);
            expect(body.data[0]).toMatchObject({ email: 'student@mes.test' });
        });

        it('rejects PARENT role with 403', async () => {
            const token = signToken(1, UserRoleEnum.PARENT);
            const res = await request(app.getHttpServer()).get('/admin/students').set('Authorization', `Bearer ${token}`).expect(403);
            expect((res.body as IApiErrorResponse).code).toBe('AUTH_FORBIDDEN_ROLE');
        });

        it('rejects unauthenticated request with 401', async () => {
            const res = await request(app.getHttpServer()).get('/admin/students').expect(401);
            expect((res.body as IApiErrorResponse).code).toBe('AUTH_MISSING_TOKEN');
        });
    });

    describe('GET /admin/purchases', () => {
        it('ADMIN receives paginated purchase list', async () => {
            const token = signToken(3, UserRoleEnum.ADMIN);
            const res = await request(app.getHttpServer()).get('/admin/purchases').set('Authorization', `Bearer ${token}`).expect(200);
            const body = res.body as IPaginated<{ id: number; status: string }>;
            expect(body.total).toBeGreaterThanOrEqual(1);
            expect(body.data[0].status).toBe(PurchaseStatusEnum.COMPLETED);
        });

        it('rejects PARENT role with 403', async () => {
            const token = signToken(1, UserRoleEnum.PARENT);
            const res = await request(app.getHttpServer()).get('/admin/purchases').set('Authorization', `Bearer ${token}`).expect(403);
            expect((res.body as IApiErrorResponse).code).toBe('AUTH_FORBIDDEN_ROLE');
        });

        it('rejects unauthenticated request with 401', async () => {
            const res = await request(app.getHttpServer()).get('/admin/purchases').expect(401);
            expect((res.body as IApiErrorResponse).code).toBe('AUTH_MISSING_TOKEN');
        });
    });

    describe('GET /admin/courses', () => {
        it('ADMIN receives paginated course list', async () => {
            const token = signToken(3, UserRoleEnum.ADMIN);
            const res = await request(app.getHttpServer()).get('/admin/courses').set('Authorization', `Bearer ${token}`).expect(200);
            const body = res.body as IPaginated<{ title: string }>;
            expect(body.total).toBeGreaterThanOrEqual(1);
            expect(body.data[0].title).toBe('Maths Year 7');
        });

        it('rejects PARENT role with 403', async () => {
            const token = signToken(1, UserRoleEnum.PARENT);
            const res = await request(app.getHttpServer()).get('/admin/courses').set('Authorization', `Bearer ${token}`).expect(403);
            expect((res.body as IApiErrorResponse).code).toBe('AUTH_FORBIDDEN_ROLE');
        });

        it('rejects unauthenticated request with 401', async () => {
            const res = await request(app.getHttpServer()).get('/admin/courses').expect(401);
            expect((res.body as IApiErrorResponse).code).toBe('AUTH_MISSING_TOKEN');
        });
    });
});
