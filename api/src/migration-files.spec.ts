import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertConnectedDatabase,
  quoteSqlIdentifier,
  requireSafeDatabaseTarget,
} from '../scripts/database-script-guards';
import {
  assertStableIdentity,
  DEMO_SEED_DISABLED_PASSWORD_HASH,
  demoPlaylistStableIdentity,
  replacementForLegacyDemoPasswordHash,
  shouldAdvanceSequence,
} from '../scripts/seed-demo';

const TABLES = [
  'users',
  'sessions',
  'posts',
  'video_assets',
  'tags',
  'post_tags',
  'comments',
  'playlists',
  'playlist_items',
  'playlist_feedback',
  'post_embeddings',
] as const;

const INDEXES = [
  'users_lower_email_idx',
  'sessions_user_id_idx',
  'posts_author_updated_at_idx',
  'posts_updated_at_idx',
  'post_tags_tag_id_idx',
  'comments_post_created_at_idx',
  'comments_author_id_idx',
  'playlists_owner_created_at_idx',
  'playlist_items_playlist_position_idx',
  'playlist_items_post_id_idx',
  'playlist_feedback_playlist_created_at_idx',
  'playlist_feedback_author_id_idx',
] as const;

function safeEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ALLOW_LEGACY_FIXTURE_RESET: 'true',
    ALLOW_MIGRATION_ADOPTION_TEST: 'true',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://app:app@localhost:5432/app_test',
    MIGRATION_ADOPTION_DATABASE: 'app_test',
    ...overrides,
  };
}

function safeDemoEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ALLOW_DEMO_SEED: 'true',
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://app:app@localhost:5432/app_dev',
    DEMO_SEED_DATABASES: 'app_dev,app_test',
    ...overrides,
  };
}

describe('database migration files', () => {
  it('keeps the adoption-safe baseline free of blocking index work and destructive rollback', async () => {
    const migration = await readFile(
      join(process.cwd(), 'migrations', '1753660800000_baseline-schema.cjs'),
      'utf8',
    );

    expect(migration).toContain("pgm.createExtension('vector'");

    for (const table of TABLES) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }

    expect(migration).not.toContain('CREATE INDEX');
    expect(migration).not.toContain('DROP TABLE');
    expect(migration).toContain('irreversible');
    expect(migration).toContain('throw new Error');
  });

  it('builds and drops only the follow-up indexes concurrently outside a transaction', async () => {
    const migrationPath = join(
      process.cwd(),
      'migrations',
      '1753660801000_concurrent-indexes.cjs',
    );

    expect(existsSync(migrationPath)).toBe(true);

    if (!existsSync(migrationPath)) {
      return;
    }

    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain('pgm.noTransaction()');
    expect(migration).toMatch(/SET lock_timeout = '\d+s'/);
    expect(migration).toContain('pg_get_indexdef');
    expect(migration).toContain('indisvalid');
    expect(migration).toContain('indisready');
    expect(migration).not.toContain('CONCURRENTLY IF NOT EXISTS');
    expect(migration).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS ${index.name}',
    );

    for (const index of INDEXES) {
      expect(migration).toContain(`name: '${index}'`);
    }

    expect(migration).not.toContain('DROP TABLE');
  });

  it('preflights legacy auth data before the irreversible credential cutover', async () => {
    const migrationPath = join(
      process.cwd(),
      'migrations',
      '1753660802000_auth-hardening.cjs',
    );

    expect(existsSync(migrationPath)).toBe(true);

    if (!existsSync(migrationPath)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require(migrationPath) as {
      up(pgm: { sql: jest.Mock }): void | Promise<void>;
    };
    const pgm = { sql: jest.fn() };

    await migration.up(pgm);

    const statements = pgm.sql.mock.calls.map(([sql]) => String(sql));
    const preflight = statements[0] ?? '';
    const mutations = statements.slice(1).join('\n');
    const printableAsciiCheck = preflight.indexOf(
      'COLLATE "C" !~ \'^[ -~]+$\'',
    );
    const asciiSpaceTrim = preflight.indexOf("btrim(email, ' ')");
    const grammarCheck = preflight.indexOf('invalid_email_grammar');
    const lowercase = preflight.indexOf(`lower(btrim(email, ' ') COLLATE "C")`);
    const collisionCheck = preflight.indexOf('canonical_collision');

    expect(preflight).toContain('invalid legacy email user IDs');
    expect(preflight).toContain('unknown password representation user IDs');
    expect(preflight).toContain("password_hash !~ '^[0-9a-f]{64}$'");
    expect(printableAsciiCheck).toBeGreaterThanOrEqual(0);
    expect(asciiSpaceTrim).toBeGreaterThan(printableAsciiCheck);
    expect(grammarCheck).toBeGreaterThan(asciiSpaceTrim);
    expect(lowercase).toBeGreaterThan(grammarCheck);
    expect(collisionCheck).toBeGreaterThan(lowercase);
    expect(mutations).toContain('DROP TABLE sessions');
  });

  it('creates a digest-only constrained auth schema with application supplied UUIDs', async () => {
    const migrationPath = join(
      process.cwd(),
      'migrations',
      '1753660802000_auth-hardening.cjs',
    );

    expect(existsSync(migrationPath)).toBe(true);

    if (!existsSync(migrationPath)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require(migrationPath) as {
      up(pgm: { sql: jest.Mock }): void | Promise<void>;
    };
    const pgm = { sql: jest.fn() };

    await migration.up(pgm);

    const statements = pgm.sql.mock.calls.map(([sql]) => String(sql));
    const sql = statements.join('\n');

    for (const column of [
      'email_canonical',
      'password_algorithm',
      'password_parameters',
      'password_version',
      'identity_assurance',
      'email_verified_at',
    ]) {
      expect(sql).toContain(column);
    }

    expect(sql).toContain("password_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("password_hash = 'disabled:demo-seed-login'");
    expect(sql).toContain("identity_assurance = 'legacy_grandfathered'");
    expect(sql).toContain('email_verified_at = NULL');
    expect(sql).toContain('DROP INDEX IF EXISTS users_lower_email_idx');
    expect(sql).toContain('UNIQUE (email_canonical)');

    for (const table of [
      'sessions',
      'pending_registrations',
      'auth_rate_limits',
      'verification_email_outbox',
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }

    expect(sql).not.toMatch(/UUID\s+[^,\n]*DEFAULT/i);
    expect(sql).not.toMatch(/\btoken\s+TEXT\b/i);
    expect(sql).not.toMatch(/\bverification_token\b|\benrollment_token\b/i);
    expect(sql).not.toMatch(/reauth/i);
    expect(sql).toContain('CHECK (octet_length(token_digest) = 32)');
    expect(sql).toContain('CHECK (octet_length(verification_digest) = 32)');
    expect(sql).toContain('CHECK (octet_length(subject_digest) = 32)');
    expect(sql).toContain('CHECK (octet_length(payload_hash) = 32)');
    expect(sql).toContain('last_seen_at <= idle_expires_at');
    expect(sql).toContain('completed_at <= enrollment_expires_at');
    expect(sql).toContain('UNIQUE (token_digest)');
    expect(sql).toContain('UNIQUE (verification_digest)');
    expect(sql).toContain('UNIQUE (enrollment_digest)');
    expect(sql).toContain('UNIQUE (idempotency_key)');
    expect(sql).toContain('REFERENCES users(id) ON DELETE CASCADE');
    expect(sql).toContain(
      'REFERENCES pending_registrations(id) ON DELETE CASCADE',
    );

    const claimIndex = statements.find((statement) =>
      statement.includes('verification_email_outbox_claim_idx'),
    );

    expect(claimIndex).toBeDefined();
    expect(claimIndex).toContain('WHERE sent_at IS NULL');
    expect(claimIndex).not.toMatch(/\bnow\s*\(/i);
  });

  it('rejects auth rollback before asking the migration builder to mutate data', () => {
    const migrationPath = join(
      process.cwd(),
      'migrations',
      '1753660802000_auth-hardening.cjs',
    );

    expect(existsSync(migrationPath)).toBe(true);

    if (!existsSync(migrationPath)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require(migrationPath) as {
      down(pgm: { sql: jest.Mock }): void;
    };
    const pgm = { sql: jest.fn() };

    expect(() => migration.down(pgm)).toThrow(
      /auth-hardening is irreversible.*verified pre-cutover backup/i,
    );
    expect(pgm.sql).not.toHaveBeenCalled();
  });

  it('defines an additive Course aggregate migration with guarded rollback', async () => {
    const migrationPath = join(
      process.cwd(),
      'migrations',
      '1753660803000_course-aggregate.cjs',
    );

    expect(existsSync(migrationPath)).toBe(true);

    if (!existsSync(migrationPath)) {
      return;
    }

    const migration = await readFile(migrationPath, 'utf8');

    for (const table of [
      'courses',
      'course_steps',
      'course_feedback',
      'course_backfill_audits',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }

    for (const constraint of [
      'courses_status_visibility_valid',
      'courses_idempotency_digest_pair_valid',
      'course_steps_course_position_key',
      'course_steps_positions_contiguous',
      'courses_published_nonempty',
    ]) {
      expect(migration).toContain(constraint);
    }

    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('ON DELETE SET NULL');
    expect(migration).toContain('course aggregate rollback refused');
    expect(migration).not.toMatch(/DROP TABLE\s+(playlists|playlist_items)/i);
  });

  it('defines durable work, retrieval, agent-run, progress, and quiz persistence', async () => {
    const migrationPath = join(
      process.cwd(),
      'migrations',
      '1753660804000_reliability-learning.cjs',
    );

    expect(existsSync(migrationPath)).toBe(true);

    if (!existsSync(migrationPath)) {
      return;
    }

    const migration = await readFile(migrationPath, 'utf8');

    for (const table of [
      'work_outbox_events',
      'work_job_results',
      'work_dead_letters',
      'work_replay_audits',
      'retrieval_embeddings',
      'agent_runs',
      'agent_run_attempts',
      'agent_tool_calls',
      'learning_progress',
      'learning_progress_events',
      'quizzes',
      'quiz_questions',
      'quiz_attempts',
      'quiz_answers',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }

    for (const contract of [
      'payload_schema_version',
      'lease_token',
      'work_job_results_event_handler_key',
      'retrieval_embeddings_vector_dimensions',
      'vector(1536)',
      'agent_runs_state_valid',
      'agent_runs_budget_positive',
      'learning_progress_ranges_array',
      'quiz_questions_position_key',
      'quiz_attempts_idempotency_key',
    ]) {
      expect(migration).toContain(contract);
    }

    expect(migration).toContain('reliability learning rollback refused');
    expect(migration).not.toMatch(/DROP TABLE\s+(users|posts|courses)/i);
  });

  it('checks in a complete legacy runtime fixture with data and sequence state', async () => {
    const fixturePath = join(
      process.cwd(),
      'test',
      'fixtures',
      'legacy-runtime-schema.sql',
    );

    expect(existsSync(fixturePath)).toBe(true);

    if (!existsSync(fixturePath)) {
      return;
    }

    const fixture = await readFile(fixturePath, 'utf8');

    for (const table of TABLES) {
      expect(fixture).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(fixture).toContain(`INSERT INTO ${table}`);
    }

    for (const table of [
      'users',
      'posts',
      'video_assets',
      'tags',
      'comments',
      'playlists',
      'playlist_feedback',
    ]) {
      expect(fixture).toContain(`setval('${table}_id_seq'`);
    }

    expect(fixture).not.toContain('pgmigrations');
  });

  it('keeps demo data behind an explicit non-destructive seed command', async () => {
    const seedScript = await readFile(
      join(process.cwd(), 'scripts', 'seed-demo.ts'),
      'utf8',
    );

    expect(seedScript).toContain('ALLOW_DEMO_SEED');
    expect(seedScript).toContain('ON CONFLICT DO NOTHING');
    expect(seedScript).not.toMatch(/ON CONFLICT[\s\S]{0,120}DO UPDATE/);
    expect(seedScript).not.toContain('INSERT INTO sessions');
    expect(seedScript).not.toContain('user.passwordHash');
    expect(seedScript).toContain('DEMO_SEED_DISABLED_PASSWORD_HASH');
    expect(seedScript).toContain('IN SHARE ROW EXCLUSIVE MODE');
    expect(seedScript).toContain('is_called AS "isCalled"');
    expect(seedScript).toContain("assertStableIdentity('user'");
    expect(seedScript).toContain("assertStableIdentity('post'");
    expect(seedScript).toMatch(/assertStableIdentity\(\s*'playlist'/);
    expect(seedScript).toContain('demoPlaylistStableIdentity(playlist)');
    expect(seedScript).toContain("assertStableIdentity('comment'");
    expect(seedScript).toContain("assertStableIdentity('feedback'");
    expect(seedScript).toContain('DELETE FROM sessions WHERE user_id = $1');
    expect(seedScript).toContain('email_canonical');
    expect(seedScript).toContain('password_algorithm');
    expect(seedScript).toContain('password_parameters');
    expect(seedScript).toContain('identity_assurance');
  });

  it('runs a guarded PostgreSQL verification after the idempotent demo seed', async () => {
    const verifierPath = join(process.cwd(), 'scripts', 'verify-demo-seed.ts');

    expect(existsSync(verifierPath)).toBe(true);

    if (!existsSync(verifierPath)) {
      return;
    }

    const [verifier, packageJson] = await Promise.all([
      readFile(verifierPath, 'utf8'),
      readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ]);

    expect(packageJson).toContain('db:seed:verify');
    expect(verifier).toContain('assertConnectedDatabase');
    expect(verifier).toContain('FROM sessions');
    expect(verifier).toContain('password_hash AS "passwordHash"');
    expect(verifier).toContain('replacementForLegacyDemoPasswordHash');
    expect(verifier).toContain('verifyLegacySessionInvalidation');
    expect(verifier).toContain('legacy-hash-session');
    expect(verifier).toContain('custom-hash-session');
    expect(verifier).toContain('seedDemoRows');
    expect(verifier).toContain('insertMissingTags: false');
    expect(verifier).toContain('synchronizeSequences: false');
    expect(verifier).toContain('disabledUserIds');
    expect(verifier).toContain('assertSequenceStateUnchanged');
    expect(verifier).toContain('ROLLBACK');
  });

  it('guards fixture reset and adoption verification without rewriting history', async () => {
    const guardPath = join(
      process.cwd(),
      'scripts',
      'database-script-guards.ts',
    );
    const setupPath = join(process.cwd(), 'scripts', 'setup-legacy-fixture.ts');

    expect(existsSync(guardPath)).toBe(true);
    expect(existsSync(setupPath)).toBe(true);

    if (!existsSync(guardPath) || !existsSync(setupPath)) {
      return;
    }

    const [guard, setup, verification] = await Promise.all([
      readFile(guardPath, 'utf8'),
      readFile(setupPath, 'utf8'),
      readFile(
        join(process.cwd(), 'scripts', 'verify-migration-adoption.ts'),
        'utf8',
      ),
    ]);

    for (const requiredGuard of [
      'ALLOW_LEGACY_FIXTURE_RESET',
      'NODE_ENV',
      'DATABASE_URL',
      'MIGRATION_ADOPTION_DATABASE',
      "endsWith('_test')",
      "hostname !== 'localhost'",
      "hostname !== '127.0.0.1'",
    ]) {
      expect(`${guard}\n${setup}`).toContain(requiredGuard);
    }

    expect(setup).toContain('DROP SCHEMA public CASCADE');
    expect(setup).toContain('legacy-runtime-schema.sql');
    expect(verification).not.toMatch(/DELETE\s+FROM\s+pgmigrations/i);
    expect(verification).toContain('ALLOW_MIGRATION_ADOPTION_TEST');
    expect(verification).toContain('pgmigrations');
    expect(verification).toContain('fingerprint');
    expect(verification).toContain('sequence');
    expect(verification).toContain('indisvalid');
    expect(verification).toContain('indisready');
    expect(verification).toContain('statement_timeout');
    expect(verification).toContain('CREATE INDEX CONCURRENTLY');
    expect(verification).toContain("query LIKE '%CREATE INDEX CONCURRENTLY%'");
    expect(verification).toContain('invalid non-ASCII legacy email');
    expect(verification).toContain('invalid control-character legacy email');
    expect(verification).toContain('trim-induced canonical collision');
    expect(verification).toContain('unknown password representation');
    expect(verification).toContain('legacy_grandfathered');
    expect(verification).toContain('octet_length(token_digest)');
    expect(verification).toContain('legacy sessions were invalidated');
    expect(verification).toContain('expectedLengthConstraints');
    expect(verification).toContain('Digest length constraint is missing for');
    expect(verification).toContain('session last-seen time beyond idle expiry');
    expect(verification).toContain(
      'pending completion beyond enrollment expiry',
    );
  });
});

describe('database script safety guards', () => {
  it.each([
    ['localhost', 'postgresql://app:app@localhost:5432/app_test'],
    ['127.0.0.1', 'postgresql://app:app@127.0.0.1:5432/app_test'],
  ])('accepts an explicitly authorized %s test database', (_, databaseUrl) => {
    expect(
      requireSafeDatabaseTarget(
        'ALLOW_LEGACY_FIXTURE_RESET',
        safeEnvironment({ DATABASE_URL: databaseUrl }),
      ),
    ).toMatchObject({
      databaseName: 'app_test',
      hostname: new URL(databaseUrl).hostname,
    });
  });

  it.each([
    [
      'missing explicit authorization',
      { ALLOW_LEGACY_FIXTURE_RESET: 'false' },
      /ALLOW_LEGACY_FIXTURE_RESET must equal true/,
    ],
    ['missing NODE_ENV', { NODE_ENV: undefined }, /NODE_ENV must be set/],
    [
      'production NODE_ENV',
      { NODE_ENV: 'production' },
      /disabled in production/,
    ],
    [
      'remote database host',
      { DATABASE_URL: 'postgresql://app:app@db.example.test:5432/app_test' },
      /restricted to localhost/,
    ],
    [
      'non-test expected database',
      { MIGRATION_ADOPTION_DATABASE: 'app' },
      /must end with _test/,
    ],
    [
      'URL and expected database mismatch',
      { MIGRATION_ADOPTION_DATABASE: 'other_test' },
      /does not match MIGRATION_ADOPTION_DATABASE/,
    ],
  ])('rejects %s before a reset can run', (_, overrides, message) => {
    expect(() =>
      requireSafeDatabaseTarget(
        'ALLOW_LEGACY_FIXTURE_RESET',
        safeEnvironment(overrides),
      ),
    ).toThrow(message);
  });

  it.each([
    ['localhost', 'postgresql://app:app@localhost:5432/app_dev'],
    ['127.0.0.1', 'postgresql://app:app@127.0.0.1:5432/app_test'],
  ])('accepts a demo database named in the exact %s allowlist', (_, url) => {
    expect(
      requireSafeDatabaseTarget(
        'ALLOW_DEMO_SEED',
        safeDemoEnvironment({ DATABASE_URL: url }),
      ),
    ).toMatchObject({
      databaseName: new URL(url).pathname.slice(1),
      allowedDatabaseNames: ['app_dev', 'app_test'],
    });
  });

  it.each([
    [
      'missing allowlist',
      { DEMO_SEED_DATABASES: undefined },
      /DEMO_SEED_DATABASES must be set/,
    ],
    [
      'database outside the allowlist',
      { DATABASE_URL: 'postgresql://app:app@localhost:5432/other_dev' },
      /is not included in DEMO_SEED_DATABASES/,
    ],
    [
      'empty allowlist entry',
      { DEMO_SEED_DATABASES: 'app_dev,,app_test' },
      /must contain comma-separated exact database names/,
    ],
  ])('rejects a demo seed with %s', (_, overrides, message) => {
    expect(() =>
      requireSafeDatabaseTarget(
        'ALLOW_DEMO_SEED',
        safeDemoEnvironment(overrides),
      ),
    ).toThrow(message);
  });

  it('rejects a connected database that is not in the preflight allowlist', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({
        rows: [{ database: 'other_dev' }],
      }),
    };

    await expect(
      assertConnectedDatabase(client, ['app_dev', 'app_test']),
    ).rejects.toThrow(/does not match guarded database allowlist/);
  });

  it('quotes database catalog identifiers before using them in SQL', () => {
    expect(quoteSqlIdentifier('public')).toBe('"public"');
    expect(quoteSqlIdentifier('odd"sequence')).toBe('"odd""sequence"');
  });
});

describe('demo seed safety invariants', () => {
  it('uses a disabled marker that cannot equal a SHA-256 hex digest', () => {
    expect(DEMO_SEED_DISABLED_PASSWORD_HASH).toBe('disabled:demo-seed-login');
    expect(DEMO_SEED_DISABLED_PASSWORD_HASH).not.toMatch(/^[a-f0-9]{64}$/i);
  });

  it('replaces only the exact password hash written by the legacy demo seed', () => {
    expect(
      replacementForLegacyDemoPasswordHash(
        '47f65a9430b5f109208eea5ad01ce9f5c8335244bfab3626eb91aea9a7b97b87',
      ),
    ).toBe(DEMO_SEED_DISABLED_PASSWORD_HASH);
    expect(replacementForLegacyDemoPasswordHash('custom-password-hash')).toBe(
      undefined,
    );
  });

  it.each([
    [
      'user',
      { id: 1, email: 'other@example.test' },
      { id: 1, email: 'demo@example.test' },
    ],
    [
      'post',
      { id: 1, authorId: 2, videoUrl: 'https://video.example/one' },
      { id: 1, authorId: 1, videoUrl: 'https://video.example/one' },
    ],
    [
      'playlist',
      { id: 1, ownerId: 1, title: 'Unrelated playlist' },
      { id: 1, ownerId: 1, title: 'Demo playlist' },
    ],
    [
      'comment',
      { id: 1, postId: 2, authorId: 1 },
      { id: 1, postId: 1, authorId: 1 },
    ],
    [
      'feedback',
      { id: 1, playlistId: 2, authorId: 1 },
      { id: 1, playlistId: 1, authorId: 1 },
    ],
  ])(
    'aborts when a fixed %s id has a different stable identity',
    (kind, actual, expected) => {
      expect(() => assertStableIdentity(kind, actual, expected)).toThrow(
        new RegExp(`Demo ${kind} stable identity mismatch`),
      );
    },
  );

  it('uses title as part of a playlist stable identity', () => {
    expect(
      demoPlaylistStableIdentity({
        id: 7,
        ownerId: 3,
        title: 'Demo learning route',
      }),
    ).toEqual({
      id: 7,
      ownerId: 3,
      title: 'Demo learning route',
    });
  });

  it('accepts an exact stable identity while ignoring mutable fields', () => {
    expect(() =>
      assertStableIdentity(
        'post',
        {
          id: 1,
          authorId: 1,
          videoUrl: 'https://video.example/one',
          title: 'A locally edited title',
        },
        {
          id: 1,
          authorId: 1,
          videoUrl: 'https://video.example/one',
        },
      ),
    ).not.toThrow();
  });

  it.each([
    ['a sequence equal to the maximum id', 5, 5, true],
    ['a sequence behind the maximum id', 5, 3, true],
    ['a sequence already ahead of the maximum id', 5, 8, false],
    ['a restarted sequence ahead of the maximum id', 5, 1000, false],
    ['an empty table', 0, 1, false],
  ])(
    'advances %s without moving a sequence backwards',
    (_, maxId, lastValue, expected) => {
      expect(shouldAdvanceSequence(maxId, lastValue)).toBe(expected);
    },
  );
});
