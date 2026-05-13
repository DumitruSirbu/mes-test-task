import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnrolmentEntity } from './entity/EnrolmentEntity';
import { EnrolmentsRepository } from './repository/EnrolmentsRepository';

/**
 * Owns the `enrolments` table and its repository.
 *
 * Exported so that `InvitationsModule` (writes) and `LessonsModule` (reads) can both
 * depend on `EnrolmentsRepository` without registering the entity twice.
 */
@Module({
    imports: [TypeOrmModule.forFeature([EnrolmentEntity])],
    providers: [EnrolmentsRepository],
    exports: [EnrolmentsRepository],
})
export class EnrolmentsModule {}
