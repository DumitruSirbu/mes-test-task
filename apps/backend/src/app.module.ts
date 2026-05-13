import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
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
import { IdempotencyInterceptor } from './common/idempotency/interceptor/IdempotencyInterceptor';
import { IdempotencyModule } from './common/idempotency/IdempotencyModule';
import { IdempotencyKeyEntity } from './common/idempotency/entity/IdempotencyKeyEntity';
import { HealthModule } from './health/HealthModule';
import { UsersModule } from './users/UsersModule';
import { UserEntity } from './users/entity/UserEntity';
import { CoursesModule } from './courses/CoursesModule';
import { CourseEntity } from './courses/entity/CourseEntity';
import { InvitationsModule } from './invitations/InvitationsModule';
import { InvitationEntity } from './invitations/entity/InvitationEntity';
import { PurchasesModule } from './purchases/PurchasesModule';
import { PurchaseEntity } from './purchases/entity/PurchaseEntity';
import { EnrolmentEntity } from './enrolments/entity/EnrolmentEntity';
import { LessonsModule } from './lessons/LessonsModule';
import { LessonEntity } from './lessons/entity/LessonEntity';

/**
 * Root module. Order matters:
 *   1. `ClsRequestModule` is imported first so its middleware mounts and a request id
 *      is available to the logger and filter.
 *   2. `LoggerModule` consumes the CLS service.
 *   3. `TypeOrmModule.forRootAsync` delegates to `buildPostgresOptionsFromConfig` — kept
 *      in sync with `data-source.ts` via the shared helper in `common/config/`.
 *   4. Feature modules are wired before the global guards / pipe / filter / interceptor
 *      so DI is resolved by the time they run.
 *   5. The global `IdempotencyInterceptor` short-circuits replays on `@Idempotent()`
 *      handlers; routes without the decorator pass through with zero overhead.
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
                entities: [UserEntity, CourseEntity, PurchaseEntity, InvitationEntity, IdempotencyKeyEntity, EnrolmentEntity, LessonEntity],
            }),
        }),
        UsersModule,
        AuthModule,
        HealthModule,
        CoursesModule,
        InvitationsModule,
        IdempotencyModule,
        PurchasesModule,
        LessonsModule,
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
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
    ],
})
export class AppModule {}
