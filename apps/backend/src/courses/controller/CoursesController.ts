import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import type { ICourseResponse } from '@mes/shared';
import { Public } from '../../auth/decorator/Public';
import { CoursesService } from '../service/CoursesService';

/**
 * Read-only catalog endpoints. Public — anonymous browsers can see the catalog before
 * signing up. No mutation surface lives here.
 */
@Controller('courses')
export class CoursesController {
    public constructor(private readonly coursesService: CoursesService) {}

    @Public()
    @Get()
    public async list(): Promise<ICourseResponse[]> {
        return this.coursesService.listAll();
    }

    @Public()
    @Get(':id')
    public async detail(@Param('id', ParseIntPipe) id: number): Promise<ICourseResponse> {
        return this.coursesService.getById(id);
    }
}
