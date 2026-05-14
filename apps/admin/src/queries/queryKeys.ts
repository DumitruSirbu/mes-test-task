/**
 * Centralised query key factory for TanStack Query.
 * All keys are tuples so partial invalidation (e.g. invalidate all parents) works correctly.
 */

export const adminQueryKeys = {
    parents: (page: number, limit: number) => ['admin', 'parents', { page, limit }] as const,
    students: (page: number, limit: number) => ['admin', 'students', { page, limit }] as const,
    purchases: (page: number, limit: number) => ['admin', 'purchases', { page, limit }] as const,
    courses: (page: number, limit: number) => ['admin', 'courses', { page, limit }] as const,
};
