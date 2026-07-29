import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  WorkLeaseLostError,
  WorkReplayConflictError,
  type WorkRepository,
} from './work.repository';
import type {
  AppendOutboxEvent,
  ClaimedOutboxEvent,
  JobResult,
  ReplayDeadLetter,
  ReplayResult,
  RetryResult,
  WorkFailure,
  WorkSqlClient,
} from './work.types';

export class PostgresWorkRepository implements WorkRepository {
  constructor(private readonly pool: Pool) {}

  async appendOutboxEvent(
    event: AppendOutboxEvent,
    client: WorkSqlClient = this.pool,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO work_outbox_events (
          id,
          event_type,
          aggregate_type,
          aggregate_id,
          aggregate_version,
          payload_schema_version,
          payload,
          occurred_at,
          available_at,
          max_attempts
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          COALESCE($8, statement_timestamp()),
          COALESCE($9, statement_timestamp()),
          $10
        )
      `,
      [
        event.id,
        event.eventType,
        event.aggregateType,
        event.aggregateId,
        event.aggregateVersion,
        event.payloadSchemaVersion,
        event.payload,
        event.occurredAt ?? null,
        event.availableAt ?? null,
        event.maxAttempts ?? 8,
      ],
    );
  }

  async claimOutboxBatch(
    limit: number,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<ClaimedOutboxEvent[]> {
    const leaseToken = randomUUID();
    const result = await this.pool.query<ClaimedOutboxEvent>(
      `
        WITH claimable AS (
          SELECT id
          FROM work_outbox_events
          WHERE published_at IS NULL
            AND terminal_at IS NULL
            AND available_at <= statement_timestamp()
            AND (
              lease_expires_at IS NULL
              OR lease_expires_at <= statement_timestamp()
            )
          ORDER BY available_at, occurred_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE work_outbox_events AS event
        SET lease_owner = $2,
            lease_token = $3,
            lease_expires_at = statement_timestamp()
              + ($4::integer * interval '1 millisecond'),
            attempt_count = event.attempt_count + 1
        FROM claimable
        WHERE event.id = claimable.id
        RETURNING
          event.id,
          event.event_type AS "eventType",
          event.aggregate_type AS "aggregateType",
          event.aggregate_id AS "aggregateId",
          event.aggregate_version AS "aggregateVersion",
          event.payload_schema_version AS "payloadSchemaVersion",
          event.payload,
          event.occurred_at AS "occurredAt",
          event.attempt_count AS "attemptCount",
          event.max_attempts AS "maxAttempts",
          event.lease_token AS "leaseToken"
      `,
      [limit, leaseOwner, leaseToken, leaseMs],
    );

    return result.rows;
  }

  async ackOutboxEvent(id: string, leaseToken: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>(
      `
        UPDATE work_outbox_events
        SET published_at = statement_timestamp(),
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_failure_code = NULL,
            last_failure_message = NULL
        WHERE id = $1
          AND lease_token = $2
          AND published_at IS NULL
          AND terminal_at IS NULL
        RETURNING id
      `,
      [id, leaseToken],
    );

    if (!result.rows[0]) {
      throw new WorkLeaseLostError();
    }
  }

  async retryOutboxEvent(
    id: string,
    leaseToken: string,
    handlerVersion: string,
    failure: WorkFailure,
  ): Promise<RetryResult> {
    const deadLetterId = randomUUID();
    const result = await this.pool.query<{ outcome: RetryResult }>(
      `
        WITH released AS (
          UPDATE work_outbox_events
          SET available_at = CASE
                WHEN attempt_count >= max_attempts
                  THEN available_at
                ELSE statement_timestamp()
                  + ($6::integer * interval '1 millisecond')
              END,
              terminal_at = CASE
                WHEN attempt_count >= max_attempts
                  THEN statement_timestamp()
                ELSE NULL
              END,
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_failure_code = $4,
              last_failure_message = $5
          WHERE id = $1
            AND lease_token = $2
            AND published_at IS NULL
            AND terminal_at IS NULL
          RETURNING *, attempt_count >= max_attempts AS exhausted
        ), dead_letter AS (
          INSERT INTO work_dead_letters (
            id,
            event_id,
            handler_version,
            failure_code,
            failure_message,
            failure
          )
          SELECT $3, id, $7, $4, $5, $8
          FROM released
          WHERE exhausted
          ON CONFLICT (event_id) DO NOTHING
          RETURNING event_id
        )
        SELECT CASE
          WHEN released.exhausted THEN 'dead_lettered'
          ELSE 'retry_scheduled'
        END AS outcome
        FROM released
        LEFT JOIN dead_letter ON dead_letter.event_id = released.id
      `,
      [
        id,
        leaseToken,
        deadLetterId,
        failure.code,
        this.safeFailureMessage(failure.message),
        Math.max(0, Math.trunc(failure.retryDelayMs)),
        handlerVersion,
        failure.details ?? {},
      ],
    );

    const outcome = result.rows[0]?.outcome;
    if (!outcome) {
      throw new WorkLeaseLostError();
    }
    return outcome;
  }

  async recordJobResult(result: JobResult): Promise<boolean> {
    const inserted = await this.pool.query<{ id: string }>(
      `
        INSERT INTO work_job_results (
          id, event_id, handler_version, outcome, result
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (event_id, handler_version) DO NOTHING
        RETURNING id
      `,
      [
        result.id,
        result.eventId,
        result.handlerVersion,
        result.outcome,
        result.result,
      ],
    );

    return inserted.rows[0] !== undefined;
  }

  async replayDeadLetter(command: ReplayDeadLetter): Promise<ReplayResult> {
    const auditId = randomUUID();
    const replayEventId = randomUUID();
    const result = await this.pool.query<{
      auditId: string;
      eventId: string;
    }>(
      `
        WITH locked AS MATERIALIZED (
          SELECT
            dead_letter.id AS dead_letter_id,
            event.id AS original_event_id,
            event.event_type,
            event.aggregate_type,
            event.aggregate_id,
            event.aggregate_version,
            event.payload_schema_version,
            event.payload,
            event.max_attempts
          FROM work_dead_letters AS dead_letter
          JOIN work_outbox_events AS event ON event.id = dead_letter.event_id
          WHERE dead_letter.id = $1
            AND dead_letter.replayed_at IS NULL
          FOR UPDATE OF dead_letter
        ), replay_event AS (
          INSERT INTO work_outbox_events (
            id,
            event_type,
            aggregate_type,
            aggregate_id,
            aggregate_version,
            payload_schema_version,
            payload,
            max_attempts
          )
          SELECT
            $2,
            event_type,
            aggregate_type,
            aggregate_id,
            aggregate_version,
            payload_schema_version,
            payload || jsonb_build_object('replayOf', original_event_id),
            max_attempts
          FROM locked
          RETURNING id
        ), marked AS (
          UPDATE work_dead_letters AS dead_letter
          SET replayed_at = statement_timestamp()
          FROM locked, replay_event
          WHERE dead_letter.id = locked.dead_letter_id
          RETURNING dead_letter.id
        )
        INSERT INTO work_replay_audits (
          id, dead_letter_id, actor_id, replay_event_id, reason
        )
        SELECT $3, marked.id, $4, replay_event.id, $5
        FROM marked, replay_event
        RETURNING id AS "auditId", replay_event_id AS "eventId"
      `,
      [
        command.deadLetterId,
        replayEventId,
        auditId,
        command.actorId,
        command.reason,
      ],
    );

    const replay = result.rows[0];
    if (!replay) {
      throw new WorkReplayConflictError();
    }
    return replay;
  }

  private safeFailureMessage(message: string): string {
    return message.replace(/\s+/g, ' ').trim().slice(0, 1000);
  }
}
