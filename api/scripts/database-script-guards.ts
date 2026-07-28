import type { PoolClient } from 'pg';

export type DatabaseScriptAuthorization =
  | 'ALLOW_LEGACY_FIXTURE_RESET'
  | 'ALLOW_MIGRATION_ADOPTION_TEST'
  | 'ALLOW_DEMO_SEED';

export interface SafeDatabaseTarget {
  connectionString: string;
  databaseName: string;
  allowedDatabaseNames: readonly string[];
  hostname: 'localhost' | '127.0.0.1';
}

export function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be set`);
  }

  return value;
}

export function requireSafeDatabaseTarget(
  authorizationVariable: DatabaseScriptAuthorization,
  environment: NodeJS.ProcessEnv = process.env,
): SafeDatabaseTarget {
  if (requiredEnvironment(environment, authorizationVariable) !== 'true') {
    throw new Error(`${authorizationVariable} must equal true`);
  }

  const nodeEnvironment = requiredEnvironment(environment, 'NODE_ENV');

  if (nodeEnvironment.toLowerCase() === 'production') {
    throw new Error('Database migration rehearsals are disabled in production');
  }

  const connectionString = requiredEnvironment(environment, 'DATABASE_URL');
  let databaseUrl: URL;

  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (
    databaseUrl.protocol !== 'postgres:' &&
    databaseUrl.protocol !== 'postgresql:'
  ) {
    throw new Error('DATABASE_URL must use the postgres or postgresql scheme');
  }

  const { hostname } = databaseUrl;

  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error(
      `Migration adoption is restricted to localhost, received ${hostname || 'unknown'}`,
    );
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));

  if (!databaseName || databaseName.includes('/')) {
    throw new Error('DATABASE_URL must name exactly one database');
  }

  const allowedDatabaseNames =
    authorizationVariable === 'ALLOW_DEMO_SEED'
      ? demoSeedDatabaseAllowlist(environment)
      : migrationAdoptionDatabaseAllowlist(environment);

  if (!allowedDatabaseNames.includes(databaseName)) {
    if (authorizationVariable !== 'ALLOW_DEMO_SEED') {
      throw new Error(
        `DATABASE_URL database ${databaseName} does not match MIGRATION_ADOPTION_DATABASE ${allowedDatabaseNames[0]}`,
      );
    }

    throw new Error(
      `DATABASE_URL database ${databaseName} is not included in DEMO_SEED_DATABASES: ${allowedDatabaseNames.join(', ')}`,
    );
  }

  return {
    connectionString,
    databaseName,
    allowedDatabaseNames,
    hostname,
  };
}

function migrationAdoptionDatabaseAllowlist(
  environment: NodeJS.ProcessEnv,
): readonly string[] {
  const expectedDatabase = requiredEnvironment(
    environment,
    'MIGRATION_ADOPTION_DATABASE',
  );

  if (!expectedDatabase.endsWith('_test')) {
    throw new Error('MIGRATION_ADOPTION_DATABASE must end with _test');
  }

  return [expectedDatabase];
}

function demoSeedDatabaseAllowlist(
  environment: NodeJS.ProcessEnv,
): readonly string[] {
  const configuredAllowlist = requiredEnvironment(
    environment,
    'DEMO_SEED_DATABASES',
  );
  const databaseNames = configuredAllowlist
    .split(',')
    .map((databaseName) => databaseName.trim());

  if (
    databaseNames.some(
      (databaseName) => !databaseName || databaseName.includes('/'),
    )
  ) {
    throw new Error(
      'DEMO_SEED_DATABASES must contain comma-separated exact database names',
    );
  }

  return [...new Set(databaseNames)];
}

export async function assertConnectedDatabase(
  client: Pick<PoolClient, 'query'>,
  expectedDatabases: string | readonly string[],
): Promise<void> {
  const result = await client.query<{ database: string }>(
    'SELECT current_database() AS database',
  );
  const connectedDatabase = result.rows[0]?.database ?? '';
  const allowlist =
    typeof expectedDatabases === 'string'
      ? [expectedDatabases]
      : expectedDatabases;

  if (!allowlist.includes(connectedDatabase)) {
    throw new Error(
      `Connected database ${connectedDatabase || 'unknown'} does not match guarded database allowlist ${allowlist.join(', ')}`,
    );
  }
}
