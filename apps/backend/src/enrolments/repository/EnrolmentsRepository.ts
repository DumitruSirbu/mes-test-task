import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { BaseRepository } from '../../common/repository/BaseRepository';
import { EnrolmentEntity } from '../entity/EnrolmentEntity';
import { EnrolmentAlreadyExistsError } from '../../common/error/EnrolmentAlreadyExistsError';
import { PG_UNIQUE_VIOLATION } from '../../auth/const/AuthConsts';
import { CourseEntity } from '../../courses/entity/CourseEntity';

interface IInsertEnrolmentParams {
    studentUserId: number;
    courseId: number;
    sourceInvitationId: number;
}

/**
 * Repository for `enrolments`. Exposes only intention-revealing queries.
 *
 * `insertWithinTransaction` accepts an `EntityManager` so the user creation + enrolment
 * insert can participate in the same TypeORM transaction as invitation redemption
 * (atomic multi-write per ADR 0006).
 */
@Injectable()
export class EnrolmentsRepository extends BaseRepository<EnrolmentEntity> {
    public constructor(@InjectRepository(EnrolmentEntity) repository: Repository<EnrolmentEntity>) {
        super(repository);
    }

    /**
     * Return all `CourseEntity` rows for which the given student holds an active enrolment.
     * Used by `LessonsService` to populate the LMS dashboard and enforce access control.
     */
    public async findCoursesForStudent(studentUserId: number): Promise<CourseEntity[]> {
        const enrolments = await this.findAll({
            where: { studentUserId },
            relations: ['course'],
            order: { courseId: 'ASC' },
        });

        return enrolments.map((e) => e.course).filter((c): c is CourseEntity => c !== undefined);
    }

    /**
     * Return a single enrolment linking the given student to the given course, or null.
     * Used by `LessonsService` to guard per-lesson access (no course relation needed).
     */
    public async findByStudentAndCourse(studentUserId: number, courseId: number): Promise<EnrolmentEntity | null> {
        return this.findOne({ studentUserId, courseId });
    }

    /**
     * Return a single enrolment with the `course` relation eagerly loaded, or null.
     * Used by `LessonsService.assertEnrolled` so that the loaded course can be reused
     * for building the response — eliminating a second DB round-trip.
     */
    public async findByStudentAndCourseWithCourse(studentUserId: number, courseId: number): Promise<EnrolmentEntity | null> {
        return this.findOneWithRelations({ studentUserId, courseId }, ['course']);
    }

    public async insertWithinTransaction(manager: EntityManager, params: IInsertEnrolmentParams): Promise<EnrolmentEntity> {
        const entity = manager.create(EnrolmentEntity, {
            studentUserId: params.studentUserId,
            courseId: params.courseId,
            sourceInvitationId: params.sourceInvitationId,
        });

        try {
            return await manager.save(EnrolmentEntity, entity);
        } catch (error) {
            if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
                throw new EnrolmentAlreadyExistsError(error);
            }

            throw error;
        }
    }
}
