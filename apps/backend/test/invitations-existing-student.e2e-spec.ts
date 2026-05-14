/**
 * e2e specs for the "existing student redeems a second invitation" flow.
 *
 * Design: purchase always issues an ISSUED invitation. When the targeted student email
 * already has an account, the REDEEM step handles it:
 *   - Correct password + STUDENT role: enrol and issue JWT (no new account created).
 *   - Wrong password + STUDENT role: 410 INVITATION_EMAIL_CONFLICT.
 *   - Non-STUDENT role (PARENT): 410 INVITATION_EMAIL_CONFLICT.
 *   - Duplicate enrolment (same course redeemed twice): idempotent, no 500.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHash, randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import { CourseSubjectEnum, InvitationStatusEnum, PurchaseStatusEnum, UserRoleEnum } from '@mes/shared';
import type { IApiErrorResponse, IAuthTokenResponse } from '@mes/shared';

import { INVITATION_TOKEN_HASH_ALGORITHM } from '../src/invitations/const/InvitationsConsts';
import { ARGON2_MEMORY_COST, ARGON2_TIME_COST, ARGON2_PARALLELISM } from '../src/auth/const/AuthConsts';
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
import { EnrolmentAlreadyExistsError } from '../src/common/error/EnrolmentAlreadyExistsError';
import { IdempotencyService } from '../src/common/idempotency/service/IdempotencyService';
import { IdempotencyKeysRepository } from '../src/common/idempotency/repository/IdempotencyKeysRepository';
import { IdempotencyKeyEntity } from '../src/common/idempotency/entity/IdempotencyKeyEntity';
import { IdempotencyInterceptor } from '../src/common/idempotency/interceptor/IdempotencyInterceptor';
import { INVITATION_EMAIL_QUEUE } from '../src/notifications/const/NotificationsConsts';
import { RefreshTokensRepository } from '../src/auth/repository/RefreshTokensRepository';

// ---------------------------------------------------------------------------
// In-memory stores — each test gets a fresh context via buildTestContext().
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
        this.rows.set(8, {
            courseId: 8,
            subject: CourseSubjectEnum.SCIENCE,
            yearFrom: 7,
            yearTo: 7,
            title: 'Science Year 7',
            pricePence: 14900,
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

    public existsCompletedForParentCourseAndStudent(): Promise<boolean> {
        return Promise.resolve(false);
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

        return Promise.resolve(this.toEntity(row));
    }

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public findByTokenHashWithRelations(_tokenHash: string): Promise<InvitationEntity | null> {
        return Promise.resolve(null);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public findCourseIdByPurchaseId(_manager: EntityManager, _purchaseId: number): Promise<number> {
        return Promise.reject(new Error('findCourseIdByPurchaseId not wired in this test context'));
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

/**
 * In-memory EnrolmentsRepository that mirrors the real repo's unique-constraint behaviour:
 * a duplicate (studentUserId, courseId) throws `EnrolmentAlreadyExistsError`.
 */
class InMemoryEnrolmentsRepository {
    public readonly rows = new Map<number, IEnrolmentRow>();
    private nextId = 1;

    public insertWithinTransaction(_manager: EntityManager, input: Partial<EnrolmentEntity>): Promise<EnrolmentEntity> {
        for (const row of this.rows.values()) {
            if (row.studentUserId === input.studentUserId && row.courseId === input.courseId) {
                throw new EnrolmentAlreadyExistsError();
            }
        }

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

    public findCoursesForStudent(studentUserId: number): Promise<CourseEntity[]> {
        const courseIds = Array.from(this.rows.values())
            .filter((row) => row.studentUserId === studentUserId)
            .map((row) => row.courseId);

        return Promise.resolve(
            courseIds.map((id) => {
                const entity = new CourseEntity();
                entity.courseId = id;

                return entity;
            }),
        );
    }

    public findByStudentAndCourse(studentUserId: number, courseId: number): Promise<EnrolmentEntity | null> {
        for (const row of this.rows.values()) {
            if (row.studentUserId === studentUserId && row.courseId === courseId) {
                return Promise.resolve(Object.assign(new EnrolmentEntity(), row));
            }
        }

        return Promise.resolve(null);
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
        const existing = Array.from(this.rows.values()).find((row) => row.userId === input.userId && row.endpoint === input.endpoint && row.key === input.key);

        if (existing) {
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

class StubRefreshTokensRepository {
    public async insertNew(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Stub DataSource — passes the manager through; no real DB needed.
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

// ---------------------------------------------------------------------------
// Test context factory
// ---------------------------------------------------------------------------

interface ITestContext {
    app: INestApplication<App>;
    jwtService: JwtService;
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
    const idemRepo = new InMemoryIdempotencyKeysRepository();

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
            { provide: IdempotencyKeysRepository, useValue: idemRepo },
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

    const app: INestApplication<App> = moduleRef.createNestApplication();
    await app.init();
    const jwtService = moduleRef.get(JwtService);

    return { app, jwtService, usersRepo, purchasesRepo, invitationsRepo, enrolmentsRepo, coursesRepo };
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

/**
 * Produces an argon2id hash using the same parameters as InvitationsService/AuthService
 * so in-memory test users have a verifiable passwordHash.
 */
async function makePasswordHash(password: string): Promise<string> {
    return argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: ARGON2_MEMORY_COST,
        timeCost: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
    });
}

/**
 * Seeds a purchase + ISSUED invitation for the given student email and course.
 * Returns the plaintext token so the test can submit it to POST /invitations/redeem.
 */
async function seedIssuedInvitation(ctx: ITestContext, opts: { parentUserId: number; courseId: number; studentEmail: string }): Promise<string> {
    const plaintext = randomToken();
    const tokenHash = hashToken(plaintext);

    const purchaseRow = await ctx.purchasesRepo.insertWithinTransaction({} as EntityManager, {
        parentUserId: opts.parentUserId,
        courseId: opts.courseId,
        status: PurchaseStatusEnum.COMPLETED,
        amountPence: 19900,
        idempotencyKey: `seed-${Math.random()}`,
    });

    await ctx.invitationsRepo.insertWithinTransaction({} as EntityManager, {
        purchaseId: purchaseRow.purchaseId,
        tokenHash,
        studentEmail: opts.studentEmail,
        status: InvitationStatusEnum.ISSUED,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return plaintext;
}

/**
 * Extracts the base64url token from an invitation URL of the form
 * `http://localhost:5173/#/onboard/<encoded-token>`.
 */
function extractTokenFromUrl(url: string): string {
    const encoded = url.split('/').pop() ?? '';

    return decodeURIComponent(encoded);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Invitations -- existing-student redeem (e2e)', () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    process.env.LOG_PRETTY = 'false';

    /**
     * Scenario 1: full happy path.
     *   - Parent buys course A: student (new) redeems.
     *   - Parent buys course B: API returns ISSUED invitation URL.
     *   - Student submits /invitations/redeem with EXISTING password: 200 JWT.
     *   - Both enrolments present; second invitation is REDEEMED.
     */
    it('existing student with correct password redeems second invitation: 200 JWT, both courses enrolled, invitation REDEEMED', async () => {
        const ctx = await buildTestContext();
        const studentEmail = 'student-existing@redeem.test';
        const studentPassword = 'ValidPass99';

        const parent = await ctx.usersRepo.insertUser({ email: 'parent-a@redeem.test', passwordHash: 'unused', role: UserRoleEnum.PARENT });
        const parentToken = ctx.jwtService.sign({ sub: parent.userId, role: UserRoleEnum.PARENT }, { expiresIn: '15m' });

        // Parent buys course 7 — capture invitation URL from the response.
        const firstPurchaseRes = await request(ctx.app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${parentToken}`)
            .set('Idempotency-Key', 'idem-existing-course7')
            .send({ courseId: 7, studentEmail })
            .expect(201);

        const firstPlaintext = extractTokenFromUrl((firstPurchaseRes.body as { invitation: { url: string } }).invitation.url);

        // Student redeems the first invitation (new account created).
        const firstRedeemRes = await request(ctx.app.getHttpServer())
            .post('/invitations/redeem')
            .send({ token: firstPlaintext, firstName: 'Alice', lastName: 'Smith', dateOfBirth: '2010-03-15', password: studentPassword })
            .expect(200);

        expect(firstRedeemRes.body as Record<string, unknown>).toHaveProperty('accessToken');
        expect(ctx.enrolmentsRepo.rows.size).toBe(1);

        // Parent buys course 8 for the same student email — invitation is ISSUED.
        const secondPurchaseRes = await request(ctx.app.getHttpServer())
            .post('/purchases')
            .set('Authorization', `Bearer ${parentToken}`)
            .set('Idempotency-Key', 'idem-existing-course8')
            .send({ courseId: 8, studentEmail })
            .expect(201);

        expect((secondPurchaseRes.body as { invitation: { status: string } }).invitation.status).toBe(InvitationStatusEnum.ISSUED);

        const secondPlaintext = extractTokenFromUrl((secondPurchaseRes.body as { invitation: { url: string } }).invitation.url);

        // Student redeems the second invitation with existing password.
        // firstName/lastName/dateOfBirth are IGNORED for existing accounts.
        const secondRedeemRes = await request(ctx.app.getHttpServer())
            .post('/invitations/redeem')
            .send({ token: secondPlaintext, firstName: 'Ignored', lastName: 'Ignored', dateOfBirth: '1900-01-01', password: studentPassword })
            .expect(200);

        const secondAuth = secondRedeemRes.body as IAuthTokenResponse;
        expect(typeof secondAuth.accessToken).toBe('string');

        // Student must be enrolled in both courses.
        expect(ctx.enrolmentsRepo.rows.size).toBe(2);
        const enrolledCourseIds = Array.from(ctx.enrolmentsRepo.rows.values()).map((row) => row.courseId);
        expect(enrolledCourseIds).toContain(7);
        expect(enrolledCourseIds).toContain(8);

        // Both invitations must be REDEEMED.
        const redeemedCount = Array.from(ctx.invitationsRepo.rows.values()).filter((row) => row.status === InvitationStatusEnum.REDEEMED).length;
        expect(redeemedCount).toBe(2);

        await ctx.app.close();
    });

    /**
     * Scenario 2: existing student with WRONG password.
     */
    it('existing student with WRONG password redeems second invitation: 410 INVITATION_EMAIL_CONFLICT', async () => {
        const ctx = await buildTestContext();
        const studentEmail = 'student-wrong-pw@redeem.test';
        const correctPassword = 'CorrectPass99';
        const wrongPassword = 'WrongPass99';

        const parent = await ctx.usersRepo.insertUser({ email: 'parent-b@redeem.test', passwordHash: 'unused', role: UserRoleEnum.PARENT });

        // Seed and redeem the first invitation so the student account exists.
        const firstToken = await seedIssuedInvitation(ctx, { parentUserId: parent.userId, courseId: 7, studentEmail });

        await request(ctx.app.getHttpServer())
            .post('/invitations/redeem')
            .send({ token: firstToken, firstName: 'Bob', lastName: 'Jones', dateOfBirth: '2010-01-01', password: correctPassword })
            .expect(200);

        // Seed a second invitation for course 8.
        const secondToken = await seedIssuedInvitation(ctx, { parentUserId: parent.userId, courseId: 8, studentEmail });

        // Submit with the WRONG password.
        const res = await request(ctx.app.getHttpServer())
            .post('/invitations/redeem')
            .send({ token: secondToken, firstName: 'Bob', lastName: 'Jones', dateOfBirth: '2010-01-01', password: wrongPassword })
            .expect(410);

        expect((res.body as IApiErrorResponse).code).toBe('INVITATION_EMAIL_CONFLICT');

        // Only one enrolment should exist (from the first redemption).
        expect(ctx.enrolmentsRepo.rows.size).toBe(1);

        await ctx.app.close();
    });

    /**
     * Scenario 3: the student email belongs to a PARENT user.
     */
    it('student email belongs to a PARENT user: 410 INVITATION_EMAIL_CONFLICT', async () => {
        const ctx = await buildTestContext();

        // Seed a user with PARENT role at the targeted student email.
        const parentEmailUser = await ctx.usersRepo.insertUser({
            email: 'parent-as-student@redeem.test',
            passwordHash: await makePasswordHash('SomePass99'),
            role: UserRoleEnum.PARENT,
        });

        const buyer = await ctx.usersRepo.insertUser({ email: 'buyer@redeem.test', passwordHash: 'unused', role: UserRoleEnum.PARENT });

        const token = await seedIssuedInvitation(ctx, {
            parentUserId: buyer.userId,
            courseId: 7,
            studentEmail: parentEmailUser.email,
        });

        const res = await request(ctx.app.getHttpServer())
            .post('/invitations/redeem')
            .send({ token, firstName: 'Any', lastName: 'Any', dateOfBirth: '2000-01-01', password: 'SomePass99' })
            .expect(410);

        expect((res.body as IApiErrorResponse).code).toBe('INVITATION_EMAIL_CONFLICT');

        // No enrolment must be created.
        expect(ctx.enrolmentsRepo.rows.size).toBe(0);

        await ctx.app.close();
    });

    /**
     * Scenario 4: idempotency — parent buys the same course twice for an existing student,
     * each yielding a separate ISSUED invitation. Both are redeemed. Second redeem must NOT
     * fail with 500; the duplicate enrolment is swallowed. Student ends up with exactly one
     * enrolment for that course.
     */
    it('duplicate course redemption for existing student is idempotent: second redeem 200, enrolment count stays 1', async () => {
        const ctx = await buildTestContext();
        const studentEmail = 'student-dup@redeem.test';
        const password = 'DupPass99';

        const parent = await ctx.usersRepo.insertUser({ email: 'parent-dup@redeem.test', passwordHash: 'unused', role: UserRoleEnum.PARENT });

        // First invitation for course 7: student creates account.
        const firstToken = await seedIssuedInvitation(ctx, { parentUserId: parent.userId, courseId: 7, studentEmail });

        await request(ctx.app.getHttpServer())
            .post('/invitations/redeem')
            .send({ token: firstToken, firstName: 'Carol', lastName: 'White', dateOfBirth: '2011-06-01', password })
            .expect(200);

        expect(ctx.enrolmentsRepo.rows.size).toBe(1);

        // Second invitation for the SAME course 7 (parent buys again).
        const secondToken = await seedIssuedInvitation(ctx, { parentUserId: parent.userId, courseId: 7, studentEmail });

        // Second redeem with existing password: duplicate enrolment must be swallowed, not 500.
        const secondRes = await request(ctx.app.getHttpServer())
            .post('/invitations/redeem')
            .send({ token: secondToken, firstName: 'Carol', lastName: 'White', dateOfBirth: '2011-06-01', password })
            .expect(200);

        // Must still return a JWT (student is logged in).
        const secondAuth = secondRes.body as IAuthTokenResponse;
        expect(typeof secondAuth.accessToken).toBe('string');

        // Enrolment count must remain 1 -- no duplicate row inserted.
        expect(ctx.enrolmentsRepo.rows.size).toBe(1);

        await ctx.app.close();
    });
});
