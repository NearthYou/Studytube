import {
  PRESERVED_APPLICATION_TABLES,
  RESET_APPLICATION_TABLES,
} from './user-data-reset.manifest';
import {
  buildUserDataResetPlan,
  classifyUserDataResetTables,
} from './user-data-reset.plan';

describe('user data reset plan', () => {
  it('rejects an unknown public table instead of silently retaining data', () => {
    expect(() =>
      classifyUserDataResetTables([
        ...RESET_APPLICATION_TABLES,
        ...PRESERVED_APPLICATION_TABLES,
        'surprise_table',
      ]),
    ).toThrow('UNKNOWN_APPLICATION_TABLE:surprise_table');
  });

  it('rejects a missing manifest table before generating destructive SQL', () => {
    expect(() =>
      classifyUserDataResetTables(
        [...RESET_APPLICATION_TABLES, ...PRESERVED_APPLICATION_TABLES].filter(
          (table) => table !== 'users',
        ),
      ),
    ).toThrow('MISSING_APPLICATION_TABLE:users');
  });

  it('reports exact row counts and a stable manifest without writing', async () => {
    const tables = [
      ...RESET_APPLICATION_TABLES,
      ...PRESERVED_APPLICATION_TABLES,
    ];
    const counts = new Map<string, number>([
      ['users', 2],
      ['sessions', 3],
      ['courses', 1],
      ['pgmigrations', 24],
      ['learning_cutover_runs', 1],
      ['learning_cutover_authority', 1],
      ['stt_provider_approvals', 1],
    ]);
    const query = jest.fn((sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return Promise.resolve({
          rows: tables.map((tableName) => ({ tableName })),
        });
      }
      if (sql.includes('current_database()')) {
        return Promise.resolve({ rows: [{ databaseName: 'app_reset_test' }] });
      }
      if (sql.includes('FROM pgmigrations ORDER BY id')) {
        return Promise.resolve({
          rows: [{ migrationName: '1753660823000_google-account-deletion' }],
        });
      }
      if (sql.includes('AS "rowValue"')) {
        const table = sql.match(/FROM "([a-z_]+)"/u)?.[1] ?? 'unknown';
        return Promise.resolve({ rows: [{ rowValue: `${table}-row` }] });
      }
      const table = sql.match(/FROM "([a-z_]+)"/u)?.[1];
      if (table) {
        return Promise.resolve({ rows: [{ count: counts.get(table) ?? 0 }] });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const plan = await buildUserDataResetPlan({ query } as never);

    expect(plan.databaseName).toBe('app_reset_test');
    expect(plan.migrationNames).toEqual([
      '1753660823000_google-account-deletion',
    ]);
    expect(plan.totalResetRows).toBe(6);
    expect(plan.resetTables.find((table) => table.name === 'users')).toEqual({
      name: 'users',
      rows: 2,
    });
    expect(plan.preservedTables).toEqual(
      expect.arrayContaining([
        { name: 'pgmigrations', rows: 24 },
        { name: 'learning_cutover_authority', rows: 1 },
      ]),
    );
    expect(plan.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(plan.planSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(plan.preservedFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      query.mock.calls.every(([sql]) => /^\s*SELECT\b/iu.test(String(sql))),
    ).toBe(true);
  });

  it('contains every user and derived-work boundary required for a fresh start', () => {
    for (const table of [
      'users',
      'sessions',
      'courses',
      'learning_items',
      'learning_notes',
      'adaptive_quiz_loops',
      'work_outbox_events',
      'work_job_results',
      'caption_artifacts',
      'google_auth_attempts',
    ]) {
      expect(RESET_APPLICATION_TABLES).toContain(table);
    }
    expect(PRESERVED_APPLICATION_TABLES).toEqual([
      'learning_cutover_authority',
      'learning_cutover_runs',
      'pgmigrations',
      'stt_provider_approvals',
    ]);
  });
});
