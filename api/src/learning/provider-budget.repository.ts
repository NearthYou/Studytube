export const PROVIDER_BUDGET_REPOSITORY = Symbol('PROVIDER_BUDGET_REPOSITORY');

export type ReserveProviderWorkCommand = Readonly<{
  userId: number;
  provider: 'youtube';
  canonicalVideoId: string;
  canonicalUrl: string;
  requestedAudioSeconds: number;
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
  commitWork(workId: string, actualCostMicrounits: number): Promise<boolean>;
  releaseSubscription(userId: number, reservationId: string): Promise<boolean>;
}

export type ProviderBudgetUnavailableReason =
  | 'DISABLED'
  | 'DAILY_CAP'
  | 'USER_DAILY_CAP'
  | 'CONCURRENCY_CAP'
  | 'USER_CONCURRENCY_CAP';

export class ProviderBudgetUnavailableError extends Error {
  readonly code = 'PROVIDER_BUDGET_UNAVAILABLE';

  constructor(readonly reason: ProviderBudgetUnavailableReason) {
    super('PROVIDER_BUDGET_UNAVAILABLE');
  }
}
