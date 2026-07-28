import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('live')
  getLiveness() {
    return this.appService.getLiveness();
  }

  @Get('ready')
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
