import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';
import { Public } from '../../auth/decorator/Public';
import { RedisHealthIndicator } from '../indicator/RedisHealthIndicator';
import { DB_PING_TIMEOUT_MS } from '../const/HealthConsts';

/**
 * `GET /health/live` — process is up; no I/O.
 * `GET /health/ready` — process is ready to serve traffic; pings Postgres and Redis.
 *
 * Both are `@Public()` (no token required) so a load balancer / orchestrator can probe them.
 */
@Controller('health')
export class HealthController {
    public constructor(
        private readonly health: HealthCheckService,
        private readonly db: TypeOrmHealthIndicator,
        private readonly redis: RedisHealthIndicator,
    ) {}

    @Public()
    @Get('live')
    @HealthCheck()
    public async live(): Promise<HealthCheckResult> {
        return this.health.check([]);
    }

    @Public()
    @Get('ready')
    @HealthCheck()
    public async ready(): Promise<HealthCheckResult> {
        return this.health.check([() => this.db.pingCheck('postgres', { timeout: DB_PING_TIMEOUT_MS }), () => this.redis.pingCheck('redis')]);
    }
}
