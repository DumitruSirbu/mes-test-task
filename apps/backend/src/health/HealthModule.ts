import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './controller/HealthController';
import { RedisHealthIndicator } from './indicator/RedisHealthIndicator';

/**
 * Liveness + readiness endpoints. `/health/live` is a process-up signal (no dependencies);
 * `/health/ready` pings Postgres and Redis and returns 503 if either is unreachable so a
 * load balancer pulls the instance from rotation.
 */
@Module({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [RedisHealthIndicator],
})
export class HealthModule {}
