import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthCheckError } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ClsRequestModule } from '../src/common/cls/ClsRequestModule';
import { LoggerModule } from '../src/common/logger/LoggerModule';
import { HealthController } from '../src/health/controller/HealthController';
import { RedisHealthIndicator } from '../src/health/indicator/RedisHealthIndicator';
import { JwtAuthGuard } from '../src/auth/guard/JwtAuthGuard';
import { RolesGuard } from '../src/auth/guard/RolesGuard';

/**
 * `/health/ready` returns 503 when Postgres is unreachable.
 *
 * Real terminus + mocked indicators — we exercise the controller's contract end-to-end
 * (status code, JSON shape) without spinning up Postgres or Redis.
 */
describe('Health (e2e)', () => {
    let app: INestApplication<App>;
    const dbIndicator = {
        pingCheck: jest.fn(),
    };
    const redisIndicator = {
        pingCheck: jest.fn(),
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxxx';
        process.env.LOG_LEVEL = 'silent';
        process.env.LOG_PRETTY = 'false';

        const moduleRef = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true }), ClsRequestModule, LoggerModule, TerminusModule],
            controllers: [HealthController],
            providers: [
                { provide: TypeOrmHealthIndicator, useValue: dbIndicator },
                { provide: RedisHealthIndicator, useValue: redisIndicator },
                // Guards globally — but health endpoints are @Public(), so they should pass through.
                { provide: APP_GUARD, useValue: { canActivate: () => true } },
                { provide: APP_GUARD, useValue: { canActivate: () => true } },
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        await app.init();

        // Suppress unused-import warning — JwtAuthGuard/RolesGuard are referenced for type cohesion.
        void JwtAuthGuard;
        void RolesGuard;
    });

    afterAll(async () => {
        await app.close();
    });

    it('/health/live always returns 200', async () => {
        const res = await request(app.getHttpServer()).get('/health/live').expect(200);
        const body = res.body as HealthCheckResult;
        expect(body.status).toBe('ok');
    });

    it('/health/ready returns 200 when DB and Redis ping succeed', async () => {
        dbIndicator.pingCheck.mockResolvedValueOnce({ postgres: { status: 'up' } });
        redisIndicator.pingCheck.mockResolvedValueOnce({ redis: { status: 'up' } });

        const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
        const body = res.body as HealthCheckResult;
        expect(body.status).toBe('ok');
    });

    it('/health/ready returns 503 when Postgres ping fails', async () => {
        dbIndicator.pingCheck.mockRejectedValueOnce(new HealthCheckError('postgres down', { postgres: { status: 'down' } }));
        redisIndicator.pingCheck.mockResolvedValueOnce({ redis: { status: 'up' } });

        const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
        const body = res.body as HealthCheckResult;
        expect(body.status).toBe('error');
        const errorInfo = body.error as Record<string, { status: string }>;
        expect(errorInfo['postgres'].status).toBe('down');
    });
});
