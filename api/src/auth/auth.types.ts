export type AuthPublicUser = {
  id: number;
  name: string;
  email: string;
  createdAt: string;
};

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

export type CompleteRegistrationCommand = {
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
  sessionId: string;
  sessionDigest: Buffer;
  sessionCreatedAt: Date;
  sessionAbsoluteExpiresAt: Date;
  sessionIdleExpiresAt: Date;
  completedAt: Date;
};

export type CompleteRegistrationResult =
  | { status: 'completed'; user: AuthPublicUser }
  | { status: 'invalid' }
  | { status: 'conflict' };
