import { Controller, Get, Query } from '@nestjs/common';
import { UserRoleEnum, IPaginated, paginationSchema } from '@mes/shared';
import type { PaginationInput, IAuthenticatedUser } from '@mes/shared';
import { Roles } from '../../auth/decorator/Roles';
import { CurrentUser } from '../../auth/decorator/CurrentUser';
import { ZodValidationPipe } from '../../common/pipe/ZodValidationPipe';
import { AdminService } from '../service/AdminService';
import { IAdminParentRow } from '../interface/IAdminParentRow';
import { IAdminStudentRow } from '../interface/IAdminStudentRow';
import { IAdminPurchaseRow } from '../interface/IAdminPurchaseRow';
import { IAdminCourseRow } from '../interface/IAdminCourseRow';

/**
 * Admin-only read endpoints. All routes are protected by the global `JwtAuthGuard`
 * and `RolesGuard` — `@Roles(ADMIN)` restricts access to admin accounts only.
 * No `@UseGuards` needed; guards are wired globally in `AppModule`.
 *
 * Query params are validated via `ZodValidationPipe(paginationSchema)` which delegates
 * to the canonical schema in `@mes/shared` — single source of truth for pagination bounds.
 */
@Controller('admin')
@Roles(UserRoleEnum.ADMIN)
export class AdminController {
    public constructor(private readonly adminService: AdminService) {}

    @Get('parents')
    public async listParents(
        @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
        @CurrentUser() actor: IAuthenticatedUser,
    ): Promise<IPaginated<IAdminParentRow>> {
        return this.adminService.listParents({ page: query.page, limit: query.limit, actorId: actor.id });
    }

    @Get('students')
    public async listStudents(
        @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
        @CurrentUser() actor: IAuthenticatedUser,
    ): Promise<IPaginated<IAdminStudentRow>> {
        return this.adminService.listStudents({ page: query.page, limit: query.limit, actorId: actor.id });
    }

    @Get('purchases')
    public async listPurchases(
        @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
        @CurrentUser() actor: IAuthenticatedUser,
    ): Promise<IPaginated<IAdminPurchaseRow>> {
        return this.adminService.listPurchases({ page: query.page, limit: query.limit, actorId: actor.id });
    }

    @Get('courses')
    public async listCourses(
        @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
        @CurrentUser() actor: IAuthenticatedUser,
    ): Promise<IPaginated<IAdminCourseRow>> {
        return this.adminService.listCourses({ page: query.page, limit: query.limit, actorId: actor.id });
    }
}
