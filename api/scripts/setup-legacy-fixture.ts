import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  assertConnectedDatabase,
  requireSafeDatabaseTarget,
} from './database-script-guards';

async function main() {
  const target = requireSafeDatabaseTarget('ALLOW_LEGACY_FIXTURE_RESET');
  const fixture = await readFile(
    join(process.cwd(), 'test', 'fixtures', 'legacy-runtime-schema.sql'),
    'utf8',
  );
  const pool = new Pool({ connectionString: target.connectionString });

  try {
    const client = await pool.connect();

    try {
      await assertConnectedDatabase(client, target.databaseName);
      await client.query('BEGIN');

      try {
        await client.query('DROP SCHEMA public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('SET LOCAL search_path TO public');
        await client.query(fixture);

        const history = await client.query<{ migrationHistory: string | null }>(
          `SELECT to_regclass('public.pgmigrations')::text AS "migrationHistory"`,
        );

        if (history.rows[0]?.migrationHistory !== null) {
          throw new Error(
            'Legacy fixture must not contain migration history before adoption',
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log(
    `Legacy runtime fixture reset completed for ${target.databaseName}.`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
