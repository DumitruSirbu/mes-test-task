import { Injectable } from '@nestjs/common';
import type { ICourseResponse } from '@mes/shared';
import { CourseEntity } from '../entity/CourseEntity';
import { CoursesRepository } from '../repository/CoursesRepository';
import { CourseNotFoundError } from '../../common/error/CourseNotFoundError';

/**
 * Read-side service for the course catalog.
 *
 * Catalog is tiny (~30 rows) and read-mostly; no pagination in v1. The projection to
 * `ICourseResponse` lives here so the controller and any other consumer (purchases
 * service price snapshot path) share the same DTO mapping.
 */
@Injectable()
export class CoursesService {
    public constructor(private readonly coursesRepository: CoursesRepository) {}

    public async listAll(): Promise<ICourseResponse[]> {
        const rows = await this.coursesRepository.findAllOrdered();

        return rows.map((row) => this.toResponse(row));
    }

    public async findByIdOrThrow(courseId: number): Promise<CourseEntity> {
        const row = await this.coursesRepository.findById(courseId);

        if (!row) {
            throw new CourseNotFoundError({ courseId });
        }

        return row;
    }

    public async getById(courseId: number): Promise<ICourseResponse> {
        const row = await this.findByIdOrThrow(courseId);

        return this.toResponse(row);
    }

    private toResponse(row: CourseEntity): ICourseResponse {
        return {
            id: row.courseId,
            subject: row.subject,
            yearFrom: row.yearFrom,
            yearTo: row.yearTo,
            title: row.title,
            pricePence: row.pricePence,
        };
    }
}
