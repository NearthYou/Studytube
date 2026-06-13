import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface RunSqlMigrationsOptions {
  databaseUrl?: string;
  log?: (message: string) => void;
  migrationsDirectory?: string;
}

interface AppliedMigrationRow {
  checksum: string;
}

export async function runSqlMigrations(options: RunSqlMigrationsOptions = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const log =
    options.log ??
    ((message: string) => {
      process.stdout.write(`${message}\n`);
    });

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const migrationsDirectory =
    options.migrationsDirectory ?? join(__dirname, 'migrations');
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await ensureSchemaMigrationsTable(client);

    for (const filename of filenames) {
      const sql = await readFile(join(migrationsDirectory, filename), 'utf8');
      const checksum = createChecksum(sql);
      const appliedMigration = await findAppliedMigration(client, filename);

      if (appliedMigration) {
        if (appliedMigration.checksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for ${filename}. Refusing to continue.`,
          );
        }

        log(`Skipping ${filename}`);
        continue;
      }

      log(`Running ${filename}`);
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename, checksum)
         VALUES ($1, $2)`,
        [filename, checksum],
      );
    }
  } finally {
    await client.end();
  }
}

async function ensureSchemaMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename varchar(255) PRIMARY KEY,
      checksum varchar(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function findAppliedMigration(client: Client, filename: string) {
  const result = await client.query<AppliedMigrationRow>(
    `SELECT checksum
     FROM schema_migrations
     WHERE filename = $1`,
    [filename],
  );

  return result.rows[0] ?? null;
}

function createChecksum(sql: string) {
  return createHash('sha256').update(sql).digest('hex');
}

if (require.main === module) {
  runSqlMigrations().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
