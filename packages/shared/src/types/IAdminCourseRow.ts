import { CourseSubjectEnum } from '../enums/CourseSubjectEnum.js';

/**
 * Wire-format shape for a single course row returned by the admin API.
 * Dates are ISO strings as serialised by the HTTP layer.
 */
export interface IAdminCourseRow {
    id: number;
    title: string;
    subject: CourseSubjectEnum;
    yearFrom: number;
    yearTo: number;
    pricePence: number;
    createdAt: string;
}
