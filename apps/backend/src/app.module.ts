import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/AuthModule';
import { JwtAuthGuard } from './auth/guard/JwtAuthGuard';
import { RolesGuard } from './auth/guard/RolesGuard';
import { ClsRequestModule } from './common/cls/ClsRequestModule';
import { buildPostgresOptionsFromConfig } from './common/config/buildPostgresOptions';
import { LoggerModule } from './common/logger/LoggerModule';
import { HttpExceptionFilter } from './common/filter/HttpExceptionFilter';
import { HealthModule } from './health/HealthModule';
import { UsersModule } from './users/UsersModule';
import { UserEntity } from './users/entity/UserEntity';

/**
 * Root module. Order matters:
 *   1. `ClsRequestModule` is imported first so its middleware mounts and a request id
 *      is available to the logger and filter.
 *   2. `LoggerModule` consumes the CLS service.
 *   3. `TypeOrmModule.forRootAsync` delegates to `buildPostgresOptionsFromConfig` — kept
 *      in sync with `data-source.ts` via the shared helper in `common/config/`.
 *   4. Global guards/pipe/filter are registered LAST so the rest of the wiring is
 *      already in place when they run.
 */
@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ClsRequestModule,
        LoggerModule,
        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                ...buildPostgresOptionsFromConfig(config),
                entities: [UserEntity],
            }),
        }),
        UsersModule,
        AuthModule,
        HealthModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        {
            provide: APP_PIPE,
            useFactory: (): ValidationPipe =>
                new ValidationPipe({
                    whitelist: true,
                    forbidNonWhitelisted: true,
                    transform: true,
                    transformOptions: { enableImplicitConversion: false },
                }),
        },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
    ],
})
export class AppModule {}
