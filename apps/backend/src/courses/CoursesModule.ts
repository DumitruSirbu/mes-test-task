import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CourseEntity } from './entity/CourseEntity';
import { CoursesRepository } from './repository/CoursesRepository';
import { CoursesService } from './service/CoursesService';
import { CoursesController } from './controller/CoursesController';

@Module({
    imports: [TypeOrmModule.forFeature([CourseEntity])],
    controllers: [CoursesController],
    providers: [CoursesRepository, CoursesService],
    exports: [CoursesService],
})
export class CoursesModule {}
