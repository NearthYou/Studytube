export const PROVIDER_BUDGET_REPOSITORY = Symbol('PROVIDER_BUDGET_REPOSITORY');
export const MAX_LEARNING_AUDIO_SECONDS = 600;
export const DEFAULT_ESTIMATED_MICROUNITS_PER_AUDIO_SECOND = 50;

export type ReserveProviderWorkCommand = Readonly<{
  userId: number;
  provider: 'youtube';
  canonicalVideoId: string;
  canonicalUrl: string;
  requestedAudioSeconds: number;
  processingPurpose?: 'initial' | 'initial-gap-repair-v1';
}>;

export type ProviderBudgetReservation = Readonly<{
  reservationId: string;
  workId: string;
  admission: 'created' | 'joined';
  reservedAudioSeconds: number;
  subscriptionCreated: boolean;
}>;

export interface ProviderBudgetRepository {
  reserve(
    command: ReserveProviderWorkCommand,
  ): Promise<ProviderBudgetReservation>;
  attachContext(
    userId: number,
    reservationId: string,
    studyContextId: string,
  ): Promise<boolean>;
  commitWork(workId: string, actualCostMicrounits: number): Promise<boolean>;
  releaseSubscription(userId: number, reservationId: string): Promise<boolean>;
}

export type ProviderBudgetUnavailableReason =
  | 'DISABLED'
  | 'DAILY_CAP'
  | 'MONTHLY_CAP'
  | 'USER_DAILY_CAP'
  | 'CONCURRENCY_CAP'
  | 'USER_CONCURRENCY_CAP';

export class ProviderBudgetUnavailableError extends Error {
  readonly code = 'PROVIDER_BUDGET_UNAVAILABLE';

  constructor(readonly reason: ProviderBudgetUnavailableReason) {
    super('PROVIDER_BUDGET_UNAVAILABLE');
  }
}
