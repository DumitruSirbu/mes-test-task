import { Injectable, Logger } from '@nestjs/common';
import { IPaginated, UserRoleEnum } from '@mes/shared';
import { UsersRepository } from '../../users/repository/UsersRepository';
import { PurchasesRepository } from '../../purchases/repository/PurchasesRepository';
import { CoursesRepository } from '../../courses/repository/CoursesRepository';
import { UserEntity } from '../../users/entity/UserEntity';
import { PurchaseEntity } from '../../purchases/entity/PurchaseEntity';
import { CourseEntity } from '../../courses/entity/CourseEntity';
import { IAdminListRequest } from '../interface/IAdminListRequest';
import { IAdminParentRow } from '../interface/IAdminParentRow';
import { IAdminStudentRow } from '../interface/IAdminStudentRow';
import { IAdminPurchaseRow } from '../interface/IAdminPurchaseRow';
import { IAdminCourseRow } from '../interface/IAdminCourseRow';

/**
 * Read-only admin service. Delegates paginated queries to the owning repositories
 * and maps entities to admin-facing response shapes. No writes occur here.
 */
@Injectable()
export class AdminService {
    private readonly logger = new Logger(AdminService.name);

    public constructor(
        private readonly usersRepository: UsersRepository,
        private readonly purchasesRepository: PurchasesRepository,
        private readonly coursesRepository: CoursesRepository,
    ) {}

    public async listParents(request: IAdminListRequest): Promise<IPaginated<IAdminParentRow>> {
        return this.paginate(
            'parents',
            request,
            (skip, take) => this.usersRepository.findPaginatedByRole(UserRoleEnum.PARENT, skip, take),
            (u) => this.toParentRow(u),
        );
    }

    public async listStudents(request: IAdminListRequest): Promise<IPaginated<IAdminStudentRow>> {
        return this.paginate(
            'students',
            request,
            (skip, take) => this.usersRepository.findPaginatedByRole(UserRoleEnum.STUDENT, skip, take),
            (u) => this.toStudentRow(u),
        );
    }

    public async listPurchases(request: IAdminListRequest): Promise<IPaginated<IAdminPurchaseRow>> {
        return this.paginate(
            'purchases',
            request,
            (skip, take) => this.purchasesRepository.findPaginated(skip, take),
            (p) => this.toPurchaseRow(p),
        );
    }

    public async listCourses(request: IAdminListRequest): Promise<IPaginated<IAdminCourseRow>> {
        return this.paginate(
            'courses',
            request,
            (skip, take) => this.coursesRepository.findPaginated(skip, take),
            (c) => this.toCourseRow(c),
        );
    }

    private async paginate<TEntity, TRow>(
        label: string,
        request: IAdminListRequest,
        fetcher: (skip: number, take: number) => Promise<[TEntity[], number]>,
        mapper: (entity: TEntity) => TRow,
    ): Promise<IPaginated<TRow>> {
        const { page, limit, actorId } = request;
        const skip = (page - 1) * limit;
        const [rows, total] = await fetcher(skip, limit);

        this.logger.log(`Admin listed ${label} page=${page} limit=${limit} total=${total} actorId=${actorId}`);

        return { data: rows.map(mapper), total, page, limit };
    }

    private toParentRow(user: UserEntity): IAdminParentRow {
        return {
            id: user.userId,
            email: user.email,
            firstName: user.firstName ?? null,
            lastName: user.lastName ?? null,
            createdAt: user.createdAt.toISOString(),
        };
    }

    private toStudentRow(user: UserEntity): IAdminStudentRow {
        return {
            id: user.userId,
            email: user.email,
            firstName: user.firstName ?? null,
            lastName: user.lastName ?? null,
            dateOfBirth: user.dateOfBirth ?? null,
            createdAt: user.createdAt.toISOString(),
        };
    }

    private toPurchaseRow(purchase: PurchaseEntity): IAdminPurchaseRow {
        return {
            id: purchase.purchaseId,
            parentId: purchase.parentUserId,
            courseId: purchase.courseId,
            status: purchase.status,
            amountPence: purchase.amountPence,
            createdAt: purchase.createdAt.toISOString(),
        };
    }

    private toCourseRow(course: CourseEntity): IAdminCourseRow {
        return {
            id: course.courseId,
            title: course.title,
            subject: course.subject,
            yearFrom: course.yearFrom,
            yearTo: course.yearTo,
            pricePence: course.pricePence,
            createdAt: course.createdAt.toISOString(),
        };
    }
}
