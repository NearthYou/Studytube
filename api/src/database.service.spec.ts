import { DatabaseService } from './database.service';

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
