import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorator/Public';
import { AppService } from './app.service';

@Controller()
export class AppController {
    public constructor(private readonly appService: AppService) {}

    @Public()
    @Get()
    public getHello(): string {
        return this.appService.getHello();
    }
}
