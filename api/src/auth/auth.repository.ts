import type {
  CompleteRegistrationCommand,
  CompleteRegistrationResult,
  CommitLoginCommand,
  CommitLoginResult,
  ConsumeVerificationCommand,
  ConsumeVerificationResult,
  FindActiveSessionCommand,
  FindActiveSessionResult,
  FindAuthUserCommand,
  FindAuthUserResult,
  FindEnrollmentCandidateCommand,
  FindEnrollmentCandidateResult,
  FindEnrollmentReadinessCommand,
  FindEnrollmentReadinessResult,
  PendingRegistrationCommand,
  PendingRegistrationResult,
  RateLimitCommand,
  RateLimitResult,
  RevokeActiveSessionCommand,
  RevokeActiveSessionResult,
} from './auth.types';

export class AuthRepositoryUnavailableError extends Error {
  readonly code = 'AUTH_REPOSITORY_UNAVAILABLE';

  constructor() {
    super('Authentication persistence failed');
    this.name = 'AuthRepositoryUnavailableError';
  }
}

export interface AuthRepository {
  consumeRateLimit(command: RateLimitCommand): Promise<RateLimitResult>;
  findAuthUser(command: FindAuthUserCommand): Promise<FindAuthUserResult>;
  createPendingRegistration(
    command: PendingRegistrationCommand,
  ): Promise<PendingRegistrationResult>;
  consumeVerification(
    command: ConsumeVerificationCommand,
  ): Promise<ConsumeVerificationResult>;
  findEnrollmentCandidate(
    command: FindEnrollmentCandidateCommand,
  ): Promise<FindEnrollmentCandidateResult>;
  completeRegistration(
    command: CompleteRegistrationCommand,
  ): Promise<CompleteRegistrationResult>;
  commitLogin(command: CommitLoginCommand): Promise<CommitLoginResult>;
  findActiveSession(
    command: FindActiveSessionCommand,
  ): Promise<FindActiveSessionResult>;
  revokeActiveSession(
    command: RevokeActiveSessionCommand,
  ): Promise<RevokeActiveSessionResult>;
  findEnrollmentReadiness(
    command: FindEnrollmentReadinessCommand,
  ): Promise<FindEnrollmentReadinessResult>;
}
