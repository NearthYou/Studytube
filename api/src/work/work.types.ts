import type { PoolClient } from 'pg';

export type WorkSqlClient = Pick<PoolClient, 'query'>;

export type OutboxEventPayload = Record<string, unknown>;

export type AppendOutboxEvent = {
  id: string;
  ownerId: number | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payloadSchemaVersion: number;
  payload: OutboxEventPayload;
  traceContext?: Record<string, string>;
  occurredAt?: Date;
  availableAt?: Date;
  maxAttempts?: number;
};

export type ClaimedOutboxEvent = Required<
  Pick<
    AppendOutboxEvent,
    | 'id'
    | 'ownerId'
    | 'eventType'
    | 'aggregateType'
    | 'aggregateId'
    | 'aggregateVersion'
    | 'payloadSchemaVersion'
    | 'payload'
  >
> & {
  traceContext?: Record<string, string>;
  occurredAt: Date;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string;
};

export type WorkFailure = {
  code: string;
  message: string;
  retryDelayMs: number;
  details?: Record<string, unknown>;
};

export type JobResult = {
  id: string;
  eventId: string;
  handlerVersion: string;
  outcome: 'succeeded' | 'terminal_failure';
  result: Record<string, unknown>;
};

export type RecordDeadLetter = {
  id: string;
  eventId: string;
  handlerVersion: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ReplayDeadLetter = {
  deadLetterId: string;
  actorId: number | null;
  reason: string;
};

export type ReplayResult = {
  auditId: string;
  eventId: string;
};

export type RetryResult = 'retry_scheduled' | 'dead_lettered';

export type OutboxHealthSnapshot = {
  pending: number;
  oldestAgeSeconds: number;
};
