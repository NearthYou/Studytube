import { createHash, randomUUID } from 'node:crypto';
import {
  ENROLLMENT_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_IDLE_MAX_AGE_MS,
} from './auth.constants';
import type { AuthRepository } from './auth.repository';
import {
  createVerificationToken,
  digestOpaqueToken,
  issueOpaqueToken,
  parseVerificationToken,
  rateLimitSubjectDigest,
  type OpaqueTokenIssue,
  type VerificationTokenIssue,
} from './auth-token';
import type { PasswordHasher, PasswordVerification } from './password-hasher';
import type {
  AuthPrincipal,
  AuthPublicUser,
  AuthUserCredential,
  CompleteRegistrationResult,
  PasswordUpgrade,
  RateLimitResult,
} from './auth.types';

export type VerificationTokenFactory = (
  pepper: Buffer | string,
) => VerificationTokenIssue;
export type OpaqueTokenFactory = () => OpaqueTokenIssue;

type AuthServiceRepository = Pick<
  AuthRepository,
  | 'consumeRateLimit'
  | 'createPendingRegistration'
  | 'consumeVerification'
  | 'findEnrollmentCandidate'
  | 'completeRegistration'
  | 'findAuthUser'
  | 'commitLogin'
  | 'findActiveSession'
  | 'revokeActiveSession'
  | 'findEnrollmentReadiness'
>;

type AuthServiceOptions = {
  repository: AuthServiceRepository;
  passwordHasher: Pick<PasswordHasher, 'validate' | 'hash' | 'verify'>;
  dummyPasswordHash: string;
  clock: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  uuid?: () => string;
  verificationTokenFactory?: VerificationTokenFactory;
  opaqueTokenFactory?: OpaqueTokenFactory;
  verificationPepper: Buffer | string;
  rateLimitPepper: Buffer | string;
  timing: { minimumDurationMs: number };
  delivery: {
    sender: string;
    publicOrigin: string;
    templateVersion: string;
    locale: string;
    subject: string;
  };
  rateLimit: { windowSeconds: number; maxAttempts: number };
};

export type AuthAcceptance =
  | { status: 'accepted' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type VerificationConsumption =
  | { status: 'verified'; enrollmentToken: string }
  | { status: 'invalid' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type RegistrationCompletion =
  | {
      status: 'completed';
      sessionToken: string;
      user: Extract<
        CompleteRegistrationResult,
        { status: 'completed' }
      >['user'];
    }
  | { status: 'invalid' }
  | { status: 'conflict' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type LoginResult =
  | { status: 'authenticated'; sessionToken: string; user: AuthPublicUser }
  | { status: 'invalid' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type SessionAuthentication =
  | {
      status: 'authenticated';
      principal: Readonly<AuthPrincipal>;
      user: Readonly<AuthPublicUser>;
    }
  | { status: 'invalid' };

export type LogoutResult = { status: 'revoked' } | { status: 'invalid' };

export type RegistrationReadiness = { status: 'ready' } | { status: 'invalid' };

const ASCII_PRINTABLE_PATTERN = /^[\x20-\x7e]+$/u;
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+\/=?^_{|}~-]+(\.[A-Za-z0-9!#$%&'*+\/=?^_{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;
const VERIFICATION_TTL_MS = 15 * 60 * 1000;

export class AuthService {
  private readonly repository: AuthServiceRepository;
  private readonly passwordHasher: Pick<
    PasswordHasher,
    'validate' | 'hash' | 'verify'
  >;
  private readonly clock: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly uuid: () => string;
  private readonly verificationTokenFactory: VerificationTokenFactory;
  private readonly opaqueTokenFactory: OpaqueTokenFactory;

  constructor(private readonly options: AuthServiceOptions) {
    this.repository = options.repository;
    this.passwordHasher = options.passwordHasher;
    this.clock = options.clock;
    this.sleep = options.sleep;
    this.uuid = options.uuid ?? randomUUID;
    this.verificationTokenFactory =
      options.verificationTokenFactory ?? createVerificationToken;
    this.opaqueTokenFactory = options.opaqueTokenFactory ?? issueOpaqueToken;
  }

  signup(
    input: { email: string },
    resolvedIpAddress: string,
  ): Promise<AuthAcceptance> {
    return this.acceptPendingRegistration(
      'signup',
      input.email,
      resolvedIpAddress,
    );
  }

  resend(
    input: { email: string },
    resolvedIpAddress: string,
  ): Promise<AuthAcceptance> {
    return this.acceptPendingRegistration(
      'resend',
      input.email,
      resolvedIpAddress,
    );
  }

  async consumeVerification(
    input: { verificationToken: string },
    resolvedIpAddress: string,
  ): Promise<VerificationConsumption> {
    const parsed = parseVerificationToken(input.verificationToken);
    if (!parsed) {
      return { status: 'invalid' };
    }

    const rateLimited = await this.consumeSubjectRates(
      'verify',
      parsed.pendingRegistrationId,
      resolvedIpAddress,
    );
    if (rateLimited) {
      return rateLimited;
    }

    const enrollment = this.opaqueTokenFactory();
    const verifiedAt = this.clock();
    const result = await this.repository.consumeVerification({
      pendingRegistrationId: parsed.pendingRegistrationId,
      keyVersion: toDatabaseKeyVersion(parsed.keyVersion),
      presentedVerificationDigest: createHash('sha256')
        .update(parsed.secret)
        .digest(),
      enrollmentDigest: enrollment.persistence.digest,
      verifiedAt,
      enrollmentExpiresAt: new Date(
        verifiedAt.getTime() + ENROLLMENT_COOKIE_MAX_AGE_MS,
      ),
    });

    return result.status === 'verified'
      ? { status: 'verified', enrollmentToken: enrollment.cookieValue }
      : { status: 'invalid' };
  }

  async completeRegistration(
    input: { enrollmentToken: string; name: string; password: string },
    resolvedIpAddress: string,
  ): Promise<RegistrationCompletion> {
    let name: string;
    try {
      name = normalizeName(input.name);
      this.passwordHasher.validate(input.password);
    } catch {
      return { status: 'invalid' };
    }

    const enrollmentDigest = digestOpaqueToken(input.enrollmentToken);
    const candidate = await this.repository.findEnrollmentCandidate({
      enrollmentDigest,
      at: this.clock(),
    });
    if (!candidate.eligible) {
      return { status: 'invalid' };
    }

    const rateLimited = await this.consumeSubjectRates(
      'complete',
      enrollmentDigest.toString('base64url'),
      resolvedIpAddress,
    );
    if (rateLimited) {
      return rateLimited;
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const session = this.opaqueTokenFactory();
    const completedAt = this.clock();
    const result = await this.repository.completeRegistration({
      enrollmentDigest,
      name,
      passwordHash,
      passwordAlgorithm: 'argon2id',
      passwordParameters: {
        memoryKiB: 65_536,
        timeCost: 3,
        parallelism: 1,
      },
      passwordVersion: 1,
      identityAssurance: 'email_verified',
      sessionId: this.uuid(),
      sessionDigest: session.persistence.digest,
      sessionCreatedAt: completedAt,
      sessionAbsoluteExpiresAt: new Date(
        completedAt.getTime() + SESSION_COOKIE_MAX_AGE_MS,
      ),
      sessionIdleExpiresAt: new Date(
        completedAt.getTime() + SESSION_IDLE_MAX_AGE_MS,
      ),
      completedAt,
    });

    if (result.status !== 'completed') {
      return result;
    }
    return {
      status: 'completed',
      sessionToken: session.cookieValue,
      user: result.user,
    };
  }

  async login(
    input: { email: string; password: string },
    resolvedIpAddress: string,
  ): Promise<LoginResult> {
    let emailCanonical: string;
    try {
      emailCanonical = canonicalizeAuthEmail(input.email);
    } catch {
      return { status: 'invalid' };
    }

    const rateLimited = await this.consumeLoginRates(
      emailCanonical,
      resolvedIpAddress,
    );
    if (rateLimited) {
      return rateLimited;
    }

    let user = (await this.repository.findAuthUser({ emailCanonical })).user;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const verification = await this.verifyLoginPassword(user, input.password);
      if (!user || !verification.valid || !isLoginCredential(user)) {
        return { status: 'invalid' };
      }

      const passwordUpgrade = verification.needsRehash
        ? await this.createPasswordUpgrade(user, input.password)
        : undefined;
      const session = this.opaqueTokenFactory();
      const sessionCreatedAt = this.clock();
      const commit = await this.repository.commitLogin({
        userId: user.id,
        expectedPasswordHash: user.passwordHash,
        expectedPasswordVersion: user.passwordVersion,
        passwordUpgrade,
        sessionId: this.uuid(),
        sessionDigest: session.persistence.digest,
        sessionCreatedAt,
        sessionAbsoluteExpiresAt: new Date(
          sessionCreatedAt.getTime() + SESSION_COOKIE_MAX_AGE_MS,
        ),
        sessionIdleExpiresAt: new Date(
          sessionCreatedAt.getTime() + SESSION_IDLE_MAX_AGE_MS,
        ),
      });
      if (commit.status === 'committed') {
        return {
          status: 'authenticated',
          sessionToken: session.cookieValue,
          user: commit.user,
        };
      }
      if (commit.status === 'invalid' || attempt === 1) {
        return { status: 'invalid' };
      }
      user = (await this.repository.findAuthUser({ emailCanonical })).user;
    }

    return { status: 'invalid' };
  }

  async authenticateSession(
    sessionToken: string,
  ): Promise<SessionAuthentication> {
    const result = await this.repository.findActiveSession({
      sessionDigest: digestOpaqueToken(sessionToken),
    });
    if (result.status === 'invalid') {
      return result;
    }
    return Object.freeze({
      status: 'authenticated',
      principal: Object.freeze({ ...result.principal }),
      user: Object.freeze({ ...result.user }),
    });
  }

  async logout(sessionToken: string): Promise<LogoutResult> {
    return this.repository.revokeActiveSession({
      sessionDigest: digestOpaqueToken(sessionToken),
      reason: 'logout',
    });
  }

  async getRegistrationReadiness(
    enrollmentToken: string,
  ): Promise<RegistrationReadiness> {
    return this.repository.findEnrollmentReadiness({
      enrollmentDigest: digestOpaqueToken(enrollmentToken),
    });
  }

  private async acceptPendingRegistration(
    action: 'signup' | 'resend',
    email: string,
    resolvedIpAddress: string,
  ): Promise<AuthAcceptance> {
    const startedAt = this.clock();
    try {
      const emailCanonical = canonicalizeAuthEmail(email);
      const rateLimited = await this.consumeSubjectRates(
        action,
        emailCanonical,
        resolvedIpAddress,
      );
      if (rateLimited) {
        return rateLimited;
      }

      const verification = this.verificationTokenFactory(
        this.options.verificationPepper,
      );
      const createdAt = startedAt;
      const outboxId = this.uuid();
      const payloadHash = renderVerificationPayloadHash({
        pendingRegistrationId: verification.persistence.pendingRegistrationId,
        recipient: emailCanonical,
        ...this.options.delivery,
      });
      await this.repository.createPendingRegistration({
        pendingRegistrationId: verification.persistence.pendingRegistrationId,
        emailCanonical,
        recipient: emailCanonical,
        keyVersion: toDatabaseKeyVersion(verification.persistence.keyVersion),
        verificationDigest: verification.persistence.secretDigest,
        createdAt,
        verificationExpiresAt: new Date(
          createdAt.getTime() + VERIFICATION_TTL_MS,
        ),
        outbox: {
          id: outboxId,
          idempotencyKey: `verification:${verification.persistence.pendingRegistrationId}:${this.options.delivery.templateVersion}`,
          ...this.options.delivery,
          payloadHash,
        },
      });
      return { status: 'accepted' };
    } finally {
      const elapsed = Math.max(0, this.clock().getTime() - startedAt.getTime());
      const delay = this.options.timing.minimumDurationMs - elapsed;
      if (delay > 0) {
        await this.sleep(delay);
      }
    }
  }

  private async consumeSubjectRates(
    action: string,
    identity: string,
    resolvedIpAddress: string,
  ): Promise<
    { status: 'rate_limited'; retryAfterSeconds: number } | undefined
  > {
    const results = await Promise.all([
      this.consumeRate(`${action}_identity`, identity),
      this.consumeRate(`${action}_ip`, resolvedIpAddress),
    ]);
    const denied = results.filter(
      (result): result is Extract<RateLimitResult, { allowed: false }> =>
        !result.allowed,
    );
    if (denied.length === 0) {
      return undefined;
    }
    return {
      status: 'rate_limited',
      retryAfterSeconds: Math.max(
        ...denied.map((result) => result.retryAfterSeconds),
      ),
    };
  }

  private async consumeLoginRates(
    emailCanonical: string,
    resolvedIpAddress: string,
  ): Promise<
    { status: 'rate_limited'; retryAfterSeconds: number } | undefined
  > {
    const results = await Promise.all([
      this.consumeRate('login_email', emailCanonical),
      this.consumeRate('login_ip', resolvedIpAddress),
    ]);
    const denied = results.filter(
      (result): result is Extract<RateLimitResult, { allowed: false }> =>
        !result.allowed,
    );
    return denied.length === 0
      ? undefined
      : {
          status: 'rate_limited',
          retryAfterSeconds: Math.max(
            ...denied.map((result) => result.retryAfterSeconds),
          ),
        };
  }

  private verifyLoginPassword(
    user: AuthUserCredential | null,
    password: string,
  ): Promise<PasswordVerification> {
    return this.passwordHasher.verify(
      user && isLoginCredential(user)
        ? user.passwordHash
        : this.options.dummyPasswordHash,
      password,
    );
  }

  private async createPasswordUpgrade(
    user: AuthUserCredential,
    password: string,
  ): Promise<PasswordUpgrade> {
    return {
      passwordHash: await this.passwordHasher.hash(password),
      passwordAlgorithm: 'argon2id',
      passwordParameters: {
        memoryKiB: 65_536,
        timeCost: 3,
        parallelism: 1,
      },
      passwordVersion: user.passwordVersion + 1,
    };
  }

  private consumeRate(action: string, subject: string) {
    return this.repository.consumeRateLimit({
      action,
      subjectDigest: rateLimitSubjectDigest(
        action,
        subject,
        this.options.rateLimitPepper,
      ),
      windowSeconds: this.options.rateLimit.windowSeconds,
      maxAttempts: this.options.rateLimit.maxAttempts,
    });
  }
}

export function canonicalizeAuthEmail(email: string): string {
  if (!ASCII_PRINTABLE_PATTERN.test(email)) {
    throw new RangeError('Invalid email');
  }
  const trimmed = email.replace(/^ +| +$/gu, '');
  if (
    trimmed.length === 0 ||
    trimmed.length > 254 ||
    !EMAIL_PATTERN.test(trimmed)
  ) {
    throw new RangeError('Invalid email');
  }
  return trimmed.toLowerCase();
}

function toDatabaseKeyVersion(keyVersion: 'v1'): 1 {
  if (keyVersion !== 'v1') {
    throw new RangeError('Unsupported verification key version');
  }
  return 1;
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 100 ||
    /\p{Cc}/u.test(normalized) ||
    /[\uD800-\uDFFF]/u.test(normalized)
  ) {
    throw new RangeError('Invalid name');
  }
  return normalized;
}

function isLoginCredential(user: AuthUserCredential): boolean {
  return (
    (user.passwordAlgorithm === 'argon2id' ||
      user.passwordAlgorithm === 'legacy_sha256') &&
    (user.identityAssurance === 'email_verified' ||
      user.identityAssurance === 'legacy_grandfathered')
  );
}

function renderVerificationPayloadHash(input: {
  pendingRegistrationId: string;
  recipient: string;
  sender: string;
  publicOrigin: string;
  templateVersion: string;
  locale: string;
  subject: string;
}): Buffer {
  const bytes = Buffer.from(
    [
      'studytube-verification-payload:v1',
      input.pendingRegistrationId,
      input.recipient,
      input.sender,
      input.publicOrigin,
      input.templateVersion,
      input.locale,
      input.subject,
    ].join('\n'),
    'utf8',
  );
  return createHash('sha256').update(bytes).digest();
}
