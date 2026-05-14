import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHash, randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import { CourseSubjectEnum, InvitationStatusEnum, PurchaseStatusEnum, UserRoleEnum } from '@mes/shared';
import type { IApiErrorResponse } from '@mes/shared';

import { INVITATION_TOKEN_HASH_ALGORITHM } from '../src/invitations/const/InvitationsConsts';
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
import { InvitationsController } from '../src/invitations/controller/InvitationsController';
import { InvitationsService } from '../src/invitations/service/InvitationsService';
import { InvitationsRepository } from '../src/invitations/repository/InvitationsRepository';
import { InvitationEntity } from '../src/invitations/entity/InvitationEntity';
import { EnrolmentsRepository } from '../src/enrolments/repository/EnrolmentsRepository';
import { EnrolmentEntity } from '../src/enrolments/entity/EnrolmentEntity';
import { IdempotencyService } from '../src/common/idempotency/service/IdempotencyService';
import { IdempotencyKeysRepository } from '../src/common/idempotency/repository/IdempotencyKeysRepository';
import { IdempotencyKeyEntity } from '../src/common/idempotency/entity/IdempotencyKeyEntity';
import { IdempotencyInterceptor } from '../src/common/idempotency/interceptor/IdempotencyInterceptor';
import { INVITATION_EMAIL_QUEUE } from '../src/notifications/const/NotificationsConsts';
import { RefreshTokensRepository } from '../src/auth/repository/RefreshTokensRepository';

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

interface IUserRow {
    userId: number;
    email: string;
    passwordHash: string;
    role: UserRoleEnum;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    createdAt: Date;
    updatedAt: Date;
}

class InMemoryUsersRepository {
    public readonly rows = new Map<number, IUserRow>();
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

    public insertUser(input: Partial<IUserRow>): Promise<UserEntity> {
        return this.insertUserWithinTransaction({} as EntityManager, input);
    }

    public insertUserWithinTransaction(_manager: EntityManager, input: Partial<IUserRow>): Promise<UserEntity> {
        const normalised = (input.email ?? '').trim().toLowerCase();

        for (const row of this.rows.values()) {
            if (row.email === normalised) {
                const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
                    name: 'QueryFailedError',
                    driverError: { code: '23505' },
                });
                throw error;
            }
        }

        const row: IUserRow = {
            userId: this.nextId++,
            email: normalised,
            passwordHash: input.passwordHash ?? '',
            role: input.role ?? UserRoleEnum.PARENT,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            dateOfBirth: input.dateOfBirth ?? null,
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

    private toEntity(row?: IUserRow): UserEntity | null {
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

    public getById(courseId: number): ICourseRow | undefined {
        return this.rows.get(courseId);
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

/**
 * In-memory InvitationsRepository that faithfully models the atomic-redeem
 * semantics: the UPDATE targets only ISSUED rows that have not expired.
 */
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

        return Promise.resolve(this.toEntity(row));
    }

    /**
     * Mirrors the SQL `UPDATE ... WHERE status = 'ISSUED' AND expires_at > now() RETURNING *`.
     * Returns the updated entity if the transition succeeded; null otherwise.
     */
    public atomicRedeem(_manager: EntityManager, tokenHash: string): Promise<InvitationEntity | null> {
        for (const row of this.rows.values()) {
            if (row.tokenHash === tokenHash && row.status === InvitationStatusEnum.ISSUED && row.expiresAt > new Date()) {
                row.status = InvitationStatusEnum.REDEEMED;
                row.redeemedAt = new Date();

                return Promise.resolve(this.toEntity(row));
            }
        }

        return Promise.resolve(null);
    }

    public findByTokenHash(tokenHash: string): Promise<InvitationEntity | null> {
        for (const row of this.rows.values()) {
            if (row.tokenHash === tokenHash) {
                return Promise.resolve(this.toEntity(row));
            }
        }

        return Promise.resolve(null);
    }

    /**
     * Emulates the eager-load of `purchase → course` and `purchase → parent` relations
     * that the real TypeORM repository performs for `getMetaByToken`.
     * Overridden by a closure in `buildTestContext` to inject the real in-memory stores.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public findByTokenHashWithRelations(_tokenHash: string): Promise<InvitationEntity | null> {
        return Promise.resolve(null);
    }

    /**
     * Returns the course ID for a given purchase ID.
     * Overridden by a closure in `buildTestContext` to look up the in-memory purchases store.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public findCourseIdByPurchaseId(_manager: EntityManager, _purchaseId: number): Promise<number> {
        return Promise.reject(new Error('findCourseIdByPurchaseId not wired in test context'));
    }

    public findByPurchaseId(purchaseId: number): Promise<InvitationEntity | null> {
        for (const row of this.rows.values()) {
            if (row.purchaseId === purchaseId) {
                return Promise.resolve(this.toEntity(row));
            }
        }

        return Promise.resolve(null);
    }

    public findManyByPurchaseIds(purchaseIds: number[]): Promise<InvitationEntity[]> {
        const set = new Set(purchaseIds);
        const results: InvitationEntity[] = [];

        for (const row of this.rows.values()) {
            if (set.has(row.purchaseId)) {
                results.push(this.toEntity(row));
            }
        }

        return Promise.resolve(results);
    }

    private toEntity(row: IInvitationRow): InvitationEntity {
        return Object.assign(new InvitationEntity(), row);
    }
}

interface IEnrolmentRow {
    enrolmentId: number;
    studentUserId: number;
    courseId: number;
    sourceInvitationId: number | null;
    createdAt: Date;
}

class InMemoryEnrolmentsRepository {
    public readonly rows = new Map<number, IEnrolmentRow>();
    private nextId = 1;

    public insertWithinTransaction(_manager: EntityManager, input: Partial<EnrolmentEntity>): Promise<EnrolmentEntity> {
        const row: IEnrolmentRow = {
            enrolmentId: this.nextId++,
            studentUserId: input.studentUserId!,
            courseId: input.courseId!,
            sourceInvitationId: input.sourceInvitationId ?? null,
            createdAt: new Date(),
        };
        this.rows.set(row.enrolmentId, row);

        return Promise.resolve(Object.assign(new EnrolmentEntity(), row));
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
    private readonly rows = new Map<number, IIdemRow>();
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

// ---------------------------------------------------------------------------
// StubDataSource — passes manager through; also handles manager.query for
// the `resolveCourseId` fallback in InvitationsService.
// ---------------------------------------------------------------------------

function buildStubDataSource(purchasesRepo: InMemoryPurchasesRepository): unknown {
    const manager = {
        query: <T>(sql: string, params: unknown[]): Promise<T> => {
            if (sql.includes('SELECT course_id FROM purchases')) {
                const purchaseId = params[0] as number;
                const row = purchasesRepo.rows.get(purchaseId);

                if (!row) {
                    return Promise.resolve([] as unknown as T);
                }

                return Promise.resolve([{ course_id: row.courseId }] as unknown as T);
            }

            return Promise.resolve([] as unknown as T);
        },
        create: <T extends object>(EntityClass: new () => T, data: Partial<T>): T => {
            return Object.assign(new EntityClass(), data);
        },
        save: <T>(_EntityClass: unknown, entity: T): Promise<T> => Promise.resolve(entity),
    };

    return {
        transaction: <T>(runInTransaction: (manager: EntityManager) => Promise<T>): Promise<T> => {
            return runInTransaction(manager as unknown as EntityManager);
        },
    };
}

class StubRefreshTokensRepository {
    public async insertNew(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Factory: builds a fresh set of in-memory stores + NestJS application.
// Returned stores are exposed so individual tests can inspect/seed them.
// ---------------------------------------------------------------------------

interface ITestContext {
    app: INestApplication<App>;
    usersRepo: InMemoryUsersRepository;
    purchasesRepo: InMemoryPurchasesRepository;
    invitationsRepo: InMemoryInvitationsRepository;
    enrolmentsRepo: InMemoryEnrolmentsRepository;
    coursesRepo: InMemoryCoursesRepository;
}

const TEST_JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxxx';

async function buildTestContext(): Promise<ITestContext> {
    const usersRepo = new InMemoryUsersRepository();
    const coursesRepo = new InMemoryCoursesRepository();
    coursesRepo.seedDefault();

    const purchasesRepo = new InMemoryPurchasesRepository();
    const invitationsRepo = new InMemoryInvitationsRepository();
    const enrolmentsRepo = new InMemoryEnrolmentsRepository();

    // Wire `findByTokenHashWithRelations` to use the stores via closure so the meta
    // endpoint can resolve relations without a real DB.
    invitationsRepo.findByTokenHashWithRelations = (tokenHash: string): Promise<InvitationEntity | null> => {
        for (const invRow of invitationsRepo.rows.values()) {
            if (invRow.tokenHash !== tokenHash) {
                continue;
            }

            const purchaseRow = purchasesRepo.rows.get(invRow.purchaseId);

            if (!purchaseRow) {
                return Promise.resolve(null);
            }

            const courseRow = coursesRepo.getById(purchaseRow.courseId);
            const parentRow = usersRepo.rows.get(purchaseRow.parentUserId);

            if (!courseRow || !parentRow) {
                return Promise.resolve(null);
            }

            const courseEntity = new CourseEntity();
            Object.assign(courseEntity, courseRow);

            const parentEntity = new UserEntity();
            Object.assign(parentEntity, parentRow);

            const purchaseEntity = new PurchaseEntity();
            Object.assign(purchaseEntity, purchaseRow);
            purchaseEntity.course = courseEntity;
            purchaseEntity.parent = parentEntity;

            const invEntity = new InvitationEntity();
            Object.assign(invEntity, invRow);
            invEntity.purchase = purchaseEntity;

            return Promise.resolve(invEntity);
        }

        return Promise.resolve(null);
    };

    // Wire `findCourseIdByPurchaseId` to resolve from the in-memory purchases store.
    invitationsRepo.findCourseIdByPurchaseId = (_manager: EntityManager, purchaseId: number): Promise<number> => {
        const row = purchasesRepo.rows.get(purchaseId);

        if (!row) {
            return Promise.reject(new Error(`No purchase found for id=${purchaseId}`));
        }

        return Promise.resolve(row.courseId);
    };

    const usersService = new UsersService(usersRepo as unknown as UsersRepository);
    const dataSource = buildStubDataSource(purchasesRepo);

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
        controllers: [AppController, AuthController, CoursesController, PurchasesController, InvitationsController],
        providers: [
            AppService,
            AuthService,
            JwtStrategy,
            { provide: UsersRepository, useValue: usersRepo },
            { provide: UsersService, useValue: usersService },
            { provide: CoursesRepository, useValue: coursesRepo },
            CoursesService,
            { provide: InvitationsRepository, useValue: invitationsRepo },
            InvitationsService,
            { provide: EnrolmentsRepository, useValue: enrolmentsRepo },
            { provide: IdempotencyKeysRepository, useValue: new InMemoryIdempotencyKeysRepository() },
            IdempotencyService,
            { provide: PurchasesRepository, useValue: purchasesRepo },
            PurchasesService,
            { provide: DataSource, useValue: dataSource },
            { provide: RefreshTokensRepository, useClass: StubRefreshTokensRepository },
            { provide: getQueueToken(INVITATION_EMAIL_QUEUE), useValue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }) } },
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

    // createNestApplication() returns INestApplication<any> — the App generic is a supertest
    // opaque type that NestJS's generics cannot express at this boundary.

    const app: INestApplication<App> = moduleRef.createNestApplication();
    await app.init();

    return { app, usersRepo, purchasesRepo, invitationsRepo, enrolmentsRepo, coursesRepo };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(plaintext: string): string {
    return createHash(INVITATION_TOKEN_HASH_ALGORITHM).update(plaintext).digest('hex');
}

function randomToken(): string {
    return randomBytes(32).toString('base64url');
}

const VALID_REDEEM_BODY = {
    firstName: 'Alice',
    lastName: 'Smith',
    dateOfBirth: '2010-03-15',
    password: 'Secret1234',
};

/**
 * Seeds a PARENT user, a purchase, and a valid ISSUED invitation into the stores.
 * Returns the plaintext token so tests can pass it in the request body.
 */
async function seedValidInvitation(ctx: ITestContext, studentEmail = 'student@example.com'): Promise<string> {
    const parentRow = await ctx.usersRepo.insertUser({ email: 'parent@redeem.test', passwordHash: 'unused', role: UserRoleEnum.PARENT });
    const plaintext = randomToken();
    const tokenHash = hashToken(plaintext);
    const purchaseRow = await ctx.purchasesRepo.insertWithinTransaction({} as EntityManager, {
        parentUserId: parentRow.userId,
        courseId: 7,
        status: PurchaseStatusEnum.COMPLETED,
        amountPence: 19900,
        idempotencyKey: 'seed-idem-key',
    });
    await ctx.invitationsRepo.insertWithinTransaction({} as EntityManager, {
        purchaseId: purchaseRow.purchaseId,
        tokenHash,
        studentEmail,
        status: InvitationStatusEnum.ISSUED,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return plaintext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Redeem invitation (e2e)', () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    process.env.LOG_PRETTY = 'false';

    describe('POST /invitations/redeem', () => {
        it('happy path: valid token → 200 with accessToken + enrolment and invitation status REDEEMED', async () => {
            const ctx = await buildTestContext();
            const token = await seedValidInvitation(ctx, 'happystudent@example.com');

            const res = await request(ctx.app.getHttpServer())
                .post('/invitations/redeem')
                .send({ ...VALID_REDEEM_BODY, token })
                .expect(200);

            // expect.any() returns an AsymmetricMatcher typed as `any` at the jest boundary.

            expect(res.body as Record<string, unknown>).toMatchObject({
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                accessToken: expect.any(String),
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                expiresIn: expect.any(Number),
            });

            // Verify invitation was marked REDEEMED in the store.
            const updatedInvitation = await ctx.invitationsRepo.findByTokenHash(hashToken(token));
            expect(updatedInvitation?.status).toBe(InvitationStatusEnum.REDEEMED);
            expect(updatedInvitation?.redeemedAt).toBeInstanceOf(Date);

            // Verify an enrolment row was created.
            expect(ctx.enrolmentsRepo.rows.size).toBe(1);
            const enrolment = Array.from(ctx.enrolmentsRepo.rows.values())[0];
            expect(enrolment.courseId).toBe(7);

            await ctx.app.close();
        });

        it('unknown token → 410 INVITATION_NOT_FOUND', async () => {
            const ctx = await buildTestContext();
            const randomTokenValue = randomToken();

            const res = await request(ctx.app.getHttpServer())
                .post('/invitations/redeem')
                .send({ ...VALID_REDEEM_BODY, token: randomTokenValue })
                .expect(410);

            expect((res.body as IApiErrorResponse).code).toBe('INVITATION_NOT_FOUND');

            await ctx.app.close();
        });

        it('already-redeemed token → 410 INVITATION_ALREADY_REDEEMED on second call', async () => {
            const ctx = await buildTestContext();
            const token = await seedValidInvitation(ctx, 'twice@example.com');

            await request(ctx.app.getHttpServer())
                .post('/invitations/redeem')
                .send({ ...VALID_REDEEM_BODY, token })
                .expect(200);

            const res = await request(ctx.app.getHttpServer())
                .post('/invitations/redeem')
                .send({ ...VALID_REDEEM_BODY, token })
                .expect(410);

            expect((res.body as IApiErrorResponse).code).toBe('INVITATION_ALREADY_REDEEMED');

            await ctx.app.close();
        });

        it('email conflict: student email already registered → 410 INVITATION_EMAIL_CONFLICT', async () => {
            const ctx = await buildTestContext();
            const conflictEmail = 'conflict@example.com';
            const token = await seedValidInvitation(ctx, conflictEmail);

            // Pre-register a user with the same email the invitation targets.
            await ctx.usersRepo.insertUser({
                email: conflictEmail,
                passwordHash: 'unused',
                role: UserRoleEnum.STUDENT,
            });

            const res = await request(ctx.app.getHttpServer())
                .post('/invitations/redeem')
                .send({ ...VALID_REDEEM_BODY, token })
                .expect(410);

            expect((res.body as IApiErrorResponse).code).toBe('INVITATION_EMAIL_CONFLICT');

            await ctx.app.close();
        });

        it('expired token: pre-expired invitation → 410 INVITATION_EXPIRED', async () => {
            const ctx = await buildTestContext();
            const parentRow = await ctx.usersRepo.insertUser({ email: 'parent-exp@redeem.test', passwordHash: 'unused', role: UserRoleEnum.PARENT });
            const plaintext = randomToken();
            const tokenHash = hashToken(plaintext);
            const purchaseRow = await ctx.purchasesRepo.insertWithinTransaction({} as EntityManager, {
                parentUserId: parentRow.userId,
                courseId: 7,
                status: PurchaseStatusEnum.COMPLETED,
                amountPence: 19900,
                idempotencyKey: 'seed-exp-idem-key',
            });
            await ctx.invitationsRepo.insertWithinTransaction({} as EntityManager, {
                purchaseId: purchaseRow.purchaseId,
                tokenHash,
                studentEmail: 'expired@example.com',
                status: InvitationStatusEnum.ISSUED,
                expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
            });

            const res = await request(ctx.app.getHttpServer())
                .post('/invitations/redeem')
                .send({ ...VALID_REDEEM_BODY, token: plaintext })
                .expect(410);

            expect((res.body as IApiErrorResponse).code).toBe('INVITATION_EXPIRED');

            await ctx.app.close();
        });

        it('missing required fields in body → 400 VALIDATION_FAILED with field errors', async () => {
            const ctx = await buildTestContext();

            const res = await request(ctx.app.getHttpServer()).post('/invitations/redeem').send({}).expect(400);

            expect((res.body as IApiErrorResponse).code).toBe('VALIDATION_FAILED');

            await ctx.app.close();
        });

        it('password that fails policy (no uppercase) → 400 VALIDATION_FAILED', async () => {
            const ctx = await buildTestContext();
            const token = await seedValidInvitation(ctx, 'weakpw@example.com');

            const res = await request(ctx.app.getHttpServer())
                .post('/invitations/redeem')
                .send({ token, firstName: 'Bob', lastName: 'Jones', dateOfBirth: '2010-01-01', password: 'allowercase1' })
                .expect(400);

            expect((res.body as IApiErrorResponse).code).toBe('VALIDATION_FAILED');

            await ctx.app.close();
        });
    });

    describe('GET /invitations/:token/meta', () => {
        it('happy path: valid token → 200 with courseTitle, parentEmail, studentEmail, expiresAt', async () => {
            const ctx = await buildTestContext();
            const token = await seedValidInvitation(ctx, 'meta-student@example.com');

            const res = await request(ctx.app.getHttpServer())
                .get(`/invitations/${encodeURIComponent(token)}/meta`)
                .expect(200);

            expect(res.body as Record<string, unknown>).toMatchObject({
                courseTitle: 'Maths Year 7',
                parentEmail: 'parent@redeem.test',
                studentEmail: 'meta-student@example.com',
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                expiresAt: expect.any(String),
                status: InvitationStatusEnum.ISSUED,
            });

            await ctx.app.close();
        });

        it('unknown token → 410 INVITATION_NOT_FOUND', async () => {
            const ctx = await buildTestContext();
            const unknownToken = randomToken();

            const res = await request(ctx.app.getHttpServer())
                .get(`/invitations/${encodeURIComponent(unknownToken)}/meta`)
                .expect(410);

            expect((res.body as IApiErrorResponse).code).toBe('INVITATION_NOT_FOUND');

            await ctx.app.close();
        });
    });
});
