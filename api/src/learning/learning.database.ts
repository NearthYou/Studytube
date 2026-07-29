import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { resolveDatabaseUrl } from '../database-migration-readiness';

@Injectable()
export class LearningDatabase implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: resolveDatabaseUrl(
        process.env,
        config.get<string>('DATABASE_URL'),
      ),
      connectionTimeoutMillis: 3_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
