import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvitationEntity } from './entity/InvitationEntity';
import { InvitationsRepository } from './repository/InvitationsRepository';
import { InvitationsService } from './service/InvitationsService';
import { InvitationsController } from './controller/InvitationsController';
import { EnrolmentEntity } from '../enrolments/entity/EnrolmentEntity';
import { EnrolmentsRepository } from '../enrolments/repository/EnrolmentsRepository';
import { UsersModule } from '../users/UsersModule';
import { AuthModule } from '../auth/AuthModule';

/**
 * Owns invitation issuance (M04) and redemption (M05).
 *
 * `UsersModule` is imported to resolve `UsersRepository` (needed for the email-conflict
 * check and student user creation inside the redeem transaction). `AuthModule` is imported
 * to resolve `AuthService` (token issuance after successful redemption).
 *
 * `EnrolmentEntity` is registered here (not in a separate EnrolmentsModule) because the
 * `EnrolmentsRepository` is only consumed by the redemption flow — no other feature
 * needs enrolment writes in v1.
 */
@Module({
    imports: [TypeOrmModule.forFeature([InvitationEntity, EnrolmentEntity]), UsersModule, AuthModule],
    controllers: [InvitationsController],
    providers: [InvitationsRepository, InvitationsService, EnrolmentsRepository],
    exports: [InvitationsService, InvitationsRepository],
})
export class InvitationsModule {}
