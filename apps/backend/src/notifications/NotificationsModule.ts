import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/AuthModule';
import { InvitationEntity } from '../invitations/entity/InvitationEntity';
import { InvitationsRepository } from '../invitations/repository/InvitationsRepository';
import { InvitationEmailProcessor } from './processor/InvitationEmailProcessor';
import { BullBoardAuthMiddleware } from './middleware/BullBoardAuthMiddleware';
import {
    INVITATION_EMAIL_QUEUE,
    BULL_BOARD_BASE_PATH,
    REDIS_DEFAULT_HOST,
    REDIS_DEFAULT_PORT,
} from './const/NotificationsConsts';
import { MAINTENANCE_QUEUE } from '../auth/const/MaintenanceConsts';

/**
 * Owns the BullMQ `invitation-email` queue, its processor, and the Bull Board UI.
 *
 * Architecture notes:
 *
 * 1. `BullModule.forRootAsync` registers the shared IORedis connection config once.
 *    Every `BullModule.registerQueue` call across the app reuses this config.
 *
 * 2. `InvitationsRepository` is re-registered here (via `TypeOrmModule.forFeature`)
 *    rather than importing the full `InvitationsModule` to avoid a circular dependency:
 *    `NotificationsModule` → `InvitationsModule` → `PurchasesModule` → `NotificationsModule`.
 *    The processor needs only the repository, not the whole module.
 *
 * 3. `AuthModule` is imported to obtain the algorithm-pinned `JwtService` (HS256,
 *    `verifyOptions: { algorithms: ['HS256'] }`, validated `JWT_SECRET`). No second
 *    `JwtModule.registerAsync` is needed — the shared service already carries the config.
 *
 * 4. Bull Board auth ordering — the blocker:
 *    `BullBoardRootModule.configure()` calls:
 *      `consumer.apply(options.middleware, this.adapter.getRouter()).forRoutes(route)`
 *    The `options.middleware` slot is applied BEFORE Bull Board's own router in the same
 *    `apply()` chain. We pass `BullBoardAuthMiddleware` into `BullBoardModule.forRoot`'s
 *    `middleware` option so it runs first — before any request reaches Bull Board's Express
 *    router. This is the only ordering-safe approach; a second `configure()` call in
 *    `NotificationsModule` would run after Bull Board's registration.
 */
@Module({
    imports: [
        ConfigModule,
        AuthModule,
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                connection: {
                    host: config.get<string>('REDIS_HOST') ?? REDIS_DEFAULT_HOST,
                    port: Number(config.get<string>('REDIS_PORT') ?? REDIS_DEFAULT_PORT),
                    password: config.get<string>('REDIS_PASSWORD') ?? undefined,
                    // Required by BullMQ: disables per-command retry limit so the worker
                    // connection stays alive through transient Redis blips.
                    maxRetriesPerRequest: null,
                },
            }),
        }),
        BullModule.registerQueue({ name: INVITATION_EMAIL_QUEUE }),
        BullBoardModule.forRoot({
            route: BULL_BOARD_BASE_PATH,
            adapter: ExpressAdapter,
            // Auth middleware is passed here so it is applied by BullBoardRootModule.configure()
            // BEFORE Bull Board's own Express router in the same consumer.apply() chain.
            // This is the ordering-safe pattern — see architecture note 4 above.
            middleware: BullBoardAuthMiddleware,
        }),
        BullBoardModule.forFeature({
            name: INVITATION_EMAIL_QUEUE,
            adapter: BullMQAdapter,
        }),
        BullBoardModule.forFeature({
            name: MAINTENANCE_QUEUE,
            adapter: BullMQAdapter,
        }),
        TypeOrmModule.forFeature([InvitationEntity]),
    ],
    providers: [InvitationsRepository, InvitationEmailProcessor, BullBoardAuthMiddleware],
    exports: [BullModule],
})
export class NotificationsModule implements NestModule {
    // configure() is intentionally a no-op: Bull Board auth is handled via the
    // `middleware` option in BullBoardModule.forRoot (see architecture note 4).
    public configure(_consumer: MiddlewareConsumer): void {
        // no-op
    }
}
