import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'pg';

const LOCAL_DATABASE_URL = 'postgresql://app:app@localhost:5432/app_dev';

export function resolveDatabaseUrl(
  environment: NodeJS.ProcessEnv,
  configured: string | undefined,
): string {
  const explicit = configured?.trim();
  if (explicit) {
    return explicit;
  }
  if (environment.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must be explicitly configured in production');
  }
  return LOCAL_DATABASE_URL;
}

export async function assertRequiredMigrationsApplied(
  pool: Pick<Pool, 'query'>,
  requiredNames: string[],
): Promise<void> {
  const result = await pool.query<{ name: string }>(
    'SELECT name FROM pgmigrations ORDER BY id',
  );
  const applied = new Set(result.rows.map((row) => row.name));
  const pending = requiredNames.filter((name) => !applied.has(name));
  if (pending.length > 0) {
    throw new Error(
      `Production startup refused because database migrations are pending: ${pending.join(', ')}`,
    );
  }
}

export function requiredMigrationNames(
  environment: NodeJS.ProcessEnv,
  workingDirectory = process.cwd(),
): string[] {
  const configured = environment.REQUIRED_MIGRATIONS_DIR?.trim();
  const candidates = configured
    ? [resolve(configured)]
    : [
        resolve(workingDirectory, 'migrations'),
        resolve(workingDirectory, 'api', 'migrations'),
      ];
  const migrationDirectory = candidates.find((candidate) =>
    existsSync(candidate),
  );
  if (!migrationDirectory) {
    throw new Error(
      'Production startup refused because migrations are missing',
    );
  }
  const names = readdirSync(migrationDirectory)
    .filter((name) => /^\d+_[A-Za-z0-9._-]+\.cjs$/u.test(name))
    .map((name) => name.slice(0, -'.cjs'.length))
    .sort();
  if (names.length === 0) {
    throw new Error(
      'Production startup refused because no required migrations were found',
    );
  }
  return names;
}
