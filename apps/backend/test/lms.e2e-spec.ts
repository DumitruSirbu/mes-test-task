import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import { CourseSubjectEnum, InvitationStatusEnum, PurchaseStatusEnum, UserRoleEnum } from '@mes/shared';
import type { IApiErrorResponse, ICourseResponse, ICourseWithLessonsResponse, ILessonResponse } from '@mes/shared';

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
import { CoursesController } from '../src/courses/controller/CoursesController';
import { CoursesService } from '../src/courses/service/CoursesService';
import { CoursesRepository } from '../src/courses/repository/CoursesRepository';
import { CourseEntity } from '../src/courses/entity/CourseEntity';
import { InvitationsService } from '../src/invitations/service/InvitationsService';
import { InvitationsRepository } from '../src/invitations/repository/InvitationsRepository';
import { InvitationEntity } from '../src/invitations/entity/InvitationEntity';
import { EnrolmentsRepository } from '../src/enrolments/repository/EnrolmentsRepository';
import { EnrolmentEntity } from '../src/enrolments/entity/EnrolmentEntity';
import { IdempotencyService } from '../src/common/idempotency/service/IdempotencyService';
import { IdempotencyKeysRepository } from '../src/common/idempotency/repository/IdempotencyKeysRepository';
import { IdempotencyKeyEntity } from '../src/common/idempotency/entity/IdempotencyKeyEntity';
import { IdempotencyInterceptor } from '../src/common/idempotency/interceptor/IdempotencyInterceptor';
import { PurchasesController } from '../src/purchases/controller/PurchasesController';
import { PurchasesService } from '../src/purchases/service/PurchasesService';
import { PurchasesRepository } from '../src/purchases/repository/PurchasesRepository';
import { PurchaseEntity } from '../src/purchases/entity/PurchaseEntity';
import { LessonsController } from '../src/lessons/controller/LessonsController';
import { LessonsService } from '../src/lessons/service/LessonsService';
import { LessonsRepository } from '../src/lessons/repository/LessonsRepository';
import { LessonEntity } from '../src/lessons/entity/LessonEntity';
import { LessonNotFoundError } from '../src/common/error/LessonNotFoundError';
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
    public readonly rows = new Map<number, ICourseRow>();

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
            subject: CourseSubjectEnum.MATHS,
            yearFrom: 8,
            yearTo: 8,
            title: 'Maths Year 8',
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

    public listByParent(): Promise<PurchaseEntity[]> {
        return Promise.resolve([]);
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

        return Promise.resolve(Object.assign(new InvitationEntity(), row));
    }

    public atomicRedeem(): Promise<InvitationEntity | null> {
        return Promise.resolve(null);
    }

    public findByTokenHash(): Promise<InvitationEntity | null> {
        return Promise.resolve(null);
    }

    public findByTokenHashWithRelations(): Promise<InvitationEntity | null> {
        return Promise.resolve(null);
    }

    public findCourseIdByPurchaseId(): Promise<number> {
        return Promise.reject(new Error('not wired'));
    }

    public findByPurchaseId(): Promise<InvitationEntity | null> {
        return Promise.resolve(null);
    }

    public findManyByPurchaseIds(): Promise<InvitationEntity[]> {
        return Promise.resolve([]);
    }
}

interface IEnrolmentRow {
    enrolmentId: number;
    studentUserId: number;
    courseId: number;
    sourceInvitationId: number | null;
    course?: CourseEntity;
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

    /**
     * Mimics `EnrolmentsRepository.findCoursesForStudent`: returns `CourseEntity[]`
     * by joining the `course` attached to each enrolment row.
     */
    public findCoursesForStudent(studentUserId: number): Promise<CourseEntity[]> {
        const courses: CourseEntity[] = [];

        for (const row of this.rows.values()) {
            if (row.studentUserId === studentUserId && row.course) {
                courses.push(row.course);
            }
        }

        return Promise.resolve(courses);
    }

    /**
     * Mimics `EnrolmentsRepository.findByStudentAndCourse`.
     */
    public findByStudentAndCourse(studentUserId: number, courseId: number): Promise<EnrolmentEntity | null> {
        for (const row of this.rows.values()) {
            if (row.studentUserId === studentUserId && row.courseId === courseId) {
                return Promise.resolve(Object.assign(new EnrolmentEntity(), row));
            }
        }

        return Promise.resolve(null);
    }

    /**
     * Mimics `EnrolmentsRepository.findByStudentAndCourseWithCourse` — returns the enrolment
     * with the `course` relation populated, mirroring TypeORM `relations: ['course']`.
     */
    public findByStudentAndCourseWithCourse(studentUserId: number, courseId: number): Promise<EnrolmentEntity | null> {
        for (const row of this.rows.values()) {
            if (row.studentUserId === studentUserId && row.courseId === courseId) {
                return Promise.resolve(Object.assign(new EnrolmentEntity(), row));
            }
        }

        return Promise.resolve(null);
    }

    /**
     * Seeds an enrolment row with the resolved `CourseEntity` attached,
     * mirroring the TypeORM `relations: ['course']` eager load.
     */
    public seedEnrolment(studentUserId: number, courseEntity: CourseEntity): EnrolmentEntity {
        const row: IEnrolmentRow = {
            enrolmentId: this.nextId++,
            studentUserId,
            courseId: courseEntity.courseId,
            sourceInvitationId: null,
            course: courseEntity,
            createdAt: new Date(),
        };
        this.rows.set(row.enrolmentId, row);

        return Object.assign(new EnrolmentEntity(), row);
    }
}

interface ILessonRow {
    lessonId: string;
    courseId: number;
    title: string;
    body: string;
    orderIndex: number;
    createdAt: Date;
}

class InMemoryLessonsRepository {
    public readonly rows = new Map<string, ILessonRow>();

    public findByCourseId(courseId: number): Promise<LessonEntity[]> {
        const matches = Array.from(this.rows.values())
            .filter((row) => row.courseId === courseId)
            .sort((a, b) => a.orderIndex - b.orderIndex);

        return Promise.resolve(matches.map((row) => this.toEntity(row)));
    }

    public findByIdOrFail(lessonId: string): Promise<LessonEntity> {
        const row = this.rows.get(lessonId);

        if (!row) {
            throw new LessonNotFoundError({ lessonId });
        }

        return Promise.resolve(this.toEntity(row));
    }

    public seedLesson(courseId: number, overrides: Partial<ILessonRow> = {}): LessonEntity {
        const lessonId = overrides.lessonId ?? `${courseId}-${Date.now()}-${Math.random()}`;
        const row: ILessonRow = {
            lessonId,
            courseId,
            title: overrides.title ?? `Lesson ${lessonId}`,
            body: overrides.body ?? 'Lesson body content.',
            orderIndex: overrides.orderIndex ?? 1,
            createdAt: overrides.createdAt ?? new Date(),
        };
        this.rows.set(row.lessonId, row);

        return this.toEntity(row);
    }

    private toEntity(row: ILessonRow): LessonEntity {
        const entity = new LessonEntity();
        Object.assign(entity, row);

        return entity;
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

class StubDataSource {
    public async transaction<T>(runInTransaction: (manager: EntityManager) => Promise<T>): Promise<T> {
        return runInTransaction({} as EntityManager);
    }
}

class StubRefreshTokensRepository {
    public async insertNew(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Test context factory
// ---------------------------------------------------------------------------

interface ITestContext {
    app: INestApplication<App>;
    jwtService: JwtService;
    usersRepo: InMemoryUsersRepository;
    coursesRepo: InMemoryCoursesRepository;
    enrolmentsRepo: InMemoryEnrolmentsRepository;
    lessonsRepo: InMemoryLessonsRepository;
}

const TEST_JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxxx';

async function buildTestContext(): Promise<ITestContext> {
    const usersRepo = new InMemoryUsersRepository();
    const coursesRepo = new InMemoryCoursesRepository();
    coursesRepo.seedDefault();

    const purchasesRepo = new InMemoryPurchasesRepository();
    const invitationsRepo = new InMemoryInvitationsRepository();
    const enrolmentsRepo = new InMemoryEnrolmentsRepository();
    const lessonsRepo = new InMemoryLessonsRepository();

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
        controllers: [AppController, AuthController, CoursesController, PurchasesController, LessonsController],
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
            { provide: LessonsRepository, useValue: lessonsRepo },
            LessonsService,
            { provide: IdempotencyKeysRepository, useValue: new InMemoryIdempotencyKeysRepository() },
            IdempotencyService,
            { provide: PurchasesRepository, useValue: purchasesRepo },
            PurchasesService,
            { provide: DataSource, useClass: StubDataSource },
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

    return { app, jwtService, usersRepo, coursesRepo, enrolmentsRepo, lessonsRepo };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCourseEntityFrom(row: {
    courseId: number;
    subject: CourseSubjectEnum;
    yearFrom: number;
    yearTo: number;
    title: string;
    pricePence: number;
    createdAt: Date;
}): CourseEntity {
    const entity = new CourseEntity();
    Object.assign(entity, row);

    return entity;
}

const COURSE_7_FIXTURE = {
    courseId: 7,
    subject: CourseSubjectEnum.MATHS,
    yearFrom: 7,
    yearTo: 7,
    title: 'Maths Year 7',
    pricePence: 19900,
    createdAt: new Date('2026-05-13T10:00:00Z'),
};

const COURSE_8_FIXTURE = {
    courseId: 8,
    subject: CourseSubjectEnum.MATHS,
    yearFrom: 8,
    yearTo: 8,
    title: 'Maths Year 8',
    pricePence: 19900,
    createdAt: new Date('2026-05-13T10:00:00Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LMS endpoints (e2e)', () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    process.env.LOG_PRETTY = 'false';

    // -------------------------------------------------------------------------
    // GET /me/courses
    // -------------------------------------------------------------------------

    describe('GET /me/courses', () => {
        it('unauthenticated request → 401 AUTH_MISSING_TOKEN', async () => {
            const ctx = await buildTestContext();

            const res = await request(ctx.app.getHttpServer()).get('/me/courses').expect(401);

            expect((res.body as IApiErrorResponse).code).toBe('AUTH_MISSING_TOKEN');

            await ctx.app.close();
        });

        it('authenticated PARENT → 403 AUTH_FORBIDDEN_ROLE', async () => {
            const ctx = await buildTestContext();
            const parent = await ctx.usersRepo.insertUser({ email: 'parent@lms.test', passwordHash: 'x', role: UserRoleEnum.PARENT });
            const token = ctx.jwtService.sign({ sub: parent.userId, role: UserRoleEnum.PARENT }, { expiresIn: '15m' });

            const res = await request(ctx.app.getHttpServer()).get('/me/courses').set('Authorization', `Bearer ${token}`).expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('AUTH_FORBIDDEN_ROLE');

            await ctx.app.close();
        });

        it('authenticated STUDENT with no enrolments → 200 with empty array', async () => {
            const ctx = await buildTestContext();
            const student = await ctx.usersRepo.insertUser({ email: 'nostudent@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const token = ctx.jwtService.sign({ sub: student.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            const res = await request(ctx.app.getHttpServer()).get('/me/courses').set('Authorization', `Bearer ${token}`).expect(200);

            expect(res.body as ICourseResponse[]).toEqual([]);

            await ctx.app.close();
        });

        it('authenticated STUDENT with one enrolment → 200 with the enrolled course', async () => {
            const ctx = await buildTestContext();
            const student = await ctx.usersRepo.insertUser({ email: 'onecourse@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const courseEntity = buildCourseEntityFrom(COURSE_7_FIXTURE);
            ctx.enrolmentsRepo.seedEnrolment(student.userId, courseEntity);
            const token = ctx.jwtService.sign({ sub: student.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            const res = await request(ctx.app.getHttpServer()).get('/me/courses').set('Authorization', `Bearer ${token}`).expect(200);

            const courses = res.body as ICourseResponse[];
            expect(courses).toHaveLength(1);
            expect(courses[0].id).toBe(7);
            expect(courses[0].title).toBe('Maths Year 7');

            await ctx.app.close();
        });
    });

    // -------------------------------------------------------------------------
    // GET /courses/:id/lessons
    // -------------------------------------------------------------------------

    describe('GET /courses/:id/lessons', () => {
        it('student NOT enrolled in the course → 403 NOT_ENROLLED', async () => {
            const ctx = await buildTestContext();
            const student = await ctx.usersRepo.insertUser({ email: 'notenrolled@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const token = ctx.jwtService.sign({ sub: student.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            const res = await request(ctx.app.getHttpServer()).get('/courses/7/lessons').set('Authorization', `Bearer ${token}`).expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');

            await ctx.app.close();
        });

        it('enrolled student → 200 with lessons sorted by orderIndex ascending', async () => {
            const ctx = await buildTestContext();
            const student = await ctx.usersRepo.insertUser({ email: 'enrolled@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const courseEntity = buildCourseEntityFrom(COURSE_7_FIXTURE);
            ctx.enrolmentsRepo.seedEnrolment(student.userId, courseEntity);

            ctx.lessonsRepo.seedLesson(7, { lessonId: 'aaaaaaaa-0000-0000-0000-000000000002', title: 'Lesson 2', orderIndex: 2 });
            ctx.lessonsRepo.seedLesson(7, { lessonId: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'Lesson 1', orderIndex: 1 });
            ctx.lessonsRepo.seedLesson(7, { lessonId: 'aaaaaaaa-0000-0000-0000-000000000003', title: 'Lesson 3', orderIndex: 3 });

            const token = ctx.jwtService.sign({ sub: student.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            const res = await request(ctx.app.getHttpServer()).get('/courses/7/lessons').set('Authorization', `Bearer ${token}`).expect(200);

            const body = res.body as ICourseWithLessonsResponse;
            expect(body.id).toBe(7);
            expect(body.title).toBe('Maths Year 7');
            expect(body.lessons).toHaveLength(3);
            expect(body.lessons[0].orderIndex).toBe(1);
            expect(body.lessons[1].orderIndex).toBe(2);
            expect(body.lessons[2].orderIndex).toBe(3);

            await ctx.app.close();
        });

        it('non-existent course id → 403 NOT_ENROLLED (does not reveal existence)', async () => {
            const ctx = await buildTestContext();
            const student = await ctx.usersRepo.insertUser({ email: 'probe@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const token = ctx.jwtService.sign({ sub: student.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            const res = await request(ctx.app.getHttpServer()).get('/courses/99999/lessons').set('Authorization', `Bearer ${token}`).expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');

            await ctx.app.close();
        });

        it('unauthenticated request → 401 AUTH_MISSING_TOKEN', async () => {
            const ctx = await buildTestContext();

            const res = await request(ctx.app.getHttpServer()).get('/courses/7/lessons').expect(401);

            expect((res.body as IApiErrorResponse).code).toBe('AUTH_MISSING_TOKEN');

            await ctx.app.close();
        });
    });

    // -------------------------------------------------------------------------
    // GET /lessons/:id
    // -------------------------------------------------------------------------

    describe('GET /lessons/:id', () => {
        it('non-existent lesson UUID → 403 NOT_ENROLLED (does not reveal existence)', async () => {
            const ctx = await buildTestContext();
            const student = await ctx.usersRepo.insertUser({ email: 'lessonprobe@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const token = ctx.jwtService.sign({ sub: student.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            const missingId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

            const res = await request(ctx.app.getHttpServer()).get(`/lessons/${missingId}`).set('Authorization', `Bearer ${token}`).expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');

            await ctx.app.close();
        });

        it('student NOT enrolled in the lesson course → 403 NOT_ENROLLED', async () => {
            const ctx = await buildTestContext();

            // Seed a lesson for course 7 but do NOT enrol the student.
            const lesson = ctx.lessonsRepo.seedLesson(7, {
                lessonId: 'bbbbbbbb-0000-0000-0000-000000000001',
                orderIndex: 1,
            });

            const student = await ctx.usersRepo.insertUser({ email: 'unenrolledlesson@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const token = ctx.jwtService.sign({ sub: student.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            const res = await request(ctx.app.getHttpServer()).get(`/lessons/${lesson.lessonId}`).set('Authorization', `Bearer ${token}`).expect(403);

            expect((res.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');

            await ctx.app.close();
        });

        it('enrolled student → 200 with lesson data', async () => {
            const ctx = await buildTestContext();
            const student = await ctx.usersRepo.insertUser({ email: 'enrolledlesson@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const courseEntity = buildCourseEntityFrom(COURSE_7_FIXTURE);
            ctx.enrolmentsRepo.seedEnrolment(student.userId, courseEntity);

            const lesson = ctx.lessonsRepo.seedLesson(7, {
                lessonId: 'cccccccc-0000-0000-0000-000000000001',
                title: 'Introduction',
                body: 'Welcome to Maths Year 7.',
                orderIndex: 1,
            });

            const token = ctx.jwtService.sign({ sub: student.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            const res = await request(ctx.app.getHttpServer()).get(`/lessons/${lesson.lessonId}`).set('Authorization', `Bearer ${token}`).expect(200);

            const body = res.body as ILessonResponse;
            expect(body.id).toBe(lesson.lessonId);
            expect(body.title).toBe('Introduction');
            expect(body.body).toBe('Welcome to Maths Year 7.');
            expect(body.orderIndex).toBe(1);
            expect(body.courseId).toBe(7);

            await ctx.app.close();
        });

        it('unauthenticated request → 401 AUTH_MISSING_TOKEN', async () => {
            const ctx = await buildTestContext();

            const res = await request(ctx.app.getHttpServer()).get('/lessons/cccccccc-0000-0000-0000-000000000001').expect(401);

            expect((res.body as IApiErrorResponse).code).toBe('AUTH_MISSING_TOKEN');

            await ctx.app.close();
        });

        it('details shape is identical (only userId + lessonId) for fake vs real-but-unenrolled lesson UUID (enumeration prevention)', async () => {
            // Fix A verification: both the "lesson not found" and "not enrolled" branches
            // must produce the same error shape with only caller-supplied identifiers.
            // Neither must leak the server-derived courseId so a caller cannot enumerate courses.
            const ctx = await buildTestContext();
            const student = await ctx.usersRepo.insertUser({ email: 'enumprobe@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const token = ctx.jwtService.sign({ sub: student.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            // Seed a real lesson for course 7 but do NOT enrol the student.
            const realLesson = ctx.lessonsRepo.seedLesson(7, {
                lessonId: 'ffffffff-0000-0000-0000-000000000001',
                orderIndex: 1,
            });

            const fakeId = 'ffffffff-ffff-ffff-ffff-000000000002';

            // (a) Probe a fake lesson UUID — lesson does not exist at all.
            const resA = await request(ctx.app.getHttpServer()).get(`/lessons/${fakeId}`).set('Authorization', `Bearer ${token}`).expect(403);

            // (b) Probe a real lesson UUID from a course the student is NOT enrolled in.
            const resB = await request(ctx.app.getHttpServer()).get(`/lessons/${realLesson.lessonId}`).set('Authorization', `Bearer ${token}`).expect(403);

            // Both must carry the same code and message.
            expect((resA.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');
            expect((resB.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');
            expect((resA.body as IApiErrorResponse).message).toBe((resB.body as IApiErrorResponse).message);

            // Both details must contain exactly the keys { userId, lessonId } — never courseId.
            // Values will differ (different probed UUIDs) but the key set must be the same.
            const detailsA = (resA.body as IApiErrorResponse).details;
            const detailsB = (resB.body as IApiErrorResponse).details;

            expect(detailsA).toBeDefined();
            expect(detailsB).toBeDefined();
            expect(Object.keys(detailsA!).sort()).toEqual(['lessonId', 'userId']);
            expect(Object.keys(detailsB!).sort()).toEqual(['lessonId', 'userId']);

            // Neither response must leak the server-derived courseId.
            expect(detailsA).not.toHaveProperty('courseId');
            expect(detailsB).not.toHaveProperty('courseId');

            await ctx.app.close();
        });
    });

    // -------------------------------------------------------------------------
    // Cross-tenant isolation
    // -------------------------------------------------------------------------

    describe('Cross-tenant isolation', () => {
        it('student A cannot read lessons for a course only student B is enrolled in', async () => {
            const ctx = await buildTestContext();

            const studentA = await ctx.usersRepo.insertUser({ email: 'student-a@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const studentB = await ctx.usersRepo.insertUser({ email: 'student-b@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });

            // Enrol B in course 7, A in course 8.
            const course7Entity = buildCourseEntityFrom(COURSE_7_FIXTURE);
            const course8Entity = buildCourseEntityFrom(COURSE_8_FIXTURE);
            ctx.enrolmentsRepo.seedEnrolment(studentB.userId, course7Entity);
            ctx.enrolmentsRepo.seedEnrolment(studentA.userId, course8Entity);

            // Seed lessons for both courses.
            ctx.lessonsRepo.seedLesson(7, { lessonId: 'dddddddd-0000-0000-0000-000000000001', orderIndex: 1 });
            ctx.lessonsRepo.seedLesson(8, { lessonId: 'dddddddd-0000-0000-0000-000000000002', orderIndex: 1 });

            const tokenA = ctx.jwtService.sign({ sub: studentA.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            // A tries to get lessons for course 7 (only B is enrolled) → 403.
            const lessonsRes = await request(ctx.app.getHttpServer()).get('/courses/7/lessons').set('Authorization', `Bearer ${tokenA}`).expect(403);

            expect((lessonsRes.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');

            // A tries to read a specific lesson from course 7 → 403.
            const lessonRes = await request(ctx.app.getHttpServer())
                .get('/lessons/dddddddd-0000-0000-0000-000000000001')
                .set('Authorization', `Bearer ${tokenA}`)
                .expect(403);

            expect((lessonRes.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');

            await ctx.app.close();
        });

        it('student B cannot read lessons for a course only student A is enrolled in', async () => {
            const ctx = await buildTestContext();

            const studentA = await ctx.usersRepo.insertUser({ email: 'cross-a@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });
            const studentB = await ctx.usersRepo.insertUser({ email: 'cross-b@lms.test', passwordHash: 'x', role: UserRoleEnum.STUDENT });

            const course8Entity = buildCourseEntityFrom(COURSE_8_FIXTURE);
            ctx.enrolmentsRepo.seedEnrolment(studentA.userId, course8Entity);

            ctx.lessonsRepo.seedLesson(8, { lessonId: 'eeeeeeee-0000-0000-0000-000000000001', orderIndex: 1 });

            const tokenB = ctx.jwtService.sign({ sub: studentB.userId, role: UserRoleEnum.STUDENT }, { expiresIn: '15m' });

            // B tries to get lessons for course 8 (only A is enrolled) → 403.
            const lessonsRes = await request(ctx.app.getHttpServer()).get('/courses/8/lessons').set('Authorization', `Bearer ${tokenB}`).expect(403);

            expect((lessonsRes.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');

            // B tries to read a specific lesson from course 8 → 403.
            const lessonRes = await request(ctx.app.getHttpServer())
                .get('/lessons/eeeeeeee-0000-0000-0000-000000000001')
                .set('Authorization', `Bearer ${tokenB}`)
                .expect(403);

            expect((lessonRes.body as IApiErrorResponse).code).toBe('NOT_ENROLLED');

            await ctx.app.close();
        });
    });
});
