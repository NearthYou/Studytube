import type {
  AppendOutboxEvent,
  ClaimedOutboxEvent,
  JobResult,
  RecordDeadLetter,
  ReplayDeadLetter,
  ReplayResult,
  RetryResult,
  WorkFailure,
  WorkSqlClient,
} from './work.types';

export const WORK_REPOSITORY = Symbol('WORK_REPOSITORY');

export interface WorkRepository {
  appendOutboxEvent(
    event: AppendOutboxEvent,
    client?: WorkSqlClient,
  ): Promise<void>;
  claimOutboxBatch(
    limit: number,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<ClaimedOutboxEvent[]>;
  ackOutboxEvent(id: string, leaseToken: string): Promise<void>;
  retryOutboxEvent(
    id: string,
    leaseToken: string,
    handlerVersion: string,
    failure: WorkFailure,
  ): Promise<RetryResult>;
  findJobResult(
    eventId: string,
    handlerVersion: string,
  ): Promise<JobResult | null>;
  recordJobResult(result: JobResult): Promise<boolean>;
  recordDeadLetter(input: RecordDeadLetter): Promise<boolean>;
  replayDeadLetter(command: ReplayDeadLetter): Promise<ReplayResult>;
}

export class WorkLeaseLostError extends Error {
  readonly code = 'OUTBOX_LEASE_LOST';

  constructor() {
    super('OUTBOX_LEASE_LOST');
  }
}

export class WorkReplayConflictError extends Error {
  readonly code = 'DEAD_LETTER_ALREADY_REPLAYED';

  constructor() {
    super('DEAD_LETTER_ALREADY_REPLAYED');
  }
}
