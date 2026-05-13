import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe } from '@nestjs/common';
import type { ICourseResponse, ICourseWithLessonsResponse, ILessonResponse } from '@mes/shared';
import { UserRoleEnum } from '@mes/shared';
import { Roles } from '../../auth/decorator/Roles';
import { CurrentUser } from '../../auth/decorator/CurrentUser';
import type { IAuthenticatedUser } from '@mes/shared';
import { LessonsService } from '../service/LessonsService';
import { COURSE_LESSONS_ROUTE, LESSON_BY_ID_ROUTE, ME_COURSES_ROUTE } from '../const';

/**
 * LMS read endpoints — all restricted to the STUDENT role.
 *
 * Three distinct URL patterns span different prefixes so no shared `@Controller` prefix
 * is used. Every handler enforces enrolment via `LessonsService`; unenrolled access
 * returns 403 (not 404) to prevent course-ID enumeration.
 */
@Controller()
export class LessonsController {
    public constructor(private readonly lessonsService: LessonsService) {}

    @Roles(UserRoleEnum.STUDENT)
    @Get(ME_COURSES_ROUTE)
    public async listEnrolledCourses(@CurrentUser() user: IAuthenticatedUser): Promise<ICourseResponse[]> {
        return this.lessonsService.findEnrolledCoursesForUser(user.id);
    }

    @Roles(UserRoleEnum.STUDENT)
    @Get(COURSE_LESSONS_ROUTE)
    public async listLessonsForCourse(
        @CurrentUser() user: IAuthenticatedUser,
        @Param('id', ParseIntPipe) courseId: number,
    ): Promise<ICourseWithLessonsResponse> {
        return this.lessonsService.findLessonsForCourse(user.id, courseId);
    }

    @Roles(UserRoleEnum.STUDENT)
    @Get(LESSON_BY_ID_ROUTE)
    public async getLesson(@CurrentUser() user: IAuthenticatedUser, @Param('id', ParseUUIDPipe) lessonId: string): Promise<ILessonResponse> {
        return this.lessonsService.findLessonById(user.id, lessonId);
    }
}
