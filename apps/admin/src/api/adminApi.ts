import type { IPaginated, IAdminCourseRow, IAdminParentRow, IAdminPurchaseRow, IAdminStudentRow } from '@mes/shared';
import { apiRequest } from './apiClient';

export interface IPaginationParams {
    page: number;
    limit: number;
}

const buildPaginatedPath = (base: string, params: IPaginationParams): string =>
    `${base}?page=${params.page}&limit=${params.limit}`;

export const fetchParents = (params: IPaginationParams, token: string): Promise<IPaginated<IAdminParentRow>> =>
    apiRequest<IPaginated<IAdminParentRow>>(buildPaginatedPath('/admin/parents', params), { token });

export const fetchStudents = (params: IPaginationParams, token: string): Promise<IPaginated<IAdminStudentRow>> =>
    apiRequest<IPaginated<IAdminStudentRow>>(buildPaginatedPath('/admin/students', params), { token });

export const fetchPurchases = (params: IPaginationParams, token: string): Promise<IPaginated<IAdminPurchaseRow>> =>
    apiRequest<IPaginated<IAdminPurchaseRow>>(buildPaginatedPath('/admin/purchases', params), { token });

export const fetchCourses = (params: IPaginationParams, token: string): Promise<IPaginated<IAdminCourseRow>> =>
    apiRequest<IPaginated<IAdminCourseRow>>(buildPaginatedPath('/admin/courses', params), { token });
