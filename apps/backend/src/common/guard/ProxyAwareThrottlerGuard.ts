import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler guard that resolves the rate-limit bucket key from:
 *   1. The authenticated user's id (when a JWT user is present) — keeps admin
 *      traffic isolated from the shared public IP bucket.
 *   2. The first X-Forwarded-For hop — correct when running behind Docker / ingress
 *      where the socket IP is always the proxy address.
 *   3. `req.ip` as the last resort for direct-exposure deploys.
 *
 * Registered as the global APP_GUARD throttler in AppModule, replacing the stock
 * ThrottlerGuard which keys off the raw socket IP only.
 */
@Injectable()
export class ProxyAwareThrottlerGuard extends ThrottlerGuard {
    protected override async getTracker(req: Record<string, unknown>): Promise<string> {
        const user = req['user'] as { id?: number } | undefined;

        if (user?.id !== undefined) {
            return `user:${user.id}`;
        }

        const xForwardedFor = req['headers'] as Record<string, string | string[] | undefined> | undefined;
        const forwarded = xForwardedFor?.['x-forwarded-for'];

        if (forwarded) {
            const firstHop = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
            const trimmed = firstHop?.trim();

            if (trimmed) {
                return trimmed;
            }
        }

        return (req['ip'] as string | undefined) ?? 'unknown';
    }
}
