import { createHash } from 'node:crypto';
import { AuthRepositoryUnavailableError } from './auth/auth.repository';
import { PostgresVerificationEmailOutboxRepository } from './auth/verification-email-outbox.repository';
import { DatabaseService } from './database.service';
import { createObservabilityRuntime } from './observability';
import { PostgresWorkRepository } from './work/postgres-work.repository';

const AUTH_NOW = new Date('2026-07-28T12:00:00.000Z');
const PENDING_ID = '11111111-1111-4111-8111-111111111111';
const OUTBOX_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

function configService(overrides: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string) => overrides[key]),
  } as never;
}

function replacePool(
  service: DatabaseService,
  query: jest.Mock,
  end: jest.Mock = jest.fn(() => Promise.resolve()),
) {
  (
    service as unknown as {
      pool: {
        query: jest.Mock;
        end: jest.Mock;
      };
    }
  ).pool = { query, end };
}

function replacePoolConnection(
  service: DatabaseService,
  query: jest.Mock,
  release: jest.Mock = jest.fn(),
) {
  const connect = jest.fn().mockResolvedValue({ query, release });
  const end = jest.fn(() => Promise.resolve());

  (
    service as unknown as {
      pool: {
        connect: jest.Mock;
        end: jest.Mock;
      };
    }
  ).pool = { connect, end };

  return { connect, end, release };
}

function sqlTexts(query: jest.Mock): string[] {
  const calls = query.mock.calls as unknown as Array<[string, ...unknown[]]>;
  return calls.map(([sql]) => sql);
}

describe('DatabaseService fail-fast persistence', () => {
  it('attaches pool pressure metrics when the PostgreSQL pool is created', async () => {
    const observability = createObservabilityRuntime('database-test');
    const service = new DatabaseService(configService(), observability);

    const output = observability.registry.toPrometheus();
    expect(output).toContain('studytube_db_pool_connections{state="total"} 0');
    expect(output).toContain('studytube_db_pool_connections{state="idle"} 0');
    expect(output).toContain('studytube_db_pool_waiting 0');

    await service.onModuleDestroy();
  });

  it('refuses to construct a production pool without DATABASE_URL', () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new DatabaseService(configService())).toThrow(
        'DATABASE_URL must be explicitly configured in production',
      );
    } finally {
      if (previousEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousEnvironment;
      }
    }
  });

  it('shares one PostgreSQL work repository with API domain services', () => {
    const service = new DatabaseService(configService());
    const workOwner = service as unknown as {
      getWorkRepository(): unknown;
    };

    const first = workOwner.getWorkRepository();
    const second = workOwner.getWorkRepository();

    expect(first).toBeInstanceOf(PostgresWorkRepository);
    expect(second).toBe(first);
  });

  it('shares one verification email outbox repository with the worker', () => {
    const service = new DatabaseService(configService());

    const first = service.getVerificationEmailOutboxRepository();
    const second = service.getVerificationEmailOutboxRepository();

    expect(first).toBeInstanceOf(PostgresVerificationEmailOutboxRepository);
    expect(second).toBe(first);
  });

  it('retries connectivity and rejects startup without loading fallback data', async () => {
    const service = new DatabaseService(
      configService({
        DB_INIT_ATTEMPTS: '3',
        DB_INIT_RETRY_DELAY_MS: '0',
        DB_QUERY_TIMEOUT_MS: '1250',
      }),
    );
    const connectionError = new Error('database is still starting');
    const query = jest.fn(() => Promise.reject(connectionError));
    replacePool(service, query);

    await expect(service.onModuleInit()).rejects.toBe(connectionError);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls).toEqual([
      [{ text: 'SELECT 1 AS ok', query_timeout: 1250 }],
      [{ text: 'SELECT 1 AS ok', query_timeout: 1250 }],
      [{ text: 'SELECT 1 AS ok', query_timeout: 1250 }],
    ]);

    await service.onModuleDestroy();
  });

  it('refuses production startup when a required migration is pending', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const service = new DatabaseService(
      configService({
        DATABASE_URL: 'postgresql://app:app@localhost:5432/app_test',
        DB_INIT_ATTEMPTS: '1',
      }),
    );
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    replacePool(service, query);

    try {
      await expect(service.onModuleInit()).rejects.toThrow(
        'Production startup refused because database migrations are pending',
      );
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      await service.onModuleDestroy();
      if (previousEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousEnvironment;
      }
    }
  });

  it('redacts credentials from startup retry warnings while retaining PostgreSQL context', async () => {
    const service = new DatabaseService(
      configService({
        DB_INIT_ATTEMPTS: '2',
        DB_INIT_RETRY_DELAY_MS: '0',
      }),
    );
    const connectionError = Object.assign(
      new Error(
        'password authentication failed for postgresql://admin:uri-password@db.internal:5432/app?sslmode=require&access_token=query-token&client_secret=query-secret',
      ),
      { code: '28P01' },
    );
    const query = jest.fn().mockRejectedValue(connectionError);
    replacePool(service, query);
    const logger = (
      service as unknown as {
        logger: { warn: (message: string) => void };
      }
    ).logger;
    const logWarn = jest.spyOn(logger, 'warn').mockImplementation();

    await expect(service.onModuleInit()).rejects.toBe(connectionError);

    expect(logWarn).toHaveBeenCalledTimes(1);
    const loggedMessage = String(logWarn.mock.calls[0][0]);
    expect(loggedMessage).toContain('password authentication failed');
    expect(loggedMessage).toContain('db.internal:5432/app');
    expect(loggedMessage).toContain('PostgreSQL code 28P01');
    expect(loggedMessage).toContain('postgresql://[redacted]@');
    expect(loggedMessage).toContain('access_token=[redacted]');
    expect(loggedMessage).toContain('client_secret=[redacted]');
    expect(loggedMessage).not.toContain('admin');
    expect(loggedMessage).not.toContain('uri-password');
    expect(loggedMessage).not.toContain('query-token');
    expect(loggedMessage).not.toContain('query-secret');

    await service.onModuleDestroy();
  });

  it('checks connectivity only and never mutates schema during startup', async () => {
    const service = new DatabaseService(configService());
    const query = jest.fn(() =>
      Promise.resolve({ rows: [{ ok: 1 }], rowCount: 1 }),
    );
    replacePool(service, query);

    await service.onModuleInit();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({
      text: 'SELECT 1 AS ok',
      query_timeout: 3000,
    });

    await service.onModuleDestroy();
  });

  it('reports a successful health probe using the configured query timeout', async () => {
    const service = new DatabaseService(
      configService({ DB_QUERY_TIMEOUT_MS: '1750' }),
    );
    const query = jest.fn(() =>
      Promise.resolve({ rows: [{ ok: 1 }], rowCount: 1 }),
    );
    replacePool(service, query);

    await expect(service.health()).resolves.toMatchObject({
      service: 'api',
      status: 'ok',
      ready: true,
      database: 'postgresql + pgvector',
    });
    expect(query).toHaveBeenCalledWith({
      text: 'SELECT 1 AS ok',
      query_timeout: 1750,
    });

    await service.onModuleDestroy();
  });

  it('propagates operational query failures without switching repositories', async () => {
    const service = new DatabaseService(configService());
    const queryError = new Error('unique constraint violation');
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 })
      .mockRejectedValueOnce(queryError);
    replacePool(service, query);

    await service.onModuleInit();

    await expect(service.listPosts({ page: 1, pageSize: 6 })).rejects.toBe(
      queryError,
    );
    expect(query).toHaveBeenCalledTimes(3);

    await service.onModuleDestroy();
  });

  it('reports a generic health error while logging the database failure', async () => {
    const service = new DatabaseService(
      configService({ DB_QUERY_TIMEOUT_MS: '0' }),
    );
    const rawMessage =
      'connect ECONNREFUSED postgres://admin:uri-secret@db.internal:5432/app?password=query-password&session_token=query-token';
    const query = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error(rawMessage), { code: '08001' }),
      );
    replacePool(service, query);
    const logger = (
      service as unknown as {
        logger: { error: (message: string) => void };
      }
    ).logger;
    const logError = jest.spyOn(logger, 'error').mockImplementation();

    const result = await service.health();

    expect(result).toEqual({
      service: 'api',
      status: 'unavailable',
      ready: false,
      database: 'postgresql + pgvector',
      error: 'database_unavailable',
      timestamp: result.timestamp,
    });
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(rawMessage);
    expect(logError).toHaveBeenCalledTimes(1);
    const loggedMessage = String(logError.mock.calls[0][0]);
    expect(loggedMessage).toContain('connect ECONNREFUSED');
    expect(loggedMessage).toContain('db.internal:5432/app');
    expect(loggedMessage).toContain('PostgreSQL code 08001');
    expect(loggedMessage).toContain('postgres://[redacted]@');
    expect(loggedMessage).toContain('password=[redacted]');
    expect(loggedMessage).toContain('session_token=[redacted]');
    expect(loggedMessage).not.toContain('admin');
    expect(loggedMessage).not.toContain('uri-secret');
    expect(loggedMessage).not.toContain('query-password');
    expect(loggedMessage).not.toContain('query-token');
    expect(query).toHaveBeenCalledWith({
      text: 'SELECT 1 AS ok',
      query_timeout: 3000,
    });

    await service.onModuleDestroy();
  });
});

describe('DatabaseService verified enrollment persistence', () => {
  it('atomically consumes a fixed-window rate limit in one PostgreSQL statement', async () => {
    const service = new DatabaseService(configService());
    const query = jest.fn().mockResolvedValue({
      rows: [{ allowed: false, remaining: 0, retryAfterSeconds: 42 }],
      rowCount: 1,
    });
    replacePool(service, query);
    const subjectDigest = Buffer.alloc(32, 1);

    await expect(
      service.consumeRateLimit({
        action: 'signup_email',
        subjectDigest,
        windowSeconds: 60,
        maxAttempts: 5,
      }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 42 });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO auth_rate_limits');
    expect(sql).toContain('ON CONFLICT (action, subject_digest, window_start)');
    expect(sql).toContain('attempts = auth_rate_limits.attempts + 1');
    expect(sql).toContain('RETURNING');
    expect(sql).toContain('statement_timestamp()');
    expect(values).toEqual(['signup_email', subjectDigest, 60, 5]);
  });

  it('creates pending registration and immutable outbox metadata in one transaction', async () => {
    const service = new DatabaseService(configService());
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ userExists: false }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);
    const command = pendingRegistrationCommand();

    await expect(service.createPendingRegistration(command)).resolves.toEqual({
      status: 'accepted',
    });

    const calls = query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('FOR UPDATE OF pending'),
      expect.stringContaining('FROM users'),
      expect.stringContaining('INSERT INTO pending_registrations'),
      expect.stringContaining('INSERT INTO verification_email_outbox'),
      'COMMIT',
    ]);
    expect(calls[2][0]).toContain('pending_registrations');
    expect(calls[4][1]).toEqual([
      PENDING_ID,
      'ada@example.com',
      'ada@example.com',
      1,
      command.verificationDigest,
      command.createdAt,
      command.verificationExpiresAt,
    ]);
    expect(calls[4][0]).toContain('created_at');
    expect(calls[5][1]).toEqual([
      OUTBOX_ID,
      PENDING_ID,
      'ada@example.com',
      command.outbox.idempotencyKey,
      command.outbox.sender,
      command.outbox.publicOrigin,
      command.outbox.templateVersion,
      command.outbox.locale,
      command.outbox.subject,
      command.outbox.payloadHash,
    ]);
    expect(calls.join(' ')).not.toContain('password');
    expect(calls.join(' ')).not.toContain('INSERT INTO users');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('normalizes an existing account to accepted from the eligibility query', async () => {
    const existingService = new DatabaseService(configService());
    const existingQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ userExists: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    replacePoolConnection(existingService, existingQuery);

    await expect(
      existingService.createPendingRegistration(pendingRegistrationCommand()),
    ).resolves.toEqual({ status: 'accepted' });
    expect(sqlTexts(existingQuery)).toEqual([
      'BEGIN',
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('FOR UPDATE OF pending'),
      expect.stringContaining('FROM users'),
      'COMMIT',
    ]);
  });

  it('serializes resend and requeues the existing token without invalidating it', async () => {
    const oldPendingId = '44444444-4444-4444-8444-444444444444';
    const service = new DatabaseService(configService());
    const query = pendingRegistrationStateQuery({
      activeRows: [
        {
          id: oldPendingId,
          verifiedAt: null,
          deliveryInProgress: false,
        },
      ],
    });
    replacePoolConnection(service, query);

    await expect(
      service.createPendingRegistration(pendingRegistrationCommand('resend')),
    ).resolves.toEqual({ status: 'accepted' });

    const calls = query.mock.calls as Array<[string, unknown[]?]>;
    const sql = calls.map(([statement]) => statement);
    const lockIndex = sql.findIndex((statement) =>
      statement.includes('pg_advisory_xact_lock'),
    );
    const pendingLockIndex = sql.findIndex((statement) =>
      statement.includes('FOR UPDATE OF pending'),
    );
    expect(lockIndex).toBeGreaterThan(sql.indexOf('BEGIN'));
    expect(pendingLockIndex).toBeGreaterThan(lockIndex);
    expect(sql).toEqual(
      expect.arrayContaining([
        expect.stringContaining('INSERT INTO verification_email_outbox'),
      ]),
    );
    expect(sql.join(' ')).not.toContain('SET attempt_count = max_attempts');
    expect(sql.join(' ')).not.toContain('INSERT INTO pending_registrations');
    const requeue = calls.find(
      ([statement]) =>
        statement.includes('INSERT INTO verification_email_outbox') &&
        statement.includes('SELECT'),
    );
    expect(requeue?.[0]).toContain('source.payload_hash');
    expect(requeue?.[1]).toEqual([
      OUTBOX_ID,
      pendingRegistrationCommand('resend').outbox.idempotencyKey,
      oldPendingId,
    ]);
    const eligibility = calls.find(([statement]) =>
      statement.includes('AS "deliveryInProgress"'),
    );
    expect(eligibility?.[0]).toContain('outbox.attempts < $2');
    expect(eligibility?.[0]).toContain(
      'outbox.lease_expires_at > statement_timestamp()',
    );
    expect(eligibility?.[1]).toEqual(['ada@example.com', 5]);
    const terminalize = calls.find(([statement]) =>
      statement.includes("last_error_code = 'delivery_attempts_exhausted'"),
    );
    expect(terminalize?.[0]).toContain('attempts >= $2');
    expect(terminalize?.[0]).toContain(
      'lease_expires_at <= statement_timestamp()',
    );
    expect(terminalize?.[1]).toEqual([oldPendingId, 5]);
    expect(sql.at(-1)).toBe('COMMIT');
  });

  it('coalesces resend while an unsent delivery is queued or leased', async () => {
    const service = new DatabaseService(
      configService({ AUTH_EMAIL_MAX_ATTEMPTS: '7' }),
    );
    const query = pendingRegistrationStateQuery({
      activeRows: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          verifiedAt: null,
          deliveryInProgress: true,
        },
      ],
    });
    replacePoolConnection(service, query);

    await expect(
      service.createPendingRegistration(pendingRegistrationCommand('resend')),
    ).resolves.toEqual({ status: 'accepted' });

    const sql = sqlTexts(query);
    expect(sql).toEqual(
      expect.arrayContaining([
        expect.stringContaining('pg_advisory_xact_lock'),
        expect.stringContaining('FOR UPDATE OF pending'),
      ]),
    );
    expect(sql.join(' ')).not.toContain('INSERT INTO pending_registrations');
    expect(sql.join(' ')).not.toContain(
      'INSERT INTO verification_email_outbox',
    );
    expect(sql.join(' ')).not.toContain(
      "last_error_code = 'delivery_attempts_exhausted'",
    );
    const eligibility = query.mock.calls.find(([statement]: [string]) =>
      statement.includes('AS "deliveryInProgress"'),
    ) as [string, unknown[]] | undefined;
    expect(eligibility?.[1]).toEqual(['ada@example.com', 7]);
  });

  it('does not replace an already verified pending enrollment', async () => {
    const service = new DatabaseService(configService());
    const query = pendingRegistrationStateQuery({
      activeRows: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          verifiedAt: AUTH_NOW,
          deliveryInProgress: false,
        },
      ],
    });
    replacePoolConnection(service, query);

    await expect(
      service.createPendingRegistration(pendingRegistrationCommand('resend')),
    ).resolves.toEqual({ status: 'accepted' });

    const sql = sqlTexts(query).join(' ');
    expect(sql).toContain('FOR UPDATE OF pending');
    expect(sql).toContain("statement_timestamp() + interval '2 minutes'");
    expect(sql).toContain(
      'pending.enrollment_expires_at > statement_timestamp()',
    );
    expect(sql).toContain('(pending.verified_at IS NOT NULL) DESC');
    expect(sql).not.toContain('INSERT INTO pending_registrations');
    expect(sql).not.toContain('INSERT INTO verification_email_outbox');
  });

  it('creates a new pending token only after no live unverified token remains', async () => {
    const service = new DatabaseService(configService());
    const query = pendingRegistrationStateQuery({ activeRows: [] });
    replacePoolConnection(service, query);

    await expect(
      service.createPendingRegistration(pendingRegistrationCommand('resend')),
    ).resolves.toEqual({ status: 'accepted' });

    const sql = sqlTexts(query).join(' ');
    expect(sql).toContain('INSERT INTO pending_registrations');
    expect(sql).toContain('INSERT INTO verification_email_outbox');
  });

  it('rolls back and sanitizes a pending-registration unique violation', async () => {
    const service = new DatabaseService(configService());
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ userExists: false }], rowCount: 1 })
      .mockRejectedValueOnce(
        Object.assign(new Error('pending digest detail'), {
          code: '23505',
          constraint: 'pending_registrations_verification_digest_key',
        }),
      )
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);

    await expect(
      service.createPendingRegistration(pendingRegistrationCommand()),
    ).rejects.toThrow('Authentication persistence failed');
    expect(sqlTexts(query).at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and sanitizes an outbox idempotency unique violation', async () => {
    const service = new DatabaseService(configService());
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ userExists: false }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(
        Object.assign(new Error('outbox detail'), {
          code: '23505',
          constraint: 'verification_email_outbox_idempotency_key',
        }),
      )
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);

    await expect(
      service.createPendingRegistration(pendingRegistrationCommand()),
    ).rejects.toThrow('Authentication persistence failed');
    expect(sqlTexts(query).at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('locks verification, installs one enrollment digest, then commits', async () => {
    const service = new DatabaseService(configService());
    const command = verificationCommand();
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [pendingVerificationRow(command.presentedVerificationDigest)],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);

    await expect(service.consumeVerification(command)).resolves.toEqual({
      status: 'verified',
    });

    const calls = query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('SET verified_at'),
      'COMMIT',
    ]);
    expect(calls[2][1]).toEqual([
      PENDING_ID,
      command.verifiedAt,
      command.enrollmentDigest,
      command.enrollmentExpiresAt,
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('commits exactly one failed-attempt increment for a well-formed wrong secret', async () => {
    const service = new DatabaseService(configService());
    const command = verificationCommand();
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [pendingVerificationRow(Buffer.alloc(32, 99), 4, 5)],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ attemptCount: 5, maxAttempts: 5 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    replacePoolConnection(service, query);

    await expect(service.consumeVerification(command)).resolves.toEqual({
      status: 'invalid',
    });

    const calls = query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('attempt_count = attempt_count + 1'),
      'COMMIT',
    ]);
    expect(calls[2][0]).toContain('attempt_count < max_attempts');
  });

  it.each([
    ['expired', { verificationExpiresAt: new Date('2026-07-28T11:59:59Z') }],
    ['exhausted', { attemptCount: 5, maxAttempts: 5 }],
    ['consumed', { verifiedAt: AUTH_NOW }],
    ['completed', { completedAt: AUTH_NOW }],
  ])(
    'rolls back without mutation when verification is %s',
    async (_case, changes) => {
      const service = new DatabaseService(configService());
      const command = verificationCommand();
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: null })
        .mockResolvedValueOnce({
          rows: [
            {
              ...pendingVerificationRow(command.presentedVerificationDigest),
              ...changes,
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: null });
      replacePoolConnection(service, query);

      await expect(service.consumeVerification(command)).resolves.toEqual({
        status: 'invalid',
      });
      expect(sqlTexts(query)).toEqual([
        'BEGIN',
        expect.stringContaining('FOR UPDATE'),
        'ROLLBACK',
      ]);
    },
  );

  it('locks the pending proof before user, digest session, and completion writes', async () => {
    const service = new DatabaseService(configService());
    const command = completionCommand();
    const user = {
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      createdAt: AUTH_NOW,
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [completionPendingRow(command.enrollmentDigest)],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [user], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);

    await expect(service.completeRegistration(command)).resolves.toEqual({
      status: 'completed',
      user: { ...user, createdAt: AUTH_NOW.toISOString() },
    });

    const calls = query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('INSERT INTO users'),
      expect.stringContaining('INSERT INTO sessions'),
      expect.stringContaining('SET completed_at'),
      'COMMIT',
    ]);
    expect(calls[2][0]).toContain('email_canonical');
    expect(calls[2][1]).toEqual([
      'Ada',
      'ada@example.com',
      'ada@example.com',
      command.passwordHash,
      'argon2id',
      JSON.stringify({ memoryKiB: 65536, timeCost: 3, parallelism: 1 }),
      1,
      'email_verified',
      command.completedAt,
    ]);
    expect(calls[3][1]).toEqual([
      SESSION_ID,
      command.sessionDigest,
      7,
      command.sessionCreatedAt,
      command.sessionAbsoluteExpiresAt,
      command.sessionIdleExpiresAt,
      command.sessionCreatedAt,
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(['users_email_canonical_key', 'users_email_key'])(
    'normalizes a user insert %s conflict after rollback',
    async (constraint) => {
      const command = completionCommand();
      const service = new DatabaseService(configService());
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: null })
        .mockResolvedValueOnce({
          rows: [completionPendingRow(command.enrollmentDigest)],
          rowCount: 1,
        })
        .mockRejectedValueOnce(
          Object.assign(new Error('email=secret@example.com'), {
            code: '23505',
            constraint,
          }),
        )
        .mockResolvedValueOnce({ rows: [], rowCount: null });
      const { release } = replacePoolConnection(service, query);

      await expect(service.completeRegistration(command)).resolves.toEqual({
        status: 'conflict',
      });
      expect(sqlTexts(query)).toEqual([
        'BEGIN',
        expect.stringContaining('FOR UPDATE'),
        expect.stringContaining('INSERT INTO users'),
        'ROLLBACK',
      ]);
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it('sanitizes an unexpected user insert unique violation', async () => {
    const command = completionCommand();
    const service = new DatabaseService(configService());
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [completionPendingRow(command.enrollmentDigest)],
        rowCount: 1,
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('unexpected user id detail'), {
          code: '23505',
          constraint: 'users_pkey',
        }),
      )
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);

    await expect(service.completeRegistration(command)).rejects.toThrow(
      'Authentication persistence failed',
    );
    expect(sqlTexts(query)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('INSERT INTO users'),
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(['sessions_pkey', 'sessions_token_digest_key'])(
    'sanitizes a post-user-insert %s collision and rolls back the user',
    async (constraint) => {
      const command = completionCommand();
      const service = new DatabaseService(configService());
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: null })
        .mockResolvedValueOnce({
          rows: [completionPendingRow(command.enrollmentDigest)],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 7,
              name: 'Ada',
              email: 'ada@example.com',
              createdAt: AUTH_NOW,
            },
          ],
          rowCount: 1,
        })
        .mockRejectedValueOnce(
          Object.assign(new Error('session secret detail'), {
            code: '23505',
            constraint,
          }),
        )
        .mockResolvedValueOnce({ rows: [], rowCount: null });
      const { release } = replacePoolConnection(service, query);

      await expect(service.completeRegistration(command)).rejects.toThrow(
        'Authentication persistence failed',
      );
      expect(sqlTexts(query)).toEqual([
        'BEGIN',
        expect.stringContaining('FOR UPDATE'),
        expect.stringContaining('INSERT INTO users'),
        expect.stringContaining('INSERT INTO sessions'),
        'ROLLBACK',
      ]);
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it('sanitizes non-unique database failures', async () => {
    const failedService = new DatabaseService(configService());
    const failedQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockRejectedValueOnce(new Error('password=secret token=raw'))
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(failedService, failedQuery);

    await expect(
      failedService.createPendingRegistration(pendingRegistrationCommand()),
    ).rejects.toThrow('Authentication persistence failed');
    expect(release).toHaveBeenCalled();
  });

  it('sanitizes a transaction connection failure before a client exists', async () => {
    const service = new DatabaseService(configService());
    const connect = jest
      .fn()
      .mockRejectedValue(new Error('postgres://admin:secret@db/internal'));
    (
      service as unknown as {
        pool: { connect: jest.Mock; end: jest.Mock };
      }
    ).pool = { connect, end: jest.fn() };

    await expect(
      service.createPendingRegistration(pendingRegistrationCommand()),
    ).rejects.toThrow('Authentication persistence failed');
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('DatabaseService core session persistence', () => {
  it('finds one exact canonical credential without lowercasing in PostgreSQL', async () => {
    const service = new DatabaseService(configService());
    const row = authCredentialRow();
    const query = jest.fn().mockResolvedValue({ rows: [row], rowCount: 1 });
    replacePool(service, query);

    await expect(
      service.findAuthUser({ emailCanonical: 'ada@example.com' }),
    ).resolves.toEqual({
      user: { ...row, createdAt: row.createdAt.toISOString() },
    });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE email_canonical = $1');
    expect(sql).not.toContain('lower(');
    expect(values).toEqual(['ada@example.com']);
  });

  it('locks the verified hash and version, upgrades, inserts the digest session, then commits', async () => {
    const service = new DatabaseService(configService());
    const command = loginCommitCommand();
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [authCredentialRow()],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);

    await expect(service.commitLogin(command)).resolves.toMatchObject({
      status: 'committed',
      user: { id: 7, email: 'ada@example.com' },
    });

    const calls = query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('UPDATE users'),
      expect.stringContaining('INSERT INTO sessions'),
      'COMMIT',
    ]);
    expect(calls[1][0]).toContain('password_hash = $2');
    expect(calls[1][0]).toContain('password_version = $3');
    expect(calls[1][1]).toEqual([
      7,
      command.expectedPasswordHash,
      command.expectedPasswordVersion,
    ]);
    expect(calls[2][0]).toContain('password_hash = $6');
    expect(calls[2][0]).toContain('password_version = $7');
    expect(calls[3][1]).toEqual([
      SESSION_ID,
      command.sessionDigest,
      7,
      command.sessionCreatedAt,
      command.sessionAbsoluteExpiresAt,
      command.sessionIdleExpiresAt,
    ]);
    expect(calls.join(' ')).not.toContain('raw-session-cookie');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns stale with guarded rollback and release when the CAS predicate loses', async () => {
    const service = new DatabaseService(configService());
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);

    await expect(service.commitLogin(loginCommitCommand())).resolves.toEqual({
      status: 'stale',
    });
    expect(sqlTexts(query)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('uses database time for active lookup and one capped 15-minute touch', async () => {
    const service = new DatabaseService(configService());
    const sessionDigest = Buffer.alloc(32, 9);
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          sessionId: SESSION_ID,
          userId: 7,
          name: 'Ada',
          email: 'ada@example.com',
          userCreatedAt: AUTH_NOW,
        },
      ],
      rowCount: 1,
    });
    replacePool(service, query);

    const result = await service.findActiveSession({ sessionDigest });
    expect(result).toMatchObject({
      status: 'active',
      principal: { sessionId: SESSION_ID, userId: 7 },
      user: { id: 7, email: 'ada@example.com' },
    });
    expect(Object.isFrozen(result)).toBe(true);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('s.revoked_at IS NULL');
    expect(sql).toContain('s.absolute_expires_at > statement_timestamp()');
    expect(sql).toContain('s.idle_expires_at > statement_timestamp()');
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain('LEAST(');
    expect(sql).toContain("interval '24 hours'");
    expect(values).toEqual([sessionDigest]);
    expect(
      callsContainBuffer(
        query.mock.calls as unknown as unknown[][],
        sessionDigest,
      ),
    ).toBe(true);
  });

  it('returns invalid when the active lookup filters revoked or expired rows', async () => {
    const service = new DatabaseService(configService());
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    replacePool(service, query);

    await expect(
      service.findActiveSession({ sessionDigest: Buffer.alloc(32, 6) }),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('persists bounded logout revocation and makes reuse invalid', async () => {
    const service = new DatabaseService(configService());
    const sessionDigest = Buffer.alloc(32, 7);
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: SESSION_ID }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    replacePool(service, query);

    await expect(
      service.revokeActiveSession({ sessionDigest, reason: 'logout' }),
    ).resolves.toEqual({ status: 'revoked' });
    await expect(
      service.revokeActiveSession({ sessionDigest, reason: 'logout' }),
    ).resolves.toEqual({ status: 'invalid' });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('revoked_at = statement_timestamp()');
    expect(sql).toContain('revoked_at IS NULL');
    expect(values).toEqual([sessionDigest, 'logout']);
  });

  it('returns digest-only enrollment readiness using PostgreSQL time', async () => {
    const service = new DatabaseService(configService());
    const enrollmentDigest = Buffer.alloc(32, 8);
    const query = jest
      .fn()
      .mockResolvedValue({ rows: [{ ready: true }], rowCount: 1 });
    replacePool(service, query);

    await expect(
      service.findEnrollmentReadiness({ enrollmentDigest }),
    ).resolves.toEqual({ status: 'ready' });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('enrollment_digest = $1');
    expect(sql).toContain('enrollment_expires_at > statement_timestamp()');
    expect(sql).toContain('completed_at IS NULL');
    expect(values).toEqual([enrollmentDigest]);
  });

  it('sanitizes a login session collision as a typed availability failure', async () => {
    const service = new DatabaseService(configService());
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [authCredentialRow()],
        rowCount: 1,
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('raw-session-cookie password=secret'), {
          code: '23505',
          constraint: 'sessions_token_digest_key',
        }),
      )
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);
    const command = loginCommitCommand();
    Reflect.deleteProperty(command, 'passwordUpgrade');

    const error: unknown = await service
      .commitLogin(command)
      .catch((caught: unknown): unknown => caught);
    expect(error).toBeInstanceOf(AuthRepositoryUnavailableError);
    expect(error).toMatchObject({
      code: 'AUTH_REPOSITORY_UNAVAILABLE',
      message: 'Authentication persistence failed',
    });
    expect(sqlTexts(query).at(3)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalled();
  });
});

describe('DatabaseService durable post work', () => {
  it('commits the post and its asset and retrieval events in one transaction', async () => {
    const service = new DatabaseService(configService());
    const timestamp = new Date('2026-07-29T00:00:00.000Z');
    const clientQuery = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO posts')) {
        return Promise.resolve({
          rows: [
            {
              id: 42,
              authorId: 7,
              authorName: 'Learner',
              title: 'Durable post',
              videoUrl: 'https://youtu.be/durablePost',
              thumbnailUrl: '',
              channelName: 'StudyTube',
              summary: 'Summary',
              translatedNotes: 'Notes',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const poolQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const release = jest.fn();
    (
      service as unknown as {
        pool: {
          connect(): Promise<{ query: jest.Mock; release: jest.Mock }>;
          query: jest.Mock;
        };
      }
    ).pool = {
      connect: () => Promise.resolve({ query: clientQuery, release }),
      query: poolQuery,
    };

    await service.createPost({
      authorId: 7,
      title: 'Durable post',
      videoUrl: 'https://youtu.be/durablePost',
      thumbnailUrl: '',
      channelName: 'StudyTube',
      summary: 'Summary',
      translatedNotes: 'Notes',
      tags: [],
    });

    const sql = sqlTexts(clientQuery);
    const outboxIndexes = sql
      .map((statement, index) =>
        statement.includes('INSERT INTO work_outbox_events') ? index : -1,
      )
      .filter((index) => index >= 0);
    expect(outboxIndexes).toHaveLength(2);
    expect(outboxIndexes[0]).toBeGreaterThan(sql.indexOf('BEGIN'));
    expect(outboxIndexes[1]).toBeLessThan(sql.indexOf('COMMIT'));
    const calls = clientQuery.mock.calls as unknown as Array<
      [string, unknown[]]
    >;
    const values = calls[outboxIndexes[0] ?? -1]?.[1] ?? [];
    expect(values.slice(1, 7)).toEqual([
      'video_asset.requested',
      'post',
      '42',
      1,
      1,
      expect.objectContaining({
        postId: 42,
        videoUrl: 'https://youtu.be/durablePost',
      }),
    ]);
    expect(calls[outboxIndexes[1] ?? -1]?.[1]?.[1]).toBe(
      'retrieval_embedding.requested',
    );
    expect(release).toHaveBeenCalled();
  });

  it('commits a manual asset request and its outbox event atomically', async () => {
    const service = new DatabaseService(configService());
    const timestamp = new Date('2026-07-29T00:00:00.000Z');
    const clientQuery = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO video_assets')) {
        return Promise.resolve({
          rows: [
            {
              id: 9,
              postId: 42,
              videoId: 'durablePost',
              videoUrl: 'https://youtu.be/durablePost',
              language: 'ko',
              sourceLanguage: '',
              status: 'processing',
              sourceCaptionStatus: 'pending',
              translationStatus: 'pending',
              summaryStatus: 'pending',
              sourceSegments: [],
              translatedSegments: [],
              summarySections: [],
              transcriptBody: '',
              errorMessage: '',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const release = jest.fn();
    (
      service as unknown as {
        pool: {
          connect(): Promise<{ query: jest.Mock; release: jest.Mock }>;
        };
      }
    ).pool = {
      connect: () => Promise.resolve({ query: clientQuery, release }),
    };

    await (
      service as unknown as {
        requestVideoAssetPreparation(input: {
          postId: number;
          videoId: string;
          videoUrl: string;
          language: string;
        }): Promise<unknown>;
      }
    ).requestVideoAssetPreparation({
      postId: 42,
      videoId: 'durablePost',
      videoUrl: 'https://youtu.be/durablePost',
      language: 'ko',
    });

    const sql = sqlTexts(clientQuery);
    const assetIndex = sql.findIndex((statement) =>
      statement.includes('INSERT INTO video_assets'),
    );
    const outboxIndex = sql.findIndex((statement) =>
      statement.includes('INSERT INTO work_outbox_events'),
    );
    expect(assetIndex).toBeGreaterThan(sql.indexOf('BEGIN'));
    expect(outboxIndex).toBeGreaterThan(assetIndex);
    expect(outboxIndex).toBeLessThan(sql.indexOf('COMMIT'));
    expect(release).toHaveBeenCalled();
  });
});

function pendingRegistrationCommand(action: 'signup' | 'resend' = 'signup') {
  return {
    action,
    pendingRegistrationId: PENDING_ID,
    emailCanonical: 'ada@example.com',
    recipient: 'ada@example.com',
    keyVersion: 1 as const,
    verificationDigest: Buffer.alloc(32, 1),
    createdAt: AUTH_NOW,
    verificationExpiresAt: new Date('2026-07-28T12:15:00.000Z'),
    outbox: {
      id: OUTBOX_ID,
      idempotencyKey: `verification:${PENDING_ID}:verify-v1`,
      sender: 'StudyTube <no-reply@example.com>',
      publicOrigin: 'https://studytube.example',
      templateVersion: 'verify-v1',
      locale: 'en',
      subject: 'Verify your StudyTube email',
      payloadHash: Buffer.alloc(32, 2),
    },
  };
}

function pendingRegistrationStateQuery(input: {
  activeRows: Array<{
    id: string;
    verifiedAt: Date | null;
    deliveryInProgress: boolean;
  }>;
  userExists?: boolean;
}) {
  return jest.fn((sql: string) => {
    if (sql.includes('pg_advisory_xact_lock')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (sql.includes('FOR UPDATE OF pending')) {
      return Promise.resolve({
        rows: input.activeRows,
        rowCount: input.activeRows.length,
      });
    }
    if (sql.includes('FROM users')) {
      return Promise.resolve({
        rows: [{ userExists: input.userExists ?? false }],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
}

function verificationCommand() {
  return {
    pendingRegistrationId: PENDING_ID,
    keyVersion: 1 as const,
    presentedVerificationDigest: Buffer.alloc(32, 3),
    enrollmentDigest: Buffer.alloc(32, 4),
    verifiedAt: AUTH_NOW,
    enrollmentExpiresAt: new Date('2026-07-28T12:10:00.000Z'),
  };
}

function pendingVerificationRow(
  verificationDigest: Buffer,
  attemptCount = 0,
  maxAttempts = 5,
) {
  return {
    keyVersion: 1,
    verificationDigest,
    attemptCount,
    maxAttempts,
    verificationExpiresAt: new Date('2026-07-28T12:05:00.000Z'),
    verifiedAt: null,
    enrollmentDigest: null,
    enrollmentExpiresAt: null,
    completedAt: null,
  };
}

function completionCommand() {
  return {
    enrollmentDigest: Buffer.alloc(32, 4),
    name: 'Ada',
    passwordHash: '$argon2id$reviewed-password-hash',
    passwordAlgorithm: 'argon2id' as const,
    passwordParameters: {
      memoryKiB: 65536 as const,
      timeCost: 3 as const,
      parallelism: 1 as const,
    },
    passwordVersion: 1 as const,
    identityAssurance: 'email_verified' as const,
    sessionId: SESSION_ID,
    sessionDigest: Buffer.alloc(32, 5),
    sessionCreatedAt: AUTH_NOW,
    sessionAbsoluteExpiresAt: new Date('2026-08-04T12:00:00.000Z'),
    sessionIdleExpiresAt: new Date('2026-08-04T12:00:00.000Z'),
    completedAt: AUTH_NOW,
  };
}

function completionPendingRow(enrollmentDigest: Buffer) {
  return {
    email: 'ada@example.com',
    emailCanonical: 'ada@example.com',
    verifiedAt: new Date('2026-07-28T11:59:00.000Z'),
    enrollmentDigest,
    enrollmentExpiresAt: new Date('2026-07-28T12:10:00.000Z'),
    completedAt: null,
  };
}

function authCredentialRow(
  overrides: Partial<ReturnType<typeof authCredentialRowBase>> = {},
) {
  return { ...authCredentialRowBase(), ...overrides };
}

function authCredentialRowBase() {
  return {
    id: 7,
    name: 'Ada',
    email: 'ada@example.com',
    emailCanonical: 'ada@example.com',
    passwordHash: createHashForTest('legacy password'),
    passwordAlgorithm: 'legacy_sha256' as const,
    passwordParameters: {
      digest: 'sha256',
      encoding: 'lower_hex',
    },
    passwordVersion: 1,
    identityAssurance: 'legacy_grandfathered' as const,
    createdAt: AUTH_NOW,
  };
}

function loginCommitCommand() {
  return {
    userId: 7,
    expectedPasswordHash: createHashForTest('legacy password'),
    expectedPasswordVersion: 1,
    passwordUpgrade: {
      passwordHash: '$argon2id$reviewed-password-hash',
      passwordAlgorithm: 'argon2id' as const,
      passwordParameters: {
        memoryKiB: 65_536 as const,
        timeCost: 3 as const,
        parallelism: 1 as const,
      },
      passwordVersion: 2,
    },
    sessionId: SESSION_ID,
    sessionDigest: Buffer.alloc(32, 5),
    sessionCreatedAt: AUTH_NOW,
    sessionAbsoluteExpiresAt: new Date('2026-08-04T12:00:00.000Z'),
    sessionIdleExpiresAt: new Date('2026-07-29T12:00:00.000Z'),
  };
}

function createHashForTest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function callsContainBuffer(calls: unknown[][], expected: Buffer) {
  return calls.some((call) =>
    call.some(
      (value) =>
        Array.isArray(value) &&
        value.some((entry) => Buffer.isBuffer(entry) && entry.equals(expected)),
    ),
  );
}
