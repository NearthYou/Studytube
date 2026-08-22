import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import type { CourseCutoverMode } from './course/course-cutover.policy';

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

export async function assertLearningCutoverAuthority(
  pool: Pick<Pool, 'query'>,
  runtime: { mode: CourseCutoverMode; writerRelease: string },
): Promise<void> {
  const result = await pool.query<{ writerRelease: string }>(
    `SELECT writer_release AS "writerRelease"
     FROM learning_cutover_authority
     WHERE singleton = true`,
  );
  const marker = result.rows[0];

  if (!marker) {
    if (runtime.mode === 'course') {
      throw new Error(
        'Production startup refused because learning cutover authority is not activated',
      );
    }
    return;
  }
  if (runtime.mode !== 'course') {
    throw new Error(
      'Production startup refused because legacy rollback is disabled after learning cutover activation',
    );
  }
  if (marker.writerRelease !== runtime.writerRelease) {
    throw new Error(
      `Production startup refused because learning cutover authority requires writer release ${marker.writerRelease}`,
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
