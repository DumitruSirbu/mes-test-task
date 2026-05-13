import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyKeyEntity } from './entity/IdempotencyKeyEntity';
import { IdempotencyKeysRepository } from './repository/IdempotencyKeysRepository';
import { IdempotencyService } from './service/IdempotencyService';
import { IdempotencyInterceptor } from './interceptor/IdempotencyInterceptor';

/**
 * Owns the `idempotency_keys` entity, repository, service, and interceptor. Exported so
 * any module that registers `@Idempotent()` handlers (currently `PurchasesModule`) can
 * resolve `IdempotencyService` for the write-side persistence inside its transaction.
 *
 * The interceptor itself is wired globally via `APP_INTERCEPTOR` in `AppModule` so a
 * module forgetting to register it cannot leak a non-idempotent POST.
 */
@Module({
    imports: [TypeOrmModule.forFeature([IdempotencyKeyEntity])],
    providers: [IdempotencyKeysRepository, IdempotencyService, IdempotencyInterceptor],
    exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
