import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseEntity } from './entity/PurchaseEntity';
import { PurchasesRepository } from './repository/PurchasesRepository';
import { PurchasesService } from './service/PurchasesService';
import { PurchasesController } from './controller/PurchasesController';
import { CoursesModule } from '../courses/CoursesModule';
import { InvitationsModule } from '../invitations/InvitationsModule';
import { IdempotencyModule } from '../common/idempotency/IdempotencyModule';
import { INVITATION_EMAIL_QUEUE } from '../notifications/const/NotificationsConsts';

/**
 * `BullModule.registerQueue` makes `@InjectQueue(INVITATION_EMAIL_QUEUE)` available
 * in `PurchasesService`. The underlying Redis connection is configured once in
 * `NotificationsModule.BullModule.forRootAsync` and shared across all registered queues.
 * `NotificationsModule` is imported at the root (`AppModule`) before `PurchasesModule`
 * so the global BullMQ root is already registered when this module initialises.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([PurchaseEntity]),
        BullModule.registerQueue({ name: INVITATION_EMAIL_QUEUE }),
        CoursesModule,
        InvitationsModule,
        IdempotencyModule,
    ],
    controllers: [PurchasesController],
    providers: [PurchasesRepository, PurchasesService],
    exports: [PurchasesService, PurchasesRepository],
})
export class PurchasesModule {}
