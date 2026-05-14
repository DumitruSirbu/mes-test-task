import { Module } from '@nestjs/common';
import { UsersModule } from '../users/UsersModule';
import { CoursesModule } from '../courses/CoursesModule';
import { PurchasesModule } from '../purchases/PurchasesModule';
import { AdminController } from './controller/AdminController';
import { AdminService } from './service/AdminService';

/**
 * Admin panel module — read-only endpoints protected by `@Roles(ADMIN)`.
 *
 * Imports entity-owning modules to access their exported repositories without
 * re-registering entities. No TypeOrmModule.forFeature here — ownership stays
 * with the originating modules per convention.
 */
@Module({
    imports: [UsersModule, CoursesModule, PurchasesModule],
    controllers: [AdminController],
    providers: [AdminService],
})
export class AdminModule {}
