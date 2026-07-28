import { join } from 'node:path';

interface ExistingIndex {
  name: string;
  relationKind: string;
  isValid: boolean | null;
  isReady: boolean | null;
  isUnique: boolean | null;
  definition: string | null;
}

interface MigrationBuilderStub {
  noTransaction: jest.Mock;
  db: {
    select: jest.Mock<Promise<ExistingIndex[]>, [string, unknown[]]>;
  };
  sql: jest.Mock;
}

interface ConcurrentIndexMigration {
  up(pgm: MigrationBuilderStub): Promise<void>;
  down(pgm: MigrationBuilderStub): void;
}

function loadMigration(): ConcurrentIndexMigration {
  const migrationPath = join(
    process.cwd(),
    'migrations',
    '1753660801000_concurrent-indexes.cjs',
  );

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(migrationPath) as ConcurrentIndexMigration;
}

function migrationBuilder(
  existingIndexes: ExistingIndex[] = [],
): MigrationBuilderStub {
  return {
    noTransaction: jest.fn(),
    db: {
      select: jest.fn(() => Promise.resolve(existingIndexes)),
    },
    sql: jest.fn(),
  };
}

describe('concurrent index migration', () => {
  const migration = loadMigration();

  it('creates every missing index concurrently without a false-success guard', async () => {
    const pgm = migrationBuilder();

    await migration.up(pgm);

    const statements = pgm.sql.mock.calls.map(([sql]) => String(sql));
    const createStatements = statements.filter((sql) =>
      sql.startsWith('CREATE INDEX CONCURRENTLY'),
    );

    expect(pgm.noTransaction).toHaveBeenCalledTimes(1);
    expect(createStatements).toHaveLength(12);
    expect(createStatements.join('\n')).not.toContain('IF NOT EXISTS');
    expect(statements.at(0)).toBe("SET lock_timeout = '10s'");
    expect(statements.at(-1)).toBe('RESET lock_timeout');
  });

  it('reuses a ready valid index only when its definition matches', async () => {
    const pgm = migrationBuilder([
      {
        name: 'users_lower_email_idx',
        relationKind: 'i',
        isValid: true,
        isReady: true,
        isUnique: false,
        definition:
          'CREATE INDEX users_lower_email_idx ON public.users USING btree (lower(email))',
      },
    ]);

    await migration.up(pgm);

    const statements = pgm.sql.mock.calls.map(([sql]) => String(sql));
    expect(
      statements.some((sql) =>
        sql.includes('CREATE INDEX CONCURRENTLY users_lower_email_idx'),
      ),
    ).toBe(false);
    expect(
      statements.filter((sql) => sql.startsWith('CREATE INDEX CONCURRENTLY')),
    ).toHaveLength(11);
  });

  it.each([
    [
      'invalid',
      {
        relationKind: 'i',
        isValid: false,
        isReady: true,
        isUnique: false,
        definition:
          'CREATE INDEX users_lower_email_idx ON public.users USING btree (lower(email))',
      },
      /not a ready, valid, non-unique index/,
    ],
    [
      'wrongly defined',
      {
        relationKind: 'i',
        isValid: true,
        isReady: true,
        isUnique: false,
        definition:
          'CREATE INDEX users_lower_email_idx ON public.users USING btree (email)',
      },
      /different definition/,
    ],
  ])('rejects an %s same-name index', async (_, index, message) => {
    const pgm = migrationBuilder([{ name: 'users_lower_email_idx', ...index }]);

    await expect(migration.up(pgm)).rejects.toThrow(message);
  });

  it('drops all owned indexes concurrently in reverse order', () => {
    const pgm = migrationBuilder();

    migration.down(pgm);

    const statements = pgm.sql.mock.calls.map(([sql]) => String(sql));
    expect(
      statements.filter((sql) =>
        sql.startsWith('DROP INDEX CONCURRENTLY IF EXISTS'),
      ),
    ).toHaveLength(12);
    expect(statements.at(0)).toBe("SET lock_timeout = '10s'");
    expect(statements.at(-1)).toBe('RESET lock_timeout');
  });
});
