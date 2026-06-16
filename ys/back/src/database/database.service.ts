import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

type DatabaseHealthRow = {
  database_name: string;
  user_name: string;
  server_time: Date;
};

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService) {
    const databaseUrl =
      this.configService.getOrThrow<string>('DATABASE_URL');

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: this.getPositiveInteger('DB_POOL_MAX', 10),
      idleTimeoutMillis: this.getPositiveInteger('DB_IDLE_TIMEOUT_MS', 30_000),
      connectionTimeoutMillis: this.getPositiveInteger(
        'DB_CONNECTION_TIMEOUT_MS',
        5_000,
      ),
      ssl: this.getSslConfig(),
    });
  }

  async query<T extends QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async checkConnection() {
    try {
      const result = await this.query<DatabaseHealthRow>(
        `
          SELECT
            current_database() AS database_name,
            current_user AS user_name,
            NOW() AS server_time
        `,
      );

      return {
        status: 'ok',
        database: result.rows[0].database_name,
        user: result.rows[0].user_name,
        serverTime: result.rows[0].server_time,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';

      throw new ServiceUnavailableException({
        status: 'error',
        message: 'Database connection failed',
        detail: message,
      });
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private getPositiveInteger(key: string, fallback: number) {
    const value = this.configService.get<string>(key);
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private getSslConfig(): PoolConfig['ssl'] {
    const configured = this.configService.get<string>('DB_SSL')?.toLowerCase();
    const isProduction =
      this.configService.get<string>('NODE_ENV')?.toLowerCase() === 'production';
    const enabled =
      configured === 'true' ||
      configured === 'require' ||
      (isProduction && configured !== 'false');

    if (!enabled) {
      return undefined;
    }

    const rejectUnauthorized =
      this.configService
        .get<string>('DB_SSL_REJECT_UNAUTHORIZED')
        ?.toLowerCase() !== 'false';

    return { rejectUnauthorized };
  }
}
