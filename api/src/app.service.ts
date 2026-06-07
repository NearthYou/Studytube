import { Injectable } from '@nestjs/common';
import { AiProxyService } from './ai-proxy.service';
import { DatabaseService } from './database.service';

@Injectable()
export class AppService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly aiProxyService: AiProxyService,
  ) {}

  getHealth() {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getAiHealth() {
    return {
      service: 'api',
      status: 'ok',
      ai: await this.aiProxyService.health(),
    };
  }

  async getDbHealth() {
    return this.databaseService.health();
  }
}
