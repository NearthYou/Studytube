import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiProxyService } from './ai-proxy.service';
import { DatabaseService } from './database.service';

@Injectable()
export class AppService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly aiProxyService: AiProxyService,
  ) {}

  getHealth() {
    return this.getLiveness();
  }

  getLiveness() {
    return {
      service: 'api',
      status: 'ok',
      live: true,
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness() {
    const database = await this.databaseService.health();
    const readiness = {
      service: 'api',
      status: database.ready ? 'ok' : 'unavailable',
      ready: database.ready,
      dependencies: { database },
      timestamp: new Date().toISOString(),
    };

    if (!readiness.ready) {
      throw new ServiceUnavailableException(readiness);
    }

    return readiness;
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
