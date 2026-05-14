import { Injectable, Logger } from '@nestjs/common';
import type { ICourseResponse, ICourseWithLessonsResponse, ILessonResponse } from '@mes/shared';
import { CourseEntity } from '../../courses/entity/CourseEntity';
import { LessonEntity } from '../entity/LessonEntity';
import { LessonsRepository } from '../repository/LessonsRepository';
import { EnrolmentsRepository } from '../../enrolments/repository/EnrolmentsRepository';
import { EnrolmentEntity } from '../../enrolments/entity/EnrolmentEntity';
import { NotEnrolledError } from '../../common/error/NotEnrolledError';
import { LessonNotFoundError } from '../../common/error/LessonNotFoundError';
import { DataIntegrityError } from '../../common/error/DataIntegrityError';

/**
 * Business logic for the LMS lesson access layer.
 *
 * Enrolment enforcement is the core invariant: every method that returns
 * course or lesson data first verifies the requesting student holds an active
 * enrolment. Failure returns `NotEnrolledError` (403) so callers cannot probe
 * course existence via status-code differences.
 *
 * `findLessonById` deliberately collapses "lesson not found" and "not enrolled"
 * into the same 403 response — preventing UUID enumeration via HTTP status codes.
 */
@Injectable()
export class LessonsService {
    private readonly logger = new Logger(LessonsService.name);

    public constructor(
        private readonly lessonsRepository: LessonsRepository,
        private readonly enrolmentsRepository: EnrolmentsRepository,
    ) {}

    public async findEnrolledCoursesForUser(userId: number): Promise<ICourseResponse[]> {
        const courses = await this.enrolmentsRepository.findCoursesForStudent(userId);

        return courses.map((course) => this.toCourseResponse(course));
    }

    public async findLessonsForCourse(userId: number, courseId: number): Promise<ICourseWithLessonsResponse> {
        const enrolment = await this.assertEnrolled(userId, courseId);
        const lessons = await this.lessonsRepository.findByCourseId(courseId);

        this.logger.log(`Student userId=${userId} fetched lessons for courseId=${courseId} count=${lessons.length}`);

        if (!enrolment.course) {
            // Data-integrity guard: `assertEnrolled` always loads the course relation, so
            // this branch can only fire if there is a DB inconsistency (orphaned enrolment).
            // Throw a generic error rather than NotEnrolledError to avoid a misleading 403.
            throw new DataIntegrityError(`Enrolment for userId=${userId} courseId=${courseId} has no course relation — data integrity violation.`, {
                userId,
                courseId,
            });
        }

        return {
            ...this.toCourseResponse(enrolment.course),
            lessons: lessons.map((l) => this.toLessonResponse(l)),
        };
    }

    public async findLessonById(userId: number, lessonId: string): Promise<ILessonResponse> {
        let lesson: LessonEntity;

        try {
            lesson = await this.lessonsRepository.findByIdOrFail(lessonId);
        } catch (error) {
            if (error instanceof LessonNotFoundError) {
                // Collapse "lesson not found" into the same 403 as "not enrolled" to prevent
                // UUID enumeration: a caller must not be able to distinguish the two cases.
                // Use only the caller-supplied lessonId — never the server-derived courseId.
                throw new NotEnrolledError({ userId, lessonId });
            }

            throw error;
        }

        try {
            await this.assertEnrolled(userId, lesson.courseId);
        } catch (error) {
            if (error instanceof NotEnrolledError) {
                // Re-throw with lessonId only, discarding the server-derived courseId that
                // assertEnrolled would otherwise include in details — prevents enumeration.
                throw new NotEnrolledError({ userId, lessonId });
            }

            throw error;
        }

        this.logger.log(`Student userId=${userId} fetched lessonId=${lessonId}`);

        return this.toLessonResponse(lesson);
    }

    /**
     * Verifies the student is enrolled in the given course and returns the enrolment
     * with the `course` relation populated. Throws `NotEnrolledError` if not enrolled.
     */
    private async assertEnrolled(userId: number, courseId: number): Promise<EnrolmentEntity> {
        const enrolment = await this.enrolmentsRepository.findByStudentAndCourseWithCourse(userId, courseId);

        if (!enrolment) {
            throw new NotEnrolledError({ userId, courseId });
        }

        return enrolment;
    }

    private toCourseResponse(course: CourseEntity): ICourseResponse {
        return {
            id: course.courseId,
            subject: course.subject,
            yearFrom: course.yearFrom,
            yearTo: course.yearTo,
            title: course.title,
            pricePence: course.pricePence,
        };
    }

    private toLessonResponse(lesson: LessonEntity): ILessonResponse {
        return {
            id: lesson.lessonId,
            courseId: lesson.courseId,
            title: lesson.title,
            body: lesson.body,
            orderIndex: lesson.orderIndex,
            createdAt: lesson.createdAt.toISOString(),
        };
    }
}
