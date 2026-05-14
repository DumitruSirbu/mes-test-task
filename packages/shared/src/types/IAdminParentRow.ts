/**
 * Wire-format shape for a single parent user row returned by the admin API.
 * Dates are ISO strings as serialised by the HTTP layer.
 */
export interface IAdminParentRow {
    id: number;
    email: string;
    firstName: string | null;
    lastName: string | null;
    createdAt: string;
}
