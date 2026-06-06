import { HttpService } from '@nestjs/axios';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { firstValueFrom } from 'rxjs';

type AiHealthResponse = Record<string, unknown>;

@Injectable()
export class AppService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.pool = new Pool({
      connectionString:
        this.configService.get<string>('DATABASE_URL') ??
        'postgresql://app:app@localhost:5432/app_dev',
    });
  }

  getHealth() {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getAiHealth() {
    const aiServiceUrl =
      this.configService.get<string>('AI_SERVICE_URL') ??
      'http://localhost:8000';

    try {
      const response = await firstValueFrom(
        this.httpService.get<AiHealthResponse>(`${aiServiceUrl}/health`, {
          headers: this.getInternalHeaders(),
          timeout: 3000,
        }),
      );

      return {
        service: 'api',
        status: 'ok',
        ai: response.data,
      };
    } catch (error) {
      return {
        service: 'api',
        status: 'degraded',
        ai: {
          status: 'unreachable',
          message: this.toErrorMessage(error),
        },
      };
    }
  }

  async getDbHealth() {
    try {
      const result = await this.pool.query<{ ok: number }>('SELECT 1 AS ok');

      return {
        service: 'api',
        status: result.rows[0]?.ok === 1 ? 'ok' : 'unknown',
        database: 'postgresql',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        service: 'api',
        status: 'degraded',
        database: 'postgresql',
        message: this.toErrorMessage(error),
      };
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private getInternalHeaders() {
    const apiKey = this.configService.get<string>('INTERNAL_AI_API_KEY');

    return apiKey ? { 'X-INTERNAL-API-KEY': apiKey } : undefined;
  }

  private toErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
