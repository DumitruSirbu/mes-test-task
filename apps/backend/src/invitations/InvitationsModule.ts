import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvitationEntity } from './entity/InvitationEntity';
import { InvitationsRepository } from './repository/InvitationsRepository';
import { InvitationsService } from './service/InvitationsService';
import { InvitationsController } from './controller/InvitationsController';
import { EnrolmentsModule } from '../enrolments/EnrolmentsModule';
import { UsersModule } from '../users/UsersModule';
import { AuthModule } from '../auth/AuthModule';

/**
 * Owns invitation issuance (M04) and redemption (M05).
 *
 * `UsersModule` is imported to resolve `UsersRepository` (needed for the email-conflict
 * check and student user creation inside the redeem transaction). `AuthModule` is imported
 * to resolve `AuthService` (token issuance after successful redemption).
 *
 * `EnrolmentsModule` is imported to provide `EnrolmentsRepository` — the enrolment
 * entity and repository are owned by that module and shared with `LessonsModule`.
 */
@Module({
    imports: [TypeOrmModule.forFeature([InvitationEntity]), EnrolmentsModule, UsersModule, AuthModule],
    controllers: [InvitationsController],
    providers: [InvitationsRepository, InvitationsService],
    exports: [InvitationsService, InvitationsRepository],
})
export class InvitationsModule {}
