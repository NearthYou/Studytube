import { createHash } from 'node:crypto';
import type { AuthRepository } from './auth.repository';
import { AuthService, canonicalizeAuthEmail } from './auth.service';
import type {
  OpaqueTokenFactory,
  VerificationTokenFactory,
} from './auth.service';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const PENDING_ID = '11111111-1111-4111-8111-111111111111';
const OUTBOX_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const VERIFICATION_SECRET = Buffer.alloc(32, 7);
const VERIFICATION_TOKEN = `v1.${PENDING_ID}.${VERIFICATION_SECRET.toString('base64url')}`;
const ENROLLMENT_TOKEN = Buffer.alloc(32, 8).toString('base64url');
const SESSION_TOKEN = Buffer.alloc(32, 9).toString('base64url');

function createRepository(): jest.Mocked<AuthRepository> {
  return {
    consumeRateLimit: jest.fn().mockResolvedValue({
      allowed: true,
      remaining: 4,
    }),
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
  };
}

function createVerificationFactory(): jest.MockedFunction<VerificationTokenFactory> {
  return jest.fn((_pepper: Buffer | string) => ({
    token: VERIFICATION_TOKEN,
    persistence: {
      pendingRegistrationId: PENDING_ID,
      keyVersion: 'v1',
      secretDigest: createHash('sha256').update(VERIFICATION_SECRET).digest(),
    },
  }));
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

function createPasswordHasher() {
  return {
    validate: jest.fn(),
    hash: jest.fn().mockResolvedValue('$argon2id$reviewed-password-hash'),
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
      templateVersion: 'verify-v1',
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
    expect(command.emailCanonical).toBe('ada@example.com');
    expect(command.recipient).toBe('ada@example.com');
    expect(command.keyVersion).toBe(1);
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
    expect(JSON.stringify(command)).not.toContain(ENROLLMENT_TOKEN);
    expect(JSON.stringify(command)).not.toContain(SESSION_TOKEN);
    expect(JSON.stringify(command)).not.toContain(
      'correct horse battery staple',
    );
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
