import { Client } from 'pg';
import { runSqlMigrations } from './run-sql-migrations';

async function resetDevDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('migration:reset:dev cannot run in production.');
  }

  if (!/localhost|127\.0\.0\.1/.test(databaseUrl)) {
    throw new Error(
      'migration:reset:dev only runs against a local database URL.',
    );
  }

  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await client.end();
  }

  await runSqlMigrations();
}

resetDevDatabase().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
