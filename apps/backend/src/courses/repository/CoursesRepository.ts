import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { CourseEntity } from '../entity/CourseEntity';

/**
 * Concrete repository for `courses`. Only exposes intention-revealing queries —
 * the raw TypeORM repository stays encapsulated by `BaseRepository`.
 */
@Injectable()
export class CoursesRepository extends BaseRepository<CourseEntity> {
    public constructor(@InjectRepository(CourseEntity) repository: Repository<CourseEntity>) {
        super(repository);
    }

    public async findAllOrdered(): Promise<CourseEntity[]> {
        return this.findAll({ order: { subject: 'ASC', yearFrom: 'ASC' } });
    }

    /**
     * Return a page of courses ordered by created_at DESC.
     * Used by the admin list endpoint.
     */
    public async findPaginated(skip: number, take: number): Promise<[CourseEntity[], number]> {
        return this.repository.findAndCount({
            order: { createdAt: 'DESC' },
            skip,
            take,
        });
    }

    public async findById(courseId: number): Promise<CourseEntity | null> {
        return this.findOne({ courseId });
    }
}
