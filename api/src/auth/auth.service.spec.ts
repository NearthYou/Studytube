import { createHash } from 'node:crypto';
import type { AuthRepository } from './auth.repository';
import { AuthService, canonicalizeAuthEmail } from './auth.service';
import { PasswordValidationError } from './password-hasher';
import type {
  OpaqueTokenFactory,
  VerificationTokenFactory,
} from './auth.service';
import { renderVerificationEmail } from './verification-email';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const PENDING_ID = '11111111-1111-4111-8111-111111111111';
const OUTBOX_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const VERIFICATION_SECRET = Buffer.alloc(32, 7);
const VERIFICATION_TOKEN = `v1.${PENDING_ID}.${VERIFICATION_SECRET.toString('base64url')}`;
const ENROLLMENT_TOKEN = Buffer.alloc(32, 8).toString('base64url');
const SESSION_TOKEN = Buffer.alloc(32, 9).toString('base64url');
const DUMMY_PASSWORD_HASH = '$argon2id$dummy-password-hash';

type AuthRepositoryMock = {
  [Key in keyof AuthRepository]: AuthRepository[Key] extends (
    ...args: infer Args
  ) => infer Result
    ? jest.MockedFunction<(this: void, ...args: Args) => Result>
    : never;
};

function createRepository(): AuthRepositoryMock {
  return {
    consumeRateLimit: jest.fn().mockResolvedValue({
      allowed: true,
      remaining: 4,
    }),
    findAuthUser: jest.fn().mockResolvedValue({ user: null }),
    createPendingRegistration: jest
      .fn()
      .mockResolvedValue({ status: 'accepted' }),
    consumeVerification: jest.fn().mockResolvedValue({ status: 'verified' }),
    findEnrollmentCandidate: jest.fn().mockResolvedValue({ eligible: true }),
    completeRegistration: jest.fn().mockResolvedValue({
      status: 'completed',
      user: {
        id: 7,
        name: 'Ada',
        email: 'ada@example.com',
        createdAt: NOW.toISOString(),
      },
    }),
    commitLogin: jest.fn().mockResolvedValue({
      status: 'committed',
      user: {
        id: 7,
        name: 'Ada',
        email: 'ada@example.com',
        createdAt: NOW.toISOString(),
      },
    }),
    findActiveSession: jest.fn().mockResolvedValue({ status: 'invalid' }),
    revokeActiveSession: jest.fn().mockResolvedValue({ status: 'revoked' }),
    findEnrollmentReadiness: jest.fn().mockResolvedValue({ status: 'ready' }),
  };
}

function createVerificationFactory(): jest.MockedFunction<VerificationTokenFactory> {
  return jest.fn((pepper: Buffer | string) => {
    void pepper;
    return {
      token: VERIFICATION_TOKEN,
      persistence: {
        pendingRegistrationId: PENDING_ID,
        keyVersion: 'v1',
        secretDigest: createHash('sha256').update(VERIFICATION_SECRET).digest(),
      },
    };
  });
}

function createOpaqueFactory(): jest.MockedFunction<OpaqueTokenFactory> {
  const tokens = [ENROLLMENT_TOKEN, SESSION_TOKEN];
  return jest.fn(() => {
    const cookieValue = tokens.shift();
    if (!cookieValue) {
      throw new Error('test token factory exhausted');
    }
    return {
      cookieValue,
      persistence: {
        digest: createHash('sha256').update(cookieValue).digest(),
      },
    };
  });
}

function fixedOpaqueFactory(token: string): OpaqueTokenFactory {
  return () => ({
    cookieValue: token,
    persistence: { digest: createHash('sha256').update(token).digest() },
  });
}

function sequenceOpaqueFactory(tokens: string[]): OpaqueTokenFactory {
  return () => {
    const cookieValue = tokens.shift();
    if (!cookieValue) {
      throw new Error('test token factory exhausted');
    }
    return {
      cookieValue,
      persistence: {
        digest: createHash('sha256').update(cookieValue).digest(),
      },
    };
  };
}

function authUser(
  overrides: Partial<
    NonNullable<Awaited<ReturnType<AuthRepository['findAuthUser']>>['user']>
  > = {},
) {
  return {
    id: 7,
    name: 'Ada',
    email: 'ada@example.com',
    emailCanonical: 'ada@example.com',
    createdAt: NOW.toISOString(),
    passwordHash: createHash('sha256')
      .update('correct horse battery staple')
      .digest('hex'),
    passwordAlgorithm: 'legacy_sha256' as const,
    passwordParameters: {
      digest: 'sha256',
      encoding: 'lower_hex',
    },
    passwordVersion: 1,
    identityAssurance: 'legacy_grandfathered' as const,
    ...overrides,
  };
}

function createPasswordHasher() {
  return {
    validate: jest.fn(),
    hash: jest.fn().mockResolvedValue('$argon2id$reviewed-password-hash'),
    verify: jest.fn().mockResolvedValue({
      valid: false,
      needsRehash: false,
      algorithm: 'argon2id' as const,
    }),
  };
}

function createService(
  overrides: Partial<ConstructorParameters<typeof AuthService>[0]> = {},
) {
  const repository = createRepository();
  const verificationTokenFactory = createVerificationFactory();
  const opaqueTokenFactory = createOpaqueFactory();
  const passwordHasher = createPasswordHasher();
  const sleep = jest.fn().mockResolvedValue(undefined);
  const uuidValues = [OUTBOX_ID, SESSION_ID];
  const uuid = jest.fn(() => {
    const value = uuidValues.shift();
    if (!value) {
      throw new Error('test UUID factory exhausted');
    }
    return value;
  });
  const service = new AuthService({
    repository,
    passwordHasher,
    dummyPasswordHash: DUMMY_PASSWORD_HASH,
    clock: () => NOW,
    sleep,
    uuid,
    verificationTokenFactory,
    opaqueTokenFactory,
    verificationPepper: Buffer.alloc(32, 1),
    rateLimitPepper: Buffer.alloc(32, 2),
    timing: { minimumDurationMs: 0 },
    delivery: {
      sender: 'StudyTube <no-reply@example.com>',
      publicOrigin: 'https://studytube.example',
      templateVersion: 'v2',
      locale: 'en',
      subject: 'Verify your StudyTube email',
    },
    rateLimit: { windowSeconds: 60, maxAttempts: 5 },
    ...overrides,
  });

  return {
    service,
    repository,
    verificationTokenFactory,
    opaqueTokenFactory,
    passwordHasher,
    sleep,
    uuid,
  };
}

describe('AuthService enrollment', () => {
  it('canonicalizes exactly the migration ASCII email contract', () => {
    expect(canonicalizeAuthEmail(' Ada.Example+tag@Example.COM ')).toBe(
      'ada.example+tag@example.com',
    );
    expect(() => canonicalizeAuthEmail('\tada@example.com\t')).toThrow(
      'Invalid email',
    );
    expect(() => canonicalizeAuthEmail('adá@example.com')).toThrow(
      'Invalid email',
    );
    expect(() => canonicalizeAuthEmail('ada@example')).toThrow('Invalid email');
  });

  it('returns one generic signup acceptance and persists no raw token or password', async () => {
    const { service, repository, passwordHasher, verificationTokenFactory } =
      createService();

    await expect(
      service.signup({ email: ' Ada@Example.COM ' }, '203.0.113.7'),
    ).resolves.toEqual({ status: 'accepted' });

    expect(repository.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(repository.createPendingRegistration).toHaveBeenCalledTimes(1);
    const command = repository.createPendingRegistration.mock.calls[0][0];
    expect(command.action).toBe('signup');
    expect(command.emailCanonical).toBe('ada@example.com');
    expect(command.recipient).toBe('ada@example.com');
    expect(command.keyVersion).toBe(1);
    expect(command.outbox.idempotencyKey).toBe(
      `email-verification/${PENDING_ID}`,
    );
    expect(command.outbox.payloadHash).toEqual(
      renderVerificationEmail({
        pendingRegistrationId: PENDING_ID,
        verificationToken: VERIFICATION_TOKEN,
        recipient: 'ada@example.com',
        sender: 'StudyTube <no-reply@example.com>',
        publicOrigin: 'https://studytube.example',
        templateVersion: 'v2',
        locale: 'en',
        subject: 'Verify your StudyTube email',
      }).payloadHash,
    );
    expect(JSON.stringify(command)).not.toContain(VERIFICATION_TOKEN);
    expect(JSON.stringify(command)).not.toContain('password');
    expect(passwordHasher.validate).not.toHaveBeenCalled();
    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(
      repository.consumeRateLimit.mock.invocationCallOrder[1],
    ).toBeLessThan(verificationTokenFactory.mock.invocationCallOrder[0]);
  });

  it('uses the same resend acceptance when no pending row is created', async () => {
    const { service, repository } = createService();
    repository.createPendingRegistration.mockResolvedValueOnce({
      status: 'accepted',
    });

    await expect(
      service.resend({ email: 'existing@example.com' }, '203.0.113.8'),
    ).resolves.toEqual({ status: 'accepted' });
    expect(repository.createPendingRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resend' }),
    );
  });

  it('returns durable retry metadata before token generation or expensive work', async () => {
    const { service, repository, verificationTokenFactory, passwordHasher } =
      createService();
    repository.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 37 });

    await expect(
      service.signup({ email: 'ada@example.com' }, '203.0.113.7'),
    ).resolves.toEqual({ status: 'rate_limited', retryAfterSeconds: 37 });

    expect(repository.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(verificationTokenFactory).not.toHaveBeenCalled();
    expect(repository.createPendingRegistration).not.toHaveBeenCalled();
    expect(passwordHasher.hash).not.toHaveBeenCalled();
  });

  it('uses the fake clock and sleeper to fill the configured timing bucket', async () => {
    const times = [
      new Date('2026-07-28T12:00:00.000Z'),
      new Date('2026-07-28T12:00:00.025Z'),
    ];
    const clock = jest.fn(() => times.shift() ?? NOW);
    const sleep = jest.fn().mockResolvedValue(undefined);
    const { service } = createService({
      clock,
      sleep,
      timing: { minimumDurationMs: 100 },
    });

    await service.signup({ email: 'ada@example.com' }, '203.0.113.7');

    expect(sleep).toHaveBeenCalledWith(75);
  });

  it('turns one valid verification into one digest-only enrollment grant', async () => {
    const { service, repository } = createService();

    await expect(
      service.consumeVerification(
        { verificationToken: VERIFICATION_TOKEN },
        '203.0.113.7',
      ),
    ).resolves.toEqual({
      status: 'verified',
      enrollmentToken: ENROLLMENT_TOKEN,
    });

    const command = repository.consumeVerification.mock.calls[0][0];
    expect(command.pendingRegistrationId).toBe(PENDING_ID);
    expect(command.keyVersion).toBe(1);
    expect(command.presentedVerificationDigest).toEqual(
      createHash('sha256').update(VERIFICATION_SECRET).digest(),
    );
    expect(command.enrollmentDigest).toEqual(
      createHash('sha256').update(ENROLLMENT_TOKEN).digest(),
    );
    expect(JSON.stringify(command)).not.toContain(VERIFICATION_TOKEN);
    expect(JSON.stringify(command)).not.toContain(ENROLLMENT_TOKEN);
  });

  it('fails malformed and non-live verification without returning a grant', async () => {
    const { service, repository } = createService();

    await expect(
      service.consumeVerification(
        { verificationToken: 'not-a-token' },
        '203.0.113.7',
      ),
    ).resolves.toEqual({ status: 'invalid' });
    expect(repository.consumeVerification).not.toHaveBeenCalled();

    repository.consumeVerification.mockResolvedValueOnce({ status: 'invalid' });
    await expect(
      service.consumeVerification(
        { verificationToken: VERIFICATION_TOKEN },
        '203.0.113.7',
      ),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('preflights proof before hashing and completes with digest-only session data', async () => {
    const { service, repository, passwordHasher } = createService({
      opaqueTokenFactory: fixedOpaqueFactory(SESSION_TOKEN),
    });

    await expect(
      service.completeRegistration(
        {
          enrollmentToken: ENROLLMENT_TOKEN,
          name: ' Ada ',
          password: 'correct horse battery staple',
        },
        '203.0.113.7',
      ),
    ).resolves.toMatchObject({
      status: 'completed',
      sessionToken: SESSION_TOKEN,
      user: { id: 7, email: 'ada@example.com' },
    });

    expect(passwordHasher.validate.mock.invocationCallOrder[0]).toBeLessThan(
      repository.findEnrollmentCandidate.mock.invocationCallOrder[0],
    );
    expect(
      repository.findEnrollmentCandidate.mock.invocationCallOrder[0],
    ).toBeLessThan(repository.consumeRateLimit.mock.invocationCallOrder[0]);
    expect(
      repository.consumeRateLimit.mock.invocationCallOrder[1],
    ).toBeLessThan(passwordHasher.hash.mock.invocationCallOrder[0]);
    expect(passwordHasher.hash.mock.invocationCallOrder[0]).toBeLessThan(
      repository.completeRegistration.mock.invocationCallOrder[0],
    );
    const command = repository.completeRegistration.mock.calls[0][0];
    expect(command.name).toBe('Ada');
    expect(command.passwordHash).toBe('$argon2id$reviewed-password-hash');
    expect(command.passwordAlgorithm).toBe('argon2id');
    expect(command.passwordVersion).toBe(1);
    expect(command.identityAssurance).toBe('email_verified');
    expect(command.sessionDigest).toEqual(
      createHash('sha256').update(SESSION_TOKEN).digest(),
    );
    expect(command.sessionAbsoluteExpiresAt).toEqual(
      new Date('2026-08-04T12:00:00.000Z'),
    );
    expect(command.sessionIdleExpiresAt).toEqual(
      new Date('2026-07-29T12:00:00.000Z'),
    );
    expect(JSON.stringify(command)).not.toContain(ENROLLMENT_TOKEN);
    expect(JSON.stringify(command)).not.toContain(SESSION_TOKEN);
    expect(JSON.stringify(command)).not.toContain(
      'correct horse battery staple',
    );
  });

  it('reports an invalid password as input failure without blaming the enrollment', async () => {
    const { service, repository, passwordHasher } = createService();
    passwordHasher.validate.mockImplementationOnce(() => {
      throw new PasswordValidationError(
        'Password must be 8 to 128 UTF-8 bytes',
      );
    });

    await expect(
      service.completeRegistration(
        {
          enrollmentToken: ENROLLMENT_TOKEN,
          name: 'Ada',
          password: '1234',
        },
        '203.0.113.7',
      ),
    ).rejects.toThrow(PasswordValidationError);

    expect(repository.findEnrollmentCandidate).not.toHaveBeenCalled();
    expect(repository.consumeRateLimit).not.toHaveBeenCalled();
    expect(passwordHasher.hash).not.toHaveBeenCalled();
  });

  it('closes attacker pre-registration by refusing to hash without a live proof', async () => {
    const { service, repository, passwordHasher } = createService();
    repository.findEnrollmentCandidate.mockResolvedValueOnce({
      eligible: false,
    });

    await expect(
      service.completeRegistration(
        {
          enrollmentToken: ENROLLMENT_TOKEN,
          name: 'Attacker',
          password: 'attacker password',
        },
        '203.0.113.9',
      ),
    ).resolves.toEqual({ status: 'invalid' });

    expect(repository.consumeRateLimit).not.toHaveBeenCalled();
    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(repository.completeRegistration).not.toHaveBeenCalled();
  });

  it('normalizes the second canonical-account completion to conflict without a session token', async () => {
    const { service, repository } = createService({
      opaqueTokenFactory: fixedOpaqueFactory(SESSION_TOKEN),
    });
    repository.completeRegistration.mockResolvedValueOnce({
      status: 'conflict',
    });

    await expect(
      service.completeRegistration(
        {
          enrollmentToken: ENROLLMENT_TOKEN,
          name: 'Ada',
          password: 'correct horse battery staple',
        },
        '203.0.113.7',
      ),
    ).resolves.toEqual({ status: 'conflict' });
  });
});

describe('AuthService core session', () => {
  it('runs dummy password verification and returns generic invalid for an absent user', async () => {
    const { service, repository, passwordHasher } = createService();

    await expect(
      service.login(
        { email: ' Missing@Example.COM ', password: 'missing password' },
        '203.0.113.10',
      ),
    ).resolves.toEqual({ status: 'invalid' });

    expect(repository.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(
      repository.consumeRateLimit.mock.calls.map(([call]) => call.action),
    ).toEqual(['login_email', 'login_ip']);
    expect(repository.findAuthUser).toHaveBeenCalledWith({
      emailCanonical: 'missing@example.com',
    });
    expect(passwordHasher.verify).toHaveBeenCalledWith(
      DUMMY_PASSWORD_HASH,
      'missing password',
    );
    expect(
      repository.consumeRateLimit.mock.invocationCallOrder[1],
    ).toBeLessThan(passwordHasher.verify.mock.invocationCallOrder[0]);
    expect(repository.commitLogin).not.toHaveBeenCalled();
  });

  it('upgrades a verified legacy password and commits one digest-only session', async () => {
    const { service, repository, passwordHasher } = createService({
      opaqueTokenFactory: fixedOpaqueFactory(SESSION_TOKEN),
      uuid: () => SESSION_ID,
    });
    repository.findAuthUser.mockResolvedValue({ user: authUser() });
    passwordHasher.verify.mockResolvedValueOnce({
      valid: true,
      needsRehash: true,
      algorithm: 'legacy_sha256',
    });

    await expect(
      service.login(
        {
          email: 'Ada@Example.COM',
          password: 'correct horse battery staple',
        },
        '203.0.113.10',
      ),
    ).resolves.toEqual({
      status: 'authenticated',
      sessionToken: SESSION_TOKEN,
      user: {
        id: 7,
        name: 'Ada',
        email: 'ada@example.com',
        createdAt: NOW.toISOString(),
      },
    });

    expect(passwordHasher.hash).toHaveBeenCalledWith(
      'correct horse battery staple',
    );
    const command = repository.commitLogin.mock.calls[0][0];
    expect(command).toMatchObject({
      userId: 7,
      expectedPasswordHash: authUser().passwordHash,
      expectedPasswordVersion: 1,
      passwordUpgrade: {
        passwordHash: '$argon2id$reviewed-password-hash',
        passwordAlgorithm: 'argon2id',
        passwordParameters: {
          memoryKiB: 65_536,
          timeCost: 3,
          parallelism: 1,
        },
        passwordVersion: 2,
      },
      sessionId: SESSION_ID,
      sessionCreatedAt: NOW,
      sessionAbsoluteExpiresAt: new Date('2026-08-04T12:00:00.000Z'),
      sessionIdleExpiresAt: new Date('2026-07-29T12:00:00.000Z'),
    });
    expect(command.sessionDigest).toEqual(
      createHash('sha256').update(SESSION_TOKEN).digest(),
    );
    expect(JSON.stringify(command)).not.toContain(SESSION_TOKEN);
    expect(JSON.stringify(command)).not.toContain(
      'correct horse battery staple',
    );
  });

  it('refetches and verifies once after a stale commit, using fresh session material', async () => {
    const firstToken = Buffer.alloc(32, 10).toString('base64url');
    const secondToken = Buffer.alloc(32, 11).toString('base64url');
    const ids = [
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    const { service, repository, passwordHasher } = createService({
      opaqueTokenFactory: sequenceOpaqueFactory([firstToken, secondToken]),
      uuid: () => ids.shift() as string,
    });
    repository.findAuthUser
      .mockResolvedValueOnce({ user: authUser() })
      .mockResolvedValueOnce({
        user: authUser({
          passwordHash: '$argon2id$concurrent-upgrade',
          passwordAlgorithm: 'argon2id',
          passwordVersion: 2,
        }),
      });
    passwordHasher.verify
      .mockResolvedValueOnce({
        valid: true,
        needsRehash: true,
        algorithm: 'legacy_sha256',
      })
      .mockResolvedValueOnce({
        valid: true,
        needsRehash: false,
        algorithm: 'argon2id',
      });
    repository.commitLogin
      .mockResolvedValueOnce({ status: 'stale' })
      .mockResolvedValueOnce({
        status: 'committed',
        user: {
          id: 7,
          name: 'Ada',
          email: 'ada@example.com',
          createdAt: NOW.toISOString(),
        },
      });

    await expect(
      service.login(
        {
          email: 'ada@example.com',
          password: 'correct horse battery staple',
        },
        '203.0.113.10',
      ),
    ).resolves.toMatchObject({
      status: 'authenticated',
      sessionToken: secondToken,
    });

    expect(repository.findAuthUser).toHaveBeenCalledTimes(2);
    expect(passwordHasher.verify).toHaveBeenCalledTimes(2);
    expect(repository.commitLogin).toHaveBeenCalledTimes(2);
    expect(repository.commitLogin.mock.calls[0][0].sessionDigest).not.toEqual(
      repository.commitLogin.mock.calls[1][0].sessionDigest,
    );
    expect(repository.commitLogin.mock.calls[1][0]).toMatchObject({
      expectedPasswordHash: '$argon2id$concurrent-upgrade',
      expectedPasswordVersion: 2,
      passwordUpgrade: undefined,
    });
  });

  it('rejects a concurrent password change after the one allowed refetch', async () => {
    const { service, repository, passwordHasher } = createService({
      opaqueTokenFactory: fixedOpaqueFactory(SESSION_TOKEN),
      uuid: () => SESSION_ID,
    });
    repository.findAuthUser
      .mockResolvedValueOnce({ user: authUser() })
      .mockResolvedValueOnce({
        user: authUser({
          passwordHash: '$argon2id$new-password',
          passwordAlgorithm: 'argon2id',
          passwordVersion: 2,
        }),
      });
    passwordHasher.verify
      .mockResolvedValueOnce({
        valid: true,
        needsRehash: false,
        algorithm: 'legacy_sha256',
      })
      .mockResolvedValueOnce({
        valid: false,
        needsRehash: false,
        algorithm: 'argon2id',
      });
    repository.commitLogin.mockResolvedValueOnce({ status: 'stale' });

    await expect(
      service.login(
        { email: 'ada@example.com', password: 'old valid password' },
        '203.0.113.10',
      ),
    ).resolves.toEqual({ status: 'invalid' });

    expect(repository.commitLogin).toHaveBeenCalledTimes(1);
    expect(passwordHasher.verify).toHaveBeenCalledTimes(2);
  });

  it('uses equivalent password work and one generic result for unknown and wrong-password login', async () => {
    const unknown = createService();
    const wrong = createService();
    wrong.repository.findAuthUser.mockResolvedValue({
      user: authUser({
        passwordHash: '$argon2id$stored-password',
        passwordAlgorithm: 'argon2id',
      }),
    });

    await expect(
      unknown.service.login(
        { email: 'unknown@example.com', password: 'wrong password' },
        '203.0.113.10',
      ),
    ).resolves.toEqual({ status: 'invalid' });
    await expect(
      wrong.service.login(
        { email: 'ada@example.com', password: 'wrong password' },
        '203.0.113.10',
      ),
    ).resolves.toEqual({ status: 'invalid' });

    expect(unknown.passwordHasher.verify).toHaveBeenCalledTimes(1);
    expect(wrong.passwordHasher.verify).toHaveBeenCalledTimes(1);
    expect(unknown.repository.commitLogin).not.toHaveBeenCalled();
    expect(wrong.repository.commitLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null, 'short'],
    [
      'disabled',
      authUser({
        passwordHash: 'disabled:demo-seed-login',
        passwordAlgorithm: 'disabled',
      }),
      'x'.repeat(129),
    ],
    ['legacy', authUser(), 'valid\u0000password'],
    [
      'argon2id',
      authUser({
        passwordHash: '$argon2id$stored-password',
        passwordAlgorithm: 'argon2id',
      }),
      'valid\ud800password',
    ],
  ])(
    'returns generic invalid for PasswordValidationError from a %s login after rate admission',
    async (_kind, user, password) => {
      const { service, repository, passwordHasher } = createService();
      repository.findAuthUser.mockResolvedValue({ user });
      passwordHasher.verify.mockRejectedValueOnce(
        new PasswordValidationError('attacker-controlled invalid password'),
      );

      await expect(
        service.login({ email: 'ada@example.com', password }, '203.0.113.10'),
      ).resolves.toEqual({ status: 'invalid' });

      expect(repository.consumeRateLimit).toHaveBeenCalledTimes(2);
      expect(
        repository.consumeRateLimit.mock.invocationCallOrder[1],
      ).toBeLessThan(passwordHasher.verify.mock.invocationCallOrder[0]);
      expect(repository.commitLogin).not.toHaveBeenCalled();
    },
  );

  it('propagates non-validation password verification failures', async () => {
    const { service, passwordHasher } = createService();
    const capacityFailure = new Error('argon2 queue saturated');
    passwordHasher.verify.mockRejectedValueOnce(capacityFailure);

    await expect(
      service.login(
        { email: 'unknown@example.com', password: 'valid shape password' },
        '203.0.113.10',
      ),
    ).rejects.toBe(capacityFailure);
  });

  it('runs reviewed dummy Argon2 work after a valid-shape wrong legacy password', async () => {
    const { service, repository, passwordHasher } = createService();
    const legacy = authUser();
    repository.findAuthUser.mockResolvedValue({ user: legacy });
    passwordHasher.verify
      .mockResolvedValueOnce({
        valid: false,
        needsRehash: true,
        algorithm: 'legacy_sha256',
      })
      .mockResolvedValueOnce({
        valid: false,
        needsRehash: false,
        algorithm: 'argon2id',
      });

    await expect(
      service.login(
        { email: 'ada@example.com', password: 'valid shape wrong password' },
        '203.0.113.10',
      ),
    ).resolves.toEqual({ status: 'invalid' });

    expect(passwordHasher.verify.mock.calls).toEqual([
      [legacy.passwordHash, 'valid shape wrong password'],
      [DUMMY_PASSWORD_HASH, 'valid shape wrong password'],
    ]);
    expect(repository.commitLogin).not.toHaveBeenCalled();
  });

  it('runs the dummy path for a disabled credential', async () => {
    const { service, repository, passwordHasher } = createService();
    repository.findAuthUser.mockResolvedValue({
      user: authUser({
        passwordHash: 'disabled:demo-seed-login',
        passwordAlgorithm: 'disabled',
      }),
    });

    await expect(
      service.login(
        { email: 'ada@example.com', password: 'any password' },
        '203.0.113.10',
      ),
    ).resolves.toEqual({ status: 'invalid' });

    expect(passwordHasher.verify).toHaveBeenCalledWith(
      DUMMY_PASSWORD_HASH,
      'any password',
    );
  });

  it('uses digest-only lifecycle and readiness repository commands', async () => {
    const { service, repository } = createService();
    repository.findActiveSession.mockResolvedValueOnce({
      status: 'active',
      principal: { sessionId: SESSION_ID, userId: 7 },
      user: {
        id: 7,
        name: 'Ada',
        email: 'ada@example.com',
        createdAt: NOW.toISOString(),
      },
    });
    repository.revokeActiveSession
      .mockResolvedValueOnce({ status: 'revoked' })
      .mockResolvedValueOnce({ status: 'invalid' });

    const authenticated = await service.authenticateSession(SESSION_TOKEN);
    expect(authenticated).toMatchObject({
      status: 'authenticated',
      principal: { sessionId: SESSION_ID, userId: 7 },
      user: { id: 7, email: 'ada@example.com' },
    });
    expect(Object.isFrozen(authenticated)).toBe(true);
    if (authenticated.status === 'authenticated') {
      expect(Object.isFrozen(authenticated.principal)).toBe(true);
      expect(Object.isFrozen(authenticated.user)).toBe(true);
    }
    await expect(service.logout(SESSION_TOKEN)).resolves.toEqual({
      status: 'revoked',
    });
    await expect(service.logout(SESSION_TOKEN)).resolves.toEqual({
      status: 'invalid',
    });
    await expect(
      service.getRegistrationReadiness(ENROLLMENT_TOKEN),
    ).resolves.toEqual({ status: 'ready' });

    const expectedSessionDigest = createHash('sha256')
      .update(SESSION_TOKEN)
      .digest();
    expect(repository.findActiveSession).toHaveBeenCalledWith({
      sessionDigest: expectedSessionDigest,
    });
    expect(repository.revokeActiveSession).toHaveBeenCalledWith({
      sessionDigest: expectedSessionDigest,
      reason: 'logout',
    });
    expect(repository.findEnrollmentReadiness).toHaveBeenCalledWith({
      enrollmentDigest: createHash('sha256').update(ENROLLMENT_TOKEN).digest(),
    });
    expect(
      JSON.stringify([
        repository.findActiveSession.mock.calls,
        repository.revokeActiveSession.mock.calls,
      ]),
    ).not.toContain(SESSION_TOKEN);
  });
});
