import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('live')
  @Public()
  getLiveness() {
    return this.appService.getLiveness();
  }

  @Get('ready')
  @Public()
  getReadiness() {
    return this.appService.getReadiness();
  }

  @Get('ai')
  getAiHealth() {
    return this.appService.getAiHealth();
  }

  @Get('db')
  getDbHealth() {
    return this.appService.getDbHealth();
  }
}
