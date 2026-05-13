import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_PING_TIMEOUT_MS } from '../const/HealthConsts';

/**
 * Lazy Redis ping indicator. A single shared client is created on first probe; subsequent
 * probes reuse it. `lazyConnect: true` prevents the client from crashing the app on boot
 * when Redis is briefly unavailable — the connection is established on the first ping.
 *
 * Each `pingCheck` call races the `PING` command against a REDIS_PING_TIMEOUT_MS deadline
 * so a stalled Redis (TCP connected but not responding) is also caught within a predictable
 * bound. Uses the Terminus v11 `HealthIndicatorService` API — the deprecated
 * `HealthIndicator` base class and `HealthCheckError` are not used.
 */
@Injectable()
export class RedisHealthIndicator {
    private client: Redis | null = null;

    public constructor(
        private readonly configService: ConfigService,
        private readonly healthIndicatorService: HealthIndicatorService,
    ) {}

    public async pingCheck(key: string): Promise<HealthIndicatorResult> {
        const session = this.healthIndicatorService.check(key);

        try {
            const client = this.getClient();
            const reply = await this.pingWithTimeout(client);

            if (reply !== 'PONG') {
                return session.down({ reply });
            }

            return session.up({ reply });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown';

            return session.down({ error: message });
        }
    }

    private async pingWithTimeout(client: Redis): Promise<string> {
        let timerId: ReturnType<typeof setTimeout> | undefined;

        const timeoutPromise = new Promise<never>((_, reject) => {
            timerId = setTimeout(() => reject(new Error(`Redis ping timed out after ${REDIS_PING_TIMEOUT_MS} ms`)), REDIS_PING_TIMEOUT_MS);
        });

        try {
            return await Promise.race([client.ping(), timeoutPromise]);
        } finally {
            // Always cancel the timer so it does not keep the event loop alive when
            // the ping() wins the race before the deadline fires.
            clearTimeout(timerId);
        }
    }

    private getClient(): Redis {
        if (this.client) {
            return this.client;
        }

        this.client = new Redis({
            host: this.configService.get<string>('REDIS_HOST') ?? 'localhost',
            port: Number(this.configService.get<string>('REDIS_PORT') ?? 6379),
            password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            connectTimeout: REDIS_PING_TIMEOUT_MS,
        });
        // Swallow connection errors here; the next ping() will raise them with context.
        this.client.on('error', () => undefined);

        return this.client;
    }
}
