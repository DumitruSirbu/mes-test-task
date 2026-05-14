import { z } from 'zod';

/**
 * Pagination query parameters validator. Coerces strings (from query params) to numbers,
 * applies sensible defaults (page 1, limit 20), and constrains ranges.
 * Reusable across all paginated list endpoints.
 */
export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
