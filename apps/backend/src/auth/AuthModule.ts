import { Module, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { JwtModuleOptions } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { UsersModule } from '../users/UsersModule';
import { AuthController } from './controller/AuthController';
import { AuthService } from './service/AuthService';
import { JwtStrategy } from './strategy/JwtStrategy';
import { RefreshTokensRepository } from './repository/RefreshTokensRepository';
import { RefreshTokenEntity } from './entity/RefreshTokenEntity';
import { RefreshTokenCleanupProcessor } from './job/RefreshTokenCleanupProcessor';
import { OriginAllowedGuard } from '../common/guard/OriginAllowedGuard';
import { DEFAULT_JWT_EXPIRES_IN } from './const/AuthConsts';
import {
    MAINTENANCE_QUEUE,
    MAINTENANCE_REMOVE_ON_COMPLETE_AGE_SECONDS,
    MAINTENANCE_REMOVE_ON_FAIL_AGE_SECONDS,
    MAINTENANCE_RETAIN_COUNT,
    REFRESH_TOKEN_CLEANUP_JOB,
    REFRESH_TOKEN_CLEANUP_CRON,
} from './const/MaintenanceConsts';
import { assertJwtConfig } from './util/assertJwtConfig';

/**
 * Wires JWT signing/verification, Passport strategy, refresh token rotation,
 * and the `maintenance` BullMQ queue for the cleanup processor.
 *
 * `JwtAuthGuard` and `RolesGuard` are NOT registered here — they're registered globally
 * in `AppModule` via `APP_GUARD` so no controller can forget to apply them.
 *
 * Algorithm pinning to HS256 is enforced both on signing (here) and verification
 * (`JwtStrategy`). See ADR 0003.
 *
 * `OriginAllowedGuard` is registered as a provider here so NestJS DI can inject
 * `ConfigService` into it. The guard is applied per-endpoint via `@UseGuards` on
 * `/auth/refresh` and `/auth/logout`.
 *
 * The `maintenance` queue repeatable job (`refresh-token-cleanup`) is registered
 * in `onModuleInit` via `Queue.add` with a repeat pattern (ADR 0007 §10).
 */
@Module({
    imports: [
        UsersModule,
        PassportModule,
        TypeOrmModule.forFeature([RefreshTokenEntity]),
        BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
        // Note: JwtModule is marked global for convenience. Only auth/ should consume JwtService directly.
        JwtModule.registerAsync({
            global: true,
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService): JwtModuleOptions => {
                const secret = config.get<string>('JWT_SECRET');
                const expiresIn = config.get<string>('JWT_EXPIRES_IN') ?? DEFAULT_JWT_EXPIRES_IN;
                assertJwtConfig(secret, expiresIn);

                return {
                    secret,
                    signOptions: {
                        algorithm: 'HS256' as const,
                        // assertJwtConfig validated the format against JWT_EXPIRES_IN_REGEX,
                        // so the runtime value matches StringValue. The single `as` narrows
                        // from the wider `string` inferred by ConfigService to the branded
                        // template-literal union required by jsonwebtoken's SignOptions.
                        expiresIn: expiresIn as StringValue,
                    },
                    verifyOptions: {
                        algorithms: ['HS256' as const],
                    },
                } satisfies JwtModuleOptions;
            },
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        JwtStrategy,
        RefreshTokensRepository,
        RefreshTokenCleanupProcessor,
        OriginAllowedGuard,
    ],
    exports: [AuthService, JwtModule],
})
export class AuthModule implements OnModuleInit {
    public constructor(
        @InjectQueue(MAINTENANCE_QUEUE) private readonly maintenanceQueue: Queue,
    ) {}

    /**
     * Register the refresh-token-cleanup repeatable job on module init.
     * BullMQ deduplicates repeatable entries by their `pattern` + `name` key,
     * so calling `.add` on every startup is idempotent.
     */
    public async onModuleInit(): Promise<void> {
        await this.maintenanceQueue.add(
            REFRESH_TOKEN_CLEANUP_JOB,
            {},
            {
                repeat: { pattern: REFRESH_TOKEN_CLEANUP_CRON },
                removeOnComplete: { age: MAINTENANCE_REMOVE_ON_COMPLETE_AGE_SECONDS, count: MAINTENANCE_RETAIN_COUNT },
                removeOnFail: { age: MAINTENANCE_REMOVE_ON_FAIL_AGE_SECONDS, count: MAINTENANCE_RETAIN_COUNT },
            },
        );
    }
}
