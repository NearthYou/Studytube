import { DatabaseService } from './database.service';

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

describe('DatabaseService fail-fast persistence', () => {
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

    await expect(service.findUserByEmail('ada@example.com')).rejects.toBe(
      queryError,
    );
    expect(query).toHaveBeenCalledTimes(2);

    await service.onModuleDestroy();
  });

  it('locks the authenticated user and inserts a session for the same password hash', async () => {
    const service = new DatabaseService(configService());
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          token: 'session-token',
          id: 7,
          name: 'Ada',
          email: 'ada@example.com',
          passwordHash: 'authenticated-hash',
          preferences: { interests: [], pace: '', goal: '' },
          createdAt: new Date('2026-07-28T00:00:00.000Z'),
        },
      ],
      rowCount: 1,
    });
    replacePool(service, query);

    await expect(
      service.createSessionIfPasswordHashMatches({
        userId: 7,
        token: 'session-token',
        expectedPasswordHash: 'authenticated-hash',
      }),
    ).resolves.toMatchObject({
      token: 'session-token',
      user: { id: 7, email: 'ada@example.com' },
    });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('AS MATERIALIZED');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('INSERT INTO sessions');
    expect(sql).toContain('SELECT $3, id');
    expect(values).toEqual([7, 'authenticated-hash', 'session-token']);

    await service.onModuleDestroy();
  });

  it('returns no session when the authenticated password hash changed', async () => {
    const service = new DatabaseService(configService());
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    replacePool(service, query);

    await expect(
      service.createSessionIfPasswordHashMatches({
        userId: 7,
        token: 'stale-session-token',
        expectedPasswordHash: 'stale-password-hash',
      }),
    ).resolves.toBeNull();

    await service.onModuleDestroy();
  });

  it('acquires the users write lock before row and session locks in the password update transaction', async () => {
    const service = new DatabaseService(configService());
    const userRow = {
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      passwordHash: 'new-password-hash',
      preferences: { interests: [], pace: '', goal: '' },
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [userRow], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ token: 'current-session-token' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { connect, release } = replacePoolConnection(service, query);

    await expect(
      service.updateUserIfPasswordHashMatchesAndReplaceSessions({
        userId: 7,
        expectedPasswordHash: 'old-password-hash',
        passwordHash: 'new-password-hash',
        replacementSessionToken: 'current-session-token',
      }),
    ).resolves.toMatchObject({
      token: 'current-session-token',
      user: { id: 7, email: 'ada@example.com' },
    });

    const calls = query.mock.calls as Array<[string, unknown[]?]>;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(6);
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls[1][0]).toContain('password_change_user_lock');
    expect(calls[1][0]).toContain('UPDATE users');
    expect(calls[1][0]).toContain('password_hash = $4');
    expect(calls[1][1]).toEqual([
      7,
      null,
      null,
      'new-password-hash',
      'old-password-hash',
    ]);
    expect(calls[2][0]).toContain('FROM sessions');
    expect(calls[2][0]).toContain('FOR UPDATE');
    expect(calls[2][1]).toEqual([7, 'current-session-token']);
    expect(calls[3]).toEqual([
      expect.stringContaining('DELETE FROM sessions'),
      [7],
    ]);
    expect(calls[4]).toEqual([
      expect.stringContaining('INSERT INTO sessions'),
      ['current-session-token', 7],
    ]);
    expect(calls[5][0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
  });

  it('rolls back a password update when the expected hash no longer matches', async () => {
    const service = new DatabaseService(configService());
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);

    await expect(
      service.updateUserIfPasswordHashMatchesAndReplaceSessions({
        userId: 7,
        expectedPasswordHash: 'stale-password-hash',
        passwordHash: 'new-password-hash',
        replacementSessionToken: 'current-session-token',
      }),
    ).resolves.toBeNull();

    const statements = (query.mock.calls as Array<[string]>).map(
      ([sql]) => sql,
    );
    expect(statements).toEqual([
      'BEGIN',
      expect.stringContaining('UPDATE users'),
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
  });

  it('rolls back the conditional user update when the current session is missing', async () => {
    const service = new DatabaseService(configService());
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            name: 'Ada',
            email: 'ada@example.com',
            passwordHash: 'new-password-hash',
            preferences: { interests: [], pace: '', goal: '' },
            createdAt: new Date('2026-07-28T00:00:00.000Z'),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(service, query);

    await expect(
      service.updateUserIfPasswordHashMatchesAndReplaceSessions({
        userId: 7,
        expectedPasswordHash: 'old-password-hash',
        passwordHash: 'new-password-hash',
        replacementSessionToken: 'missing-session-token',
      }),
    ).resolves.toBeNull();

    const statements = (query.mock.calls as Array<[string]>).map(
      ([sql]) => sql,
    );
    expect(statements).toEqual([
      'BEGIN',
      expect.stringContaining('UPDATE users'),
      expect.stringContaining('FROM sessions'),
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledTimes(1);

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
      .mockResolvedValueOnce({
        rows: [{ userExists: false, pendingExists: false }],
        rowCount: 1,
      })
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
      expect.stringContaining('FROM users'),
      expect.stringContaining('INSERT INTO pending_registrations'),
      expect.stringContaining('INSERT INTO verification_email_outbox'),
      'COMMIT',
    ]);
    expect(calls[1][0]).toContain('pending_registrations');
    expect(calls[2][1]).toEqual([
      PENDING_ID,
      'ada@example.com',
      'ada@example.com',
      1,
      command.verificationDigest,
      command.createdAt,
      command.verificationExpiresAt,
    ]);
    expect(calls[2][0]).toContain('created_at');
    expect(calls[3][1]).toEqual([
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

  it('normalizes an existing account and a 23505 insert race to accepted', async () => {
    const existingService = new DatabaseService(configService());
    const existingQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{ userExists: true, pendingExists: false }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    replacePoolConnection(existingService, existingQuery);

    await expect(
      existingService.createPendingRegistration(pendingRegistrationCommand()),
    ).resolves.toEqual({ status: 'accepted' });
    expect(existingQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FROM users'),
      'COMMIT',
    ]);

    const racedService = new DatabaseService(configService());
    const racedQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{ userExists: false, pendingExists: false }],
        rowCount: 1,
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('secret detail'), { code: '23505' }),
      )
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const { release } = replacePoolConnection(racedService, racedQuery);

    await expect(
      racedService.createPendingRegistration(pendingRegistrationCommand()),
    ).resolves.toEqual({ status: 'accepted' });
    expect(racedQuery.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
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
      expect(query.mock.calls.map(([sql]) => sql)).toEqual([
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

  it('rolls back a canonical user race and sanitizes other database failures', async () => {
    const command = completionCommand();
    const racedService = new DatabaseService(configService());
    const racedQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [completionPendingRow(command.enrollmentDigest)],
        rowCount: 1,
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('email=secret@example.com'), { code: '23505' }),
      )
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    replacePoolConnection(racedService, racedQuery);

    await expect(racedService.completeRegistration(command)).resolves.toEqual({
      status: 'conflict',
    });
    expect(racedQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('INSERT INTO users'),
      'ROLLBACK',
    ]);

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

function pendingRegistrationCommand() {
  return {
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
