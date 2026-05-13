import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import { CourseSubjectEnum, InvitationStatusEnum, PurchaseStatusEnum, UserRoleEnum } from '@mes/shared';
import type { IApiErrorResponse, IPurchaseResponse } from '@mes/shared';

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
import { PurchasesController } from '../src/purchases/controller/PurchasesController';
import { PurchasesService } from '../src/purchases/service/PurchasesService';
import { PurchasesRepository } from '../src/purchases/repository/PurchasesRepository';
import { PurchaseEntity } from '../src/purchases/entity/PurchaseEntity';
import { CoursesController } from '../src/courses/controller/CoursesController';
import { CoursesService } from '../src/courses/service/CoursesService';
import { CoursesRepository } from '../src/courses/repository/CoursesRepository';
import { CourseEntity } from '../src/courses/entity/CourseEntity';
import { InvitationsService } from '../src/invitations/service/InvitationsService';
import { InvitationsRepository } from '../src/invitations/repository/InvitationsRepository';
import { InvitationEntity } from '../src/invitations/entity/InvitationEntity';
import { EnrolmentsRepository } from '../src/enrolments/repository/EnrolmentsRepository';
import { IdempotencyService } from '../src/common/idempotency/service/IdempotencyService';
import { IdempotencyKeysRepository } from '../src/common/idempotency/repository/IdempotencyKeysRepository';
import { IdempotencyKeyEntity } from '../src/common/idempotency/entity/IdempotencyKeyEntity';
import { IdempotencyInterceptor } from '../src/common/idempotency/interceptor/IdempotencyInterceptor';

/**
 * Integration test for `POST /purchases` and `GET /me/purchases`.
 *
 * Postgres is replaced by an in-memory store; everything above it — controllers, guards,
 * the global IdempotencyInterceptor, the validation pipe, JWT strategy, exception
 * filter — is the real wiring. The DB layer is exercised by migrations + manual
 * verification per the milestone DoD.
 *
 * The store implements the minimum surface PurchasesService + IdempotencyService need:
 * `transaction` (passes the manager through), and per-table insert/find.
 */

interface IUsersStoreRow {
    userId: number;
    email: string;
    passwordHash: string;
    role: UserRoleEnum;
    firstName: string | null;
    lastName: string | null;
    createdAt: Date;
    updatedAt: Date;
}

class InMemoryUsersRepository {
    private readonly rows = new Map<number, IUsersStoreRow>();
    private nextId = 1;

    public findById(userId: number): Promise<UserEntity | null> {
        return Promise.resolve(this.toEntity(this.rows.get(userId)));
    }

    public findByEmail(email: string): Promise<UserEntity | null> {
        const normalised = email.trim().toLowerCase();

        for (const row of this.rows.values()) {
            if (row.email === normalised) {
                return Promise.resolve(this.toEntity(row));
            }
        }

        return Promise.resolve(null);
    }

    public insertUser(entity: Partial<IUsersStoreRow>): Promise<UserEntity> {
        const row: IUsersStoreRow = {
            userId: this.nextId++,
            email: (entity.email ?? '').trim().toLowerCase(),
            passwordHash: entity.passwordHash ?? '',
            role: entity.role ?? UserRoleEnum.PARENT,
            firstName: entity.firstName ?? null,
            lastName: entity.lastName ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.rows.set(row.userId, row);

        return Promise.resolve(this.toEntity(row)!);
    }

    public updatePasswordHash(userId: number, passwordHash: string): Promise<void> {
        const row = this.rows.get(userId);

        if (row) {
            row.passwordHash = passwordHash;
        }

        return Promise.resolve();
    }

    private toEntity(row?: IUsersStoreRow): UserEntity | null {
        if (!row) {
            return null;
        }

        const entity = new UserEntity();
        Object.assign(entity, row);

        return entity;
    }
}

interface ICourseRow {
    courseId: number;
    subject: CourseSubjectEnum;
    yearFrom: number;
    yearTo: number;
    title: string;
    pricePence: number;
    createdAt: Date;
}

class InMemoryCoursesRepository {
    private readonly rows = new Map<number, ICourseRow>();

    public seedDefault(): void {
        this.rows.set(7, {
            courseId: 7,
            subject: CourseSubjectEnum.MATHS,
            yearFrom: 7,
            yearTo: 7,
            title: 'Maths Year 7',
            pricePence: 19900,
            createdAt: new Date('2026-05-13T10:00:00Z'),
        });
    }

    public findAllOrdered(): Promise<CourseEntity[]> {
        return Promise.resolve(Array.from(this.rows.values()).map((row) => this.toEntity(row)));
    }

    public findById(courseId: number): Promise<CourseEntity | null> {
        const row = this.rows.get(courseId);

        return Promise.resolve(row ? this.toEntity(row) : null);
    }

    private toEntity(row: ICourseRow): CourseEntity {
        const entity = new CourseEntity();
        Object.assign(entity, row);

        return entity;
    }
}

interface IPurchaseRow {
    purchaseId: number;
    parentUserId: number;
    courseId: number;
    status: PurchaseStatusEnum;
    amountPence: number;
    idempotencyKey: string;
    createdAt: Date;
    updatedAt: Date;
}

class InMemoryPurchasesRepository {
    public readonly rows = new Map<number, IPurchaseRow>();
    private nextId = 1;

    public insertWithinTransaction(_manager: EntityManager, input: Partial<PurchaseEntity>): Promise<PurchaseEntity> {
        const row: IPurchaseRow = {
            purchaseId: this.nextId++,
            parentUserId: input.parentUserId!,
            courseId: input.courseId!,
            status: input.status!,
            amountPence: input.amountPence!,
            idempotencyKey: input.idempotencyKey!,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.rows.set(row.purchaseId, row);
        const entity = new PurchaseEntity();
        Object.assign(entity, row);

        return Promise.resolve(entity);
    }

    public listByParent(parentUserId: number): Promise<PurchaseEntity[]> {
        const filtered = Array.from(this.rows.values())
            .filter((row) => row.parentUserId === parentUserId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        return Promise.resolve(filtered.map((row) => Object.assign(new PurchaseEntity(), row)));
    }

    public findByIdForParent(): Promise<PurchaseEntity | null> {
        return Promise.resolve(null);
    }
}

interface IInvitationRow {
    invitationId: number;
    purchaseId: number;
    tokenHash: string;
    studentEmail: string;
    status: InvitationStatusEnum;
    expiresAt: Date;
    redeemedAt: Date | null;
    emailSentAt: Date | null;
    createdAt: Date;
}

class InMemoryInvitationsRepository {
    public readonly rows = new Map<number, IInvitationRow>();
    private nextId = 1;

    public insertWithinTransaction(_manager: EntityManager, input: Partial<InvitationEntity>): Promise<InvitationEntity> {
        const row: IInvitationRow = {
            invitationId: this.nextId++,
            purchaseId: input.purchaseId!,
            tokenHash: input.tokenHash!,
            studentEmail: (input.studentEmail ?? '').toLowerCase(),
            status: input.status!,
            expiresAt: input.expiresAt!,
            redeemedAt: input.redeemedAt ?? null,
            emailSentAt: input.emailSentAt ?? null,
            createdAt: new Date(),
        };
        this.rows.set(row.invitationId, row);
        const entity = new InvitationEntity();
        Object.assign(entity, row);

        return Promise.resolve(entity);
    }

    public findByTokenHash(tokenHash: string): Promise<InvitationEntity | null> {
        for (const row of this.rows.values()) {
            if (row.tokenHash === tokenHash) {
                return Promise.resolve(Object.assign(new InvitationEntity(), row));
            }
        }

        return Promise.resolve(null);
    }

    public findByPurchaseId(purchaseId: number): Promise<InvitationEntity | null> {
        for (const row of this.rows.values()) {
            if (row.purchaseId === purchaseId) {
                return Promise.resolve(Object.assign(new InvitationEntity(), row));
            }
        }

        return Promise.resolve(null);
    }

    public findManyByPurchaseIds(purchaseIds: number[]): Promise<InvitationEntity[]> {
        const set = new Set(purchaseIds);
        const matches: InvitationEntity[] = [];

        for (const row of this.rows.values()) {
            if (set.has(row.purchaseId)) {
                matches.push(Object.assign(new InvitationEntity(), row));
            }
        }

        return Promise.resolve(matches);
    }
}

interface IIdemRow {
    idempotencyKeyId: number;
    key: string;
    userId: number;
    endpoint: string;
    requestHash: string;
    responseStatus: number;
    responseBody: object;
    createdAt: Date;
}

class InMemoryIdempotencyKeysRepository {
    public readonly rows = new Map<number, IIdemRow>();
    private nextId = 1;

    public findReplay(userId: number, endpoint: string, key: string): Promise<IdempotencyKeyEntity | null> {
        for (const row of this.rows.values()) {
            if (row.userId === userId && row.endpoint === endpoint && row.key === key) {
                return Promise.resolve(Object.assign(new IdempotencyKeyEntity(), row));
            }
        }

        return Promise.resolve(null);
    }

    public insertWithinTransaction(_manager: EntityManager, input: Partial<IdempotencyKeyEntity>): Promise<IdempotencyKeyEntity> {
        const existing = Array.from(this.rows.values()).find((row) => row.userId === input.userId && row.endpoint === input.endpoint && row.key === input.key);

        if (existing) {
            // Emulate PG unique violation so IdempotencyService can disambiguate body match vs mismatch.
            const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
                name: 'QueryFailedError',
                driverError: { code: '23505' },
            });
            throw error;
        }

        const row: IIdemRow = {
            idempotencyKeyId: this.nextId++,
            key: input.key!,
            userId: input.userId!,
            endpoint: input.endpoint!,
            requestHash: input.requestHash!,
            responseStatus: input.responseStatus!,
            responseBody: input.responseBody!,
            createdAt: new Date(),
        };
        this.rows.set(row.idempotencyKeyId, row);

        return Promise.resolve(Object.assign(new IdempotencyKeyEntity(), row));
    }
}

class StubDataSource {
    public async transaction<T>(runInTransaction: (manager: EntityManager) => Promise<T>): Promise<T> {
        return runInTransaction({} as EntityManager);
    }
}

describe('Purchases (e2e)', () => {
    let app: INestApplication<App>;
    const TEST_JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxxx';

    let jwtService: JwtService;
    let purchasesRepo: InMemoryPurchasesRepository;
    let idemRepo: InMemoryIdempotencyKeysRepository;

    const signTokenForRole = (userId: number, role: UserRoleEnum): string => {
        return jwtService.sign({ sub: userId, role }, { expiresIn: '15m' });
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        process.env.JWT_EXPIRES_IN = '15m';
        process.env.NODE_ENV = 'test';
        process.env.LOG_LEVEL = 'silent';
        process.env.LOG_PRETTY = 'false';

        const usersRepoStub = new InMemoryUsersRepository();
        // Seed a PARENT and a STUDENT so RBAC paths can be exercised.
        await usersRepoStub.insertUser({ email: 'parent@mes.test', passwordHash: 'unused', role: UserRoleEnum.PARENT });
        await usersRepoStub.insertUser({ email: 'student@mes.test', passwordHash: 'unused', role: UserRoleEnum.STUDENT });

        const coursesRepoStub = new InMemoryCoursesRepository();
        coursesRepoStub.seedDefault();

        purchasesRepo = new InMemoryPurchasesRepository();
        idemRepo = new InMemoryIdempotencyKeysRepository();
        const invitationsRepoStub = new InMemoryInvitationsRepository();
        const usersService = new UsersService(usersRepoStub as unknown as UsersRepository);

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
            controllers: [AppController, AuthController, CoursesController, PurchasesController],
            providers: [
                AppService,
                AuthService,
                JwtStrategy,
                { provide: UsersRepository, useValue: usersRepoStub },
                { provide: UsersService, useValue: usersService },
                { provide: CoursesRepository, useValue: coursesRepoStub },
                CoursesService,
                { provide: InvitationsRepository, useValue: invitationsRepoStub },
                { provide: EnrolmentsRepository, useValue: {} },
                InvitationsService,
                { provide: IdempotencyKeysRepository, useValue: idemRepo },
                IdempotencyService,
                { provide: PurchasesRepository, useValue: purchasesRepo },
                PurchasesService,
                { provide: DataSource, useClass: StubDataSource },
                IdempotencyInterceptor,
                { provide: APP_GUARD, useClass: JwtAuthGuard },
                { provide: APP_GUARD, useClass: RolesGuard },
                {
                    provide: APP_PIPE,
                    useFactory: (): ValidationPipe => new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
                },
                { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
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

    const validKey = 'idem-12345678';

    it('happy path: PARENT creates a purchase and gets an invitation URL', async () => {
        const parentToken = signTokenForRole(1, UserRoleEnum.PARENT);
        const res = await request(app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${parentToken}`)
            .set('Idempotency-Key', validKey)
            .send({ courseId: 7, studentEmail: 'kid@example.com' })
            .expect(201);
        const body = res.body as IPurchaseResponse;
        expect(body.id).toEqual(expect.any(Number));
        expect(body.courseId).toBe(7);
        expect(body.status).toBe(PurchaseStatusEnum.COMPLETED);
        expect(body.amountPence).toBe(19900);
        expect(body.invitation.studentEmail).toBe('kid@example.com');
        expect(body.invitation.status).toBe(InvitationStatusEnum.ISSUED);
        expect(body.invitation.url).toMatch(/token=/);
    });

    it('non-PARENT (STUDENT) → 403 AUTH_FORBIDDEN_ROLE', async () => {
        const studentToken = signTokenForRole(2, UserRoleEnum.STUDENT);
        const res = await request(app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${studentToken}`)
            .set('Idempotency-Key', 'idem-87654321')
            .send({ courseId: 7, studentEmail: 'someone@example.com' })
            .expect(403);
        expect((res.body as IApiErrorResponse).code).toBe('AUTH_FORBIDDEN_ROLE');
    });

    it('replay with same Idempotency-Key + same body returns the original 201 body', async () => {
        const parentToken = signTokenForRole(1, UserRoleEnum.PARENT);
        const replayKey = 'idem-replay001';
        const body = { courseId: 7, studentEmail: 'replay@example.com' };

        const first = await request(app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${parentToken}`)
            .set('Idempotency-Key', replayKey)
            .send(body)
            .expect(201);
        const firstBody = first.body as IPurchaseResponse;

        const second = await request(app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${parentToken}`)
            .set('Idempotency-Key', replayKey)
            .send(body)
            .expect(201);
        // Per ADR 0006: the replay returns the minimal `{ purchaseId, invitationId }` body —
        // the plaintext URL is intentionally NOT stored so a DB dump never exposes live tokens.
        const replayResponse = second.body as { purchaseId: number; invitationId: number };

        expect(replayResponse.purchaseId).toBe(firstBody.id);
        expect(replayResponse.invitationId).toBe(firstBody.invitation.id);
    });

    it('replay with same key + different body returns 409 IDEMPOTENCY_BODY_MISMATCH', async () => {
        const parentToken = signTokenForRole(1, UserRoleEnum.PARENT);
        const conflictKey = 'idem-conflict01';

        await request(app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${parentToken}`)
            .set('Idempotency-Key', conflictKey)
            .send({ courseId: 7, studentEmail: 'first@example.com' })
            .expect(201);

        const res = await request(app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${parentToken}`)
            .set('Idempotency-Key', conflictKey)
            .send({ courseId: 7, studentEmail: 'different@example.com' })
            .expect(409);
        expect((res.body as IApiErrorResponse).code).toBe('IDEMPOTENCY_BODY_MISMATCH');
    });

    it('missing Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
        const parentToken = signTokenForRole(1, UserRoleEnum.PARENT);
        const res = await request(app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${parentToken}`)
            .send({ courseId: 7, studentEmail: 'missing-key@example.com' })
            .expect(400);
        expect((res.body as IApiErrorResponse).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('malformed Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
        const parentToken = signTokenForRole(1, UserRoleEnum.PARENT);
        const res = await request(app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${parentToken}`)
            .set('Idempotency-Key', 'sh!ort')
            .send({ courseId: 7, studentEmail: 'malformed@example.com' })
            .expect(400);
        expect((res.body as IApiErrorResponse).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('GET /courses lists the seeded catalog (public)', async () => {
        const res = await request(app.getHttpServer()).get('/courses').expect(200);
        const courses = res.body as Array<{ id: number; subject: string; title: string }>;
        expect(courses.length).toBeGreaterThan(0);
        expect(courses[0].subject).toBe('MATHS');
    });

    it("GET /me/purchases returns the parent's history (newest first, no URL)", async () => {
        const parentToken = signTokenForRole(1, UserRoleEnum.PARENT);
        const res = await request(app.getHttpServer()).get('/me/purchases').set('Authorization', `Bearer ${parentToken}`).expect(200);
        const purchases = res.body as IPurchaseResponse[];
        expect(purchases.length).toBeGreaterThan(0);
        expect(purchases[0].invitation.url).toBe('');
    });

    it('POST /purchases with no token → 401 AUTH_MISSING_TOKEN', async () => {
        const res = await request(app.getHttpServer())
            .post('/purchases')
            .set('Idempotency-Key', 'idem-anon00001')
            .send({ courseId: 7, studentEmail: 'anon@example.com' })
            .expect(401);
        expect((res.body as IApiErrorResponse).code).toBe('AUTH_MISSING_TOKEN');
    });
});
