import {
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    INestApplication,
    MiddlewareConsumer,
    Module,
    NestModule,
    ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { UserRoleEnum } from '@mes/shared';

import { JwtAuthGuard } from '../src/auth/guard/JwtAuthGuard';
import { JwtStrategy } from '../src/auth/strategy/JwtStrategy';
import { RolesGuard } from '../src/auth/guard/RolesGuard';
import { HttpExceptionFilter } from '../src/common/filter/HttpExceptionFilter';
import { ClsRequestModule } from '../src/common/cls/ClsRequestModule';
import { LoggerModule } from '../src/common/logger/LoggerModule';
import { BullBoardAuthMiddleware } from '../src/notifications/middleware/BullBoardAuthMiddleware';
import { BULL_BOARD_BASE_PATH } from '../src/notifications/const/NotificationsConsts';

const TEST_JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxxx';

/**
 * E2E tests for Bull Board auth middleware.
 *
 * We mount a stub controller at `/admin/queues/api/queues` to simulate the Bull
 * Board data endpoint without requiring a real Redis connection. The real
 * `BullBoardAuthMiddleware` (backed by the algorithm-pinned `JwtService`) is
 * applied to the stub route via `MiddlewareConsumer`.
 *
 * Three coverage goals per the security review blocker:
 *   1. Anonymous GET → 401
 *   2. Valid non-ADMIN bearer (PARENT role) → 403
 *   3. Valid ADMIN bearer → 200
 */

const STUB_QUEUES_PATH = `${BULL_BOARD_BASE_PATH}/api/queues`;

// Simulates the Bull Board data endpoint that is protected in production.
@Controller()
class StubBullBoardController {
    @Get(`${BULL_BOARD_BASE_PATH}/api/queues`)
    @HttpCode(HttpStatus.OK)
    public getQueues(): { queues: unknown[] } {
        return { queues: [] };
    }
}

@Module({
    imports: [
        JwtModule.register({
            secret: TEST_JWT_SECRET,
            signOptions: { algorithm: 'HS256', expiresIn: '15m' },
            verifyOptions: { algorithms: ['HS256'] },
        }),
    ],
    controllers: [StubBullBoardController],
    providers: [BullBoardAuthMiddleware],
})
class StubBullBoardModule implements NestModule {
    public configure(consumer: MiddlewareConsumer): void {
        // Numeric 0 = RequestMethod.ALL. Use `{*path}` wildcard (Express 5 / path-to-regexp v8).
        consumer.apply(BullBoardAuthMiddleware).forRoutes({ path: `${BULL_BOARD_BASE_PATH}/{*path}`, method: 0 });
    }
}

describe('Bull Board auth middleware (e2e)', () => {
    let app: INestApplication<App>;
    let jwtService: JwtService;

    const signToken = (userId: number, role: UserRoleEnum): string =>
        jwtService.sign({ sub: userId, role }, { expiresIn: '15m' });

    beforeAll(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        process.env.JWT_EXPIRES_IN = '15m';
        process.env.NODE_ENV = 'test';
        process.env.LOG_LEVEL = 'silent';
        process.env.LOG_PRETTY = 'false';

        const moduleRef = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ClsRequestModule,
                LoggerModule,
                PassportModule,
                JwtModule.register({
                    secret: TEST_JWT_SECRET,
                    signOptions: { algorithm: 'HS256', expiresIn: '15m' },
                    verifyOptions: { algorithms: ['HS256'] },
                }),
                StubBullBoardModule,
            ],
            providers: [
                JwtStrategy,
                { provide: APP_GUARD, useClass: JwtAuthGuard },
                { provide: APP_GUARD, useClass: RolesGuard },
                {
                    provide: APP_PIPE,
                    useFactory: (): ValidationPipe =>
                        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
                },
                { provide: APP_FILTER, useClass: HttpExceptionFilter },
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        await app.init();
        jwtService = moduleRef.get(JwtService);
    });

    afterAll(async () => {
        await app.close();
    });

    it('anonymous GET /admin/queues/api/queues returns 401', async () => {
        await request(app.getHttpServer()).get(STUB_QUEUES_PATH).expect(401);
    });

    it('non-ADMIN bearer (PARENT role) returns 403', async () => {
        const token = signToken(1, UserRoleEnum.PARENT);

        await request(app.getHttpServer())
            .get(STUB_QUEUES_PATH)
            .set('Authorization', `Bearer ${token}`)
            .expect(403);
    });

    it('valid ADMIN bearer returns 200', async () => {
        const token = signToken(2, UserRoleEnum.ADMIN);

        await request(app.getHttpServer())
            .get(STUB_QUEUES_PATH)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
    });
});
