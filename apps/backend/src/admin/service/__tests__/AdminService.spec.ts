import { Test, TestingModule } from '@nestjs/testing';
import { UserRoleEnum, PurchaseStatusEnum, CourseSubjectEnum } from '@mes/shared';
import { AdminService } from '../AdminService';
import { UsersRepository } from '../../../users/repository/UsersRepository';
import { PurchasesRepository } from '../../../purchases/repository/PurchasesRepository';
import { CoursesRepository } from '../../../courses/repository/CoursesRepository';
import { UserEntity } from '../../../users/entity/UserEntity';
import { PurchaseEntity } from '../../../purchases/entity/PurchaseEntity';
import { CourseEntity } from '../../../courses/entity/CourseEntity';
import { IAdminListRequest } from '../../interface/IAdminListRequest';

type UsersRepositoryMock = Pick<UsersRepository, 'findPaginatedByRole'>;
type PurchasesRepositoryMock = Pick<PurchasesRepository, 'findPaginated'>;
type CoursesRepositoryMock = Pick<CoursesRepository, 'findPaginated'>;

describe('AdminService', () => {
    let service: AdminService;

    const findPaginatedByRoleMock = jest.fn();
    const findPaginatedPurchasesMock = jest.fn();
    const findPaginatedCoursesMock = jest.fn();

    const buildParentEntity = (overrides?: Partial<UserEntity>): UserEntity => {
        const entity = new UserEntity();
        entity.userId = 1;
        entity.email = 'parent@mes.test';
        entity.role = UserRoleEnum.PARENT;
        entity.firstName = 'Ada';
        entity.lastName = 'Lovelace';
        entity.createdAt = new Date('2026-01-01T00:00:00Z');
        entity.updatedAt = new Date('2026-01-01T00:00:00Z');

        return Object.assign(entity, overrides ?? {});
    };

    const buildStudentEntity = (overrides?: Partial<UserEntity>): UserEntity => {
        const entity = new UserEntity();
        entity.userId = 2;
        entity.email = 'student@mes.test';
        entity.role = UserRoleEnum.STUDENT;
        entity.firstName = 'Alan';
        entity.lastName = 'Turing';
        entity.dateOfBirth = '2010-06-23';
        entity.createdAt = new Date('2026-02-01T00:00:00Z');
        entity.updatedAt = new Date('2026-02-01T00:00:00Z');

        return Object.assign(entity, overrides ?? {});
    };

    const buildPurchaseEntity = (): PurchaseEntity => {
        const entity = new PurchaseEntity();
        entity.purchaseId = 10;
        entity.parentUserId = 1;
        entity.courseId = 7;
        entity.status = PurchaseStatusEnum.COMPLETED;
        entity.amountPence = 19900;
        entity.idempotencyKey = 'idem-12345678';
        entity.createdAt = new Date('2026-03-01T00:00:00Z');
        entity.updatedAt = new Date('2026-03-01T00:00:00Z');

        return entity;
    };

    const buildCourseEntity = (): CourseEntity => {
        const entity = new CourseEntity();
        entity.courseId = 7;
        entity.title = 'Maths Year 7';
        entity.subject = CourseSubjectEnum.MATHS;
        entity.yearFrom = 7;
        entity.yearTo = 7;
        entity.pricePence = 19900;
        entity.createdAt = new Date('2025-12-01T00:00:00Z');

        return entity;
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const usersRepositoryMock: UsersRepositoryMock = {
            findPaginatedByRole: findPaginatedByRoleMock,
        };

        const purchasesRepositoryMock: PurchasesRepositoryMock = {
            findPaginated: findPaginatedPurchasesMock,
        };

        const coursesRepositoryMock: CoursesRepositoryMock = {
            findPaginated: findPaginatedCoursesMock,
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                AdminService,
                { provide: UsersRepository, useValue: usersRepositoryMock },
                { provide: PurchasesRepository, useValue: purchasesRepositoryMock },
                { provide: CoursesRepository, useValue: coursesRepositoryMock },
            ],
        }).compile();

        service = moduleRef.get(AdminService);
    });

    const ACTOR_ID = 99;
    const defaultRequest = (overrides?: Partial<IAdminListRequest>): IAdminListRequest => ({
        page: 1,
        limit: 20,
        actorId: ACTOR_ID,
        ...overrides,
    });

    describe('listParents', () => {
        it('returns IPaginated shape with mapped parent rows', async () => {
            const parent = buildParentEntity();
            findPaginatedByRoleMock.mockResolvedValue([[parent], 1]);

            const result = await service.listParents(defaultRequest());

            expect(result).toEqual({
                data: [
                    {
                        id: parent.userId,
                        email: parent.email,
                        firstName: parent.firstName,
                        lastName: parent.lastName,
                        createdAt: parent.createdAt.toISOString(),
                    },
                ],
                total: 1,
                page: 1,
                limit: 20,
            });
            expect(findPaginatedByRoleMock).toHaveBeenCalledWith(UserRoleEnum.PARENT, 0, 20);
        });

        it('passes correct skip offset for page 2', async () => {
            findPaginatedByRoleMock.mockResolvedValue([[], 50]);

            await service.listParents(defaultRequest({ page: 2 }));

            expect(findPaginatedByRoleMock).toHaveBeenCalledWith(UserRoleEnum.PARENT, 20, 20);
        });

        it('returns empty data array and correct total when no parents exist', async () => {
            findPaginatedByRoleMock.mockResolvedValue([[], 0]);

            const result = await service.listParents(defaultRequest());

            expect(result.data).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('maps null firstName and lastName to null', async () => {
            const parent = buildParentEntity({ firstName: null, lastName: null });
            findPaginatedByRoleMock.mockResolvedValue([[parent], 1]);

            const result = await service.listParents(defaultRequest());

            expect(result.data[0].firstName).toBeNull();
            expect(result.data[0].lastName).toBeNull();
        });
    });

    describe('listStudents', () => {
        it('returns IPaginated shape with mapped student rows including dateOfBirth', async () => {
            const student = buildStudentEntity();
            findPaginatedByRoleMock.mockResolvedValue([[student], 1]);

            const result = await service.listStudents(defaultRequest({ limit: 10 }));

            expect(result).toEqual({
                data: [
                    {
                        id: student.userId,
                        email: student.email,
                        firstName: student.firstName,
                        lastName: student.lastName,
                        dateOfBirth: student.dateOfBirth,
                        createdAt: student.createdAt.toISOString(),
                    },
                ],
                total: 1,
                page: 1,
                limit: 10,
            });
            expect(findPaginatedByRoleMock).toHaveBeenCalledWith(UserRoleEnum.STUDENT, 0, 10);
        });

        it('maps null dateOfBirth to null', async () => {
            const student = buildStudentEntity({ dateOfBirth: undefined });
            findPaginatedByRoleMock.mockResolvedValue([[student], 1]);

            const result = await service.listStudents(defaultRequest());

            expect(result.data[0].dateOfBirth).toBeNull();
        });
    });

    describe('listPurchases', () => {
        it('returns IPaginated shape with mapped purchase rows', async () => {
            const purchase = buildPurchaseEntity();
            findPaginatedPurchasesMock.mockResolvedValue([[purchase], 1]);

            const result = await service.listPurchases(defaultRequest());

            expect(result).toEqual({
                data: [
                    {
                        id: purchase.purchaseId,
                        parentId: purchase.parentUserId,
                        courseId: purchase.courseId,
                        status: PurchaseStatusEnum.COMPLETED,
                        amountPence: purchase.amountPence,
                        createdAt: purchase.createdAt.toISOString(),
                    },
                ],
                total: 1,
                page: 1,
                limit: 20,
            });
            expect(findPaginatedPurchasesMock).toHaveBeenCalledWith(0, 20);
        });
    });

    describe('listCourses', () => {
        it('returns IPaginated shape with mapped course rows', async () => {
            const course = buildCourseEntity();
            findPaginatedCoursesMock.mockResolvedValue([[course], 1]);

            const result = await service.listCourses(defaultRequest());

            expect(result).toEqual({
                data: [
                    {
                        id: course.courseId,
                        title: course.title,
                        subject: CourseSubjectEnum.MATHS,
                        yearFrom: course.yearFrom,
                        yearTo: course.yearTo,
                        pricePence: course.pricePence,
                        createdAt: course.createdAt.toISOString(),
                    },
                ],
                total: 1,
                page: 1,
                limit: 20,
            });
            expect(findPaginatedCoursesMock).toHaveBeenCalledWith(0, 20);
        });
    });
});
