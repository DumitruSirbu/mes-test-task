/**
 * Generic paginated response wrapper. Wraps an array of items with pagination metadata.
 * Used by list endpoints to indicate total count and current page boundaries.
 */
export interface IPaginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
