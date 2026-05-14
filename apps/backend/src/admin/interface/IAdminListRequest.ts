/**
 * Parameters passed to every AdminService list method.
 * Collapses three positional args into one object to satisfy the ≤2-arg convention.
 */
export interface IAdminListRequest {
    page: number;
    limit: number;
    actorId: number;
}
