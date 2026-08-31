import { PostgresGoogleAuthRepository } from './postgres-google-auth.repository';
import type {
  CommitGoogleLoginCommand,
  CreateGoogleAuthAttemptCommand,
} from './google-auth.repository';

describe('PostgresGoogleAuthRepository', () => {
  it('persists only digests and encrypted attempt material', async () => {
    const query = jest.fn(() => Promise.resolve({ rows: [], rowCount: 1 }));
    const repository = new PostgresGoogleAuthRepository({ query } as never);
    const command: CreateGoogleAuthAttemptCommand = {
      id: '11111111-1111-4111-8111-111111111111',
      purpose: 'login',
      stateDigest: Buffer.alloc(32, 0x11),
      nonceDigest: Buffer.alloc(32, 0x22),
      encryptedCodeVerifier: Buffer.from('encrypted-verifier'),
      returnPath: '/courses',
      createdAt: new Date('2026-08-31T12:00:00.000Z'),
      expiresAt: new Date('2026-08-31T12:10:00.000Z'),
    };

    await repository.createGoogleAuthAttempt(command);

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('INSERT INTO google_auth_attempts');
    expect(values).toEqual([
      command.id,
      command.purpose,
      command.stateDigest,
      command.nonceDigest,
      command.encryptedCodeVerifier,
      null,
      null,
      command.returnPath,
      command.createdAt,
      command.expiresAt,
    ]);
  });

  it('atomically consumes one unexpired attempt', async () => {
    const consumedAt = new Date('2026-08-31T12:05:00.000Z');
    const query = jest.fn(() =>
      Promise.resolve({
        rows: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            purpose: 'login',
            nonceDigest: Buffer.alloc(32, 0x22),
            encryptedCodeVerifier: Buffer.from('encrypted-verifier'),
            userId: null,
            sessionId: null,
            returnPath: '/courses',
          },
        ],
        rowCount: 1,
      }),
    );
    const repository = new PostgresGoogleAuthRepository({ query } as never);

    await expect(
      repository.consumeGoogleAuthAttempt(Buffer.alloc(32, 0x11), consumedAt),
    ).resolves.toEqual({
      status: 'consumed',
      attempt: {
        id: '11111111-1111-4111-8111-111111111111',
        purpose: 'login',
        nonceDigest: Buffer.alloc(32, 0x22),
        encryptedCodeVerifier: Buffer.from('encrypted-verifier'),
        returnPath: '/courses',
      },
    });
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('consumed_at IS NULL');
    expect(sql).toContain('expires_at > $2');
    expect(values).toEqual([Buffer.alloc(32, 0x11), consumedAt]);
  });

  it('creates a passwordless Google user and session in one transaction', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 71,
            name: 'Learner',
            email: 'learner@example.com',
            preferences: {},
            createdAt: new Date('2026-08-31T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const release = jest.fn();
    const repository = new PostgresGoogleAuthRepository({
      connect: () => Promise.resolve({ query, release }),
    } as never);

    await expect(repository.commitGoogleLogin(loginCommand())).resolves.toEqual(
      {
        status: 'committed',
        newUser: true,
        user: {
          id: 71,
          name: 'Learner',
          email: 'learner@example.com',
          preferences: { interests: [], pace: '', goal: '' },
          createdAt: '2026-08-31T12:00:00.000Z',
        },
      },
    );
    const statements = query.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain('INSERT INTO users');
    expect(statements[1]).toContain('password_hash');
    expect(statements[1]).toContain('NULL, NULL, NULL, NULL');
    expect(statements[2]).toContain('INSERT INTO sessions');
    expect(statements[3]).toBe('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

function loginCommand(): CommitGoogleLoginCommand {
  return {
    googleSubject: 'google-subject-1',
    email: 'learner@example.com',
    emailCanonical: 'learner@example.com',
    name: 'Learner',
    profileImageUrl: 'https://example.com/avatar.png',
    authenticatedAt: new Date('2026-08-31T12:00:00.000Z'),
    sessionId: '22222222-2222-4222-8222-222222222222',
    sessionDigest: Buffer.alloc(32, 0x66),
    sessionCreatedAt: new Date('2026-08-31T12:00:00.000Z'),
    sessionAbsoluteExpiresAt: new Date('2026-09-07T12:00:00.000Z'),
    sessionIdleExpiresAt: new Date('2026-09-01T12:00:00.000Z'),
  };
}
