import { CourseSubjectEnum } from '../enums/CourseSubjectEnum.js';

/**
 * Projection of a `courses` row returned by `GET /courses`.
 *
 * `pricePence` is the canonical money representation (minor units, integer) — the UI
 * is responsible for formatting (e.g., £199.00). Year range is inclusive on both ends.
 */
export interface ICourseResponse {
    id: number;
    subject: CourseSubjectEnum;
    yearFrom: number;
    yearTo: number;
    title: string;
    pricePence: number;
}
