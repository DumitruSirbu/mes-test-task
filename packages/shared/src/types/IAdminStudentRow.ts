/**
 * Wire-format shape for a single student user row returned by the admin API.
 * Dates are ISO strings as serialised by the HTTP layer.
 */
export interface IAdminStudentRow {
    id: number;
    email: string;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    createdAt: string;
}
