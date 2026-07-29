import { findRuntimeDatabaseBoundaryViolations } from './runtime-database-boundary';

describe('runtime database boundary', () => {
  it('reports runtime DDL, demo seeding, and silent database URL fallbacks', () => {
    expect(
      findRuntimeDatabaseBoundaryViolations([
        {
          relativePath: 'unsafe.ts',
          body: `
            const url = config.get<string>('DATABASE_URL') ?? 'postgresql://local';
            await client.query('CREATE TABLE runtime_table (id integer)');
            process.env.ALLOW_DEMO_SEED = 'true';
          `,
        },
      ]),
    ).toEqual([
      'unsafe.ts contains runtime DDL',
      'unsafe.ts references the demo seed runtime flag',
      'unsafe.ts silently falls back when DATABASE_URL is missing',
    ]);
  });

  it('accepts runtime code that only reads and writes application rows', () => {
    expect(
      findRuntimeDatabaseBoundaryViolations([
        {
          relativePath: 'safe.ts',
          body: "await client.query('SELECT id FROM courses WHERE id = $1')",
        },
      ]),
    ).toEqual([]);
  });

  it('reports modified DDL forms and environment fallbacks outside ConfigService', () => {
    expect(
      findRuntimeDatabaseBoundaryViolations([
        {
          relativePath: 'temporary-schema.ts',
          body: `
            const url = process.env.DATABASE_URL || 'postgresql://local';
            await client.query('CREATE TEMP TABLE runtime_table (id integer)');
          `,
        },
        {
          relativePath: 'runtime-view.ts',
          body: `
            const url = env['DATABASE_URL'] ?? localDatabaseUrl;
            await client.query('CREATE OR REPLACE VIEW runtime_view AS SELECT 1');
          `,
        },
      ]),
    ).toEqual([
      'temporary-schema.ts contains runtime DDL',
      'temporary-schema.ts silently falls back when DATABASE_URL is missing',
      'runtime-view.ts contains runtime DDL',
      'runtime-view.ts silently falls back when DATABASE_URL is missing',
    ]);
  });

  it('accepts explicit production validation and non-database fallbacks', () => {
    expect(
      findRuntimeDatabaseBoundaryViolations([
        {
          relativePath: 'validated.ts',
          body: `
            const databaseUrl = process.env.DATABASE_URL;
            if (!databaseUrl) throw new Error('DATABASE_URL is required');
            const pageSize = configuredPageSize ?? 20;
          `,
        },
      ]),
    ).toEqual([]);
  });
});
