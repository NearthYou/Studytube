export type AuthPublicUser = {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly createdAt: string;
};

export type AuthPasswordAlgorithm = 'argon2id' | 'legacy_sha256' | 'disabled';

export type AuthUserCredential = AuthPublicUser & {
  readonly emailCanonical: string;
  readonly passwordHash: string;
  readonly passwordAlgorithm: AuthPasswordAlgorithm;
  readonly passwordParameters: Readonly<Record<string, unknown>>;
  readonly passwordVersion: number;
  readonly identityAssurance: 'email_verified' | 'legacy_grandfathered';
};

export type FindAuthUserCommand = { emailCanonical: string };
export type FindAuthUserResult = { user: AuthUserCredential | null };

export type SessionMaterial = {
  sessionId: string;
  sessionDigest: Buffer;
  sessionCreatedAt: Date;
  sessionAbsoluteExpiresAt: Date;
  sessionIdleExpiresAt: Date;
};

export type PasswordUpgrade = {
  passwordHash: string;
  passwordAlgorithm: 'argon2id';
  passwordParameters: {
    memoryKiB: 65_536;
    timeCost: 3;
    parallelism: 1;
  };
  passwordVersion: number;
};

export type CommitLoginCommand = SessionMaterial & {
  userId: number;
  expectedPasswordHash: string;
  expectedPasswordVersion: number;
  passwordUpgrade?: PasswordUpgrade;
};

export type CommitLoginResult =
  | { status: 'committed'; user: AuthPublicUser }
  | { status: 'stale' }
  | { status: 'invalid' };

export type AuthPrincipal = {
  readonly sessionId: string;
  readonly userId: number;
};

export type FindActiveSessionCommand = { sessionDigest: Buffer };
export type FindActiveSessionResult =
  | {
      status: 'active';
      principal: AuthPrincipal;
      user: AuthPublicUser;
    }
  | { status: 'invalid' };

export type RevokeActiveSessionCommand = {
  sessionDigest: Buffer;
  reason: 'logout';
};
export type RevokeActiveSessionResult =
  | { status: 'revoked' }
  | { status: 'invalid' };

export type FindEnrollmentReadinessCommand = { enrollmentDigest: Buffer };
export type FindEnrollmentReadinessResult =
  | { status: 'ready' }
  | { status: 'invalid' };

export type RateLimitCommand = {
  action: string;
  subjectDigest: Buffer;
  windowSeconds: number;
  maxAttempts: number;
};

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export type PendingRegistrationCommand = {
  action: 'signup' | 'resend';
  pendingRegistrationId: string;
  emailCanonical: string;
  recipient: string;
  keyVersion: 1;
  verificationDigest: Buffer;
  createdAt: Date;
  verificationExpiresAt: Date;
  outbox: {
    id: string;
    idempotencyKey: string;
    sender: string;
    publicOrigin: string;
    templateVersion: string;
    locale: string;
    subject: string;
    payloadHash: Buffer;
  };
};

export type PendingRegistrationResult = { status: 'accepted' };

export type ConsumeVerificationCommand = {
  pendingRegistrationId: string;
  keyVersion: 1;
  presentedVerificationDigest: Buffer;
  enrollmentDigest: Buffer;
  verifiedAt: Date;
  enrollmentExpiresAt: Date;
};

export type ConsumeVerificationResult =
  | { status: 'verified' }
  | { status: 'invalid' };

export type FindEnrollmentCandidateCommand = {
  enrollmentDigest: Buffer;
  at: Date;
};

export type FindEnrollmentCandidateResult = { eligible: boolean };

export type CompleteRegistrationCommand = SessionMaterial & {
  enrollmentDigest: Buffer;
  name: string;
  passwordHash: string;
  passwordAlgorithm: 'argon2id';
  passwordParameters: {
    memoryKiB: 65_536;
    timeCost: 3;
    parallelism: 1;
  };
  passwordVersion: 1;
  identityAssurance: 'email_verified';
  completedAt: Date;
};

export type CompleteRegistrationResult =
  | { status: 'completed'; user: AuthPublicUser }
  | { status: 'invalid' }
  | { status: 'conflict' };
