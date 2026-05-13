import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { LessonEntity } from '../entity/LessonEntity';
import { LessonNotFoundError } from '../../common/error/LessonNotFoundError';

/**
 * Concrete repository for `lessons`. Only exposes intention-revealing queries;
 * the raw TypeORM repository is encapsulated by `BaseRepository`.
 */
@Injectable()
export class LessonsRepository extends BaseRepository<LessonEntity> {
    public constructor(@InjectRepository(LessonEntity) repository: Repository<LessonEntity>) {
        super(repository);
    }

    public async findByCourseId(courseId: number): Promise<LessonEntity[]> {
        return this.findAll({
            where: { courseId },
            order: { orderIndex: 'ASC' },
        });
    }

    public async findByIdOrFail(lessonId: string): Promise<LessonEntity> {
        const lesson = await this.findOne({ lessonId });

        if (!lesson) {
            throw new LessonNotFoundError({ lessonId });
        }

        return lesson;
    }
}
