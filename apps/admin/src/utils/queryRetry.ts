/**
 * Standard TanStack Query retry callback for admin pages.
 * Skips retries on 4xx client errors; allows up to 2 retries on transient failures.
 */
export const adminQueryRetry = (failureCount: number, err: unknown): boolean => {
    if (err instanceof Error && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
        const status = (err as { status: number }).status;
        if (status >= 400 && status < 500) return false;
    }
    return failureCount < 2;
};
