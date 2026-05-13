import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseEntity } from './entity/PurchaseEntity';
import { PurchasesRepository } from './repository/PurchasesRepository';
import { PurchasesService } from './service/PurchasesService';
import { PurchasesController } from './controller/PurchasesController';
import { CoursesModule } from '../courses/CoursesModule';
import { InvitationsModule } from '../invitations/InvitationsModule';
import { IdempotencyModule } from '../common/idempotency/IdempotencyModule';

@Module({
    imports: [TypeOrmModule.forFeature([PurchaseEntity]), CoursesModule, InvitationsModule, IdempotencyModule],
    controllers: [PurchasesController],
    providers: [PurchasesRepository, PurchasesService],
    exports: [PurchasesService],
})
export class PurchasesModule {}
