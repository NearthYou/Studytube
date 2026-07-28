import type {
  CompleteRegistrationCommand,
  CompleteRegistrationResult,
  ConsumeVerificationCommand,
  ConsumeVerificationResult,
  FindEnrollmentCandidateCommand,
  FindEnrollmentCandidateResult,
  PendingRegistrationCommand,
  PendingRegistrationResult,
  RateLimitCommand,
  RateLimitResult,
} from './auth.types';

export interface AuthRepository {
  consumeRateLimit(command: RateLimitCommand): Promise<RateLimitResult>;
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
}
