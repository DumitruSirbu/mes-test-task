import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LessonEntity } from './entity/LessonEntity';
import { LessonsRepository } from './repository/LessonsRepository';
import { LessonsService } from './service/LessonsService';
import { LessonsController } from './controller/LessonsController';
import { EnrolmentsModule } from '../enrolments/EnrolmentsModule';

/**
 * Owns the `lessons` table and the LMS read API.
 *
 * `EnrolmentsModule` is imported to provide `EnrolmentsRepository` — used by
 * `LessonsService` to enforce enrolment checks on every access path.
 */
@Module({
    imports: [TypeOrmModule.forFeature([LessonEntity]), EnrolmentsModule],
    controllers: [LessonsController],
    providers: [LessonsRepository, LessonsService],
})
export class LessonsModule {}
