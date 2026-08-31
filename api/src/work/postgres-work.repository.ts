import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  WorkLeaseLostError,
  WorkReplayConflictError,
  type WorkRepository,
} from './work.repository';
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
  OutboxHealthSnapshot,
} from './work.types';
import {
  observabilityRuntime,
  type ObservabilityRuntime,
} from '../observability/runtime';
import { redactTelemetryValue } from '../observability/redaction';
import type {
  JobExecutionAcquisition,
  JobExecutionCompletion,
  JobExecutionKey,
  JobExecutionRecord,
  JobExecutionStore,
} from './job-execution.store';
import {
  WorkJobCompletionConflictError,
  WorkJobLeaseLostError,
} from './work.errors';

export class PostgresWorkRepository
  implements WorkRepository, JobExecutionStore
{
  constructor(
    private readonly pool: Pool,
    private readonly observability: ObservabilityRuntime = observabilityRuntime,
  ) {}

  async appendOutboxEvent(
    event: AppendOutboxEvent,
    client: WorkSqlClient = this.pool,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO work_outbox_events (
          id,
          owner_id,
          event_type,
          aggregate_type,
          aggregate_id,
          aggregate_version,
          payload_schema_version,
          payload,
          trace_context,
          occurred_at,
          available_at,
          max_attempts
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          COALESCE($10, statement_timestamp()),
          COALESCE($11, statement_timestamp()),
          $12
        )
        ON CONFLICT (id) DO NOTHING
      `,
      [
        event.id,
        event.ownerId,
        event.eventType,
        event.aggregateType,
        event.aggregateId,
        event.aggregateVersion,
        event.payloadSchemaVersion,
        event.payload,
        event.traceContext ?? this.currentTraceContext(event.id),
        event.occurredAt ?? null,
        event.availableAt ?? null,
        event.maxAttempts ?? 8,
      ],
    );
  }

  async listLearningRetrievalContexts(input: {
    causeEventId: string;
    reservationId: string;
    captionArtifactId: string;
  }): Promise<Array<{ studyContextId: string; sourceVersion: string }>> {
    const result = await this.pool.query<{
      studyContextId: string;
      sourceVersion: string;
    }>(
      `
        SELECT context.id::text AS "studyContextId",
               context.retrieval_version::text AS "sourceVersion"
        FROM provider_work_reservations AS work
        JOIN provider_subscription_reservations AS subscription
          ON subscription.work_reservation_id = work.id
         AND subscription.state = 'committed'
        JOIN study_contexts AS context
          ON context.id = subscription.study_context_id
         AND context.user_id = subscription.user_id
        JOIN learning_items AS item ON item.id = context.learning_item_id
          AND item.user_id = context.user_id
        JOIN caption_artifacts AS artifact
          ON artifact.id = $3::bigint
         AND artifact.video_source_id = item.video_source_id
        JOIN caption_generation_states AS state
          ON state.artifact_id = artifact.id AND state.status = 'ready'
        WHERE work.id = $2::bigint
          AND work.work_id = $1::uuid
          AND work.state = 'committed'
          AND artifact.id = COALESCE(
            context.current_translation_caption_artifact_id,
            context.current_source_caption_artifact_id
          )
        ORDER BY context.id
      `,
      [input.causeEventId, input.reservationId, input.captionArtifactId],
    );
    return result.rows;
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
          event.owner_id AS "ownerId",
          event.event_type AS "eventType",
          event.aggregate_type AS "aggregateType",
          event.aggregate_id AS "aggregateId",
          event.aggregate_version AS "aggregateVersion",
          event.payload_schema_version AS "payloadSchemaVersion",
          event.payload,
          event.trace_context AS "traceContext",
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
          ON CONFLICT (event_id, handler_version) DO NOTHING
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

  async acquire(
    key: JobExecutionKey,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<JobExecutionAcquisition> {
    return this.withJobExecutionTransaction(key, async (client) => {
      const completed = await client.query<JobExecutionRecord>(
        `
          SELECT
            event_id AS "eventId",
            handler_version AS "handlerVersion",
            outcome,
            result
          FROM work_job_results
          WHERE event_id = $1 AND handler_version = $2
        `,
        [key.eventId, key.handlerVersion],
      );
      const record = completed.rows[0];
      if (record) {
        return { status: 'completed', record };
      }

      const leaseToken = randomUUID();
      const claimed = await client.query<{ leaseToken: string }>(
        `
          INSERT INTO work_job_claims (
            event_id,
            handler_version,
            lease_owner,
            lease_token,
            lease_expires_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            statement_timestamp() + ($5::integer * interval '1 millisecond')
          )
          ON CONFLICT (event_id, handler_version) DO UPDATE
          SET lease_owner = EXCLUDED.lease_owner,
              lease_token = EXCLUDED.lease_token,
              lease_expires_at = EXCLUDED.lease_expires_at,
              renewed_at = statement_timestamp()
          WHERE work_job_claims.lease_expires_at <= statement_timestamp()
          RETURNING lease_token AS "leaseToken"
        `,
        [key.eventId, key.handlerVersion, leaseOwner, leaseToken, leaseMs],
      );
      const claim = claimed.rows[0];
      return claim
        ? { status: 'acquired', leaseToken: claim.leaseToken }
        : { status: 'busy' };
    });
  }

  async complete(
    key: JobExecutionKey,
    leaseToken: string,
    completion: JobExecutionCompletion,
  ): Promise<void> {
    await this.withJobExecutionTransaction(key, async (client) => {
      const deleted = await client.query<{ eventId: string }>(
        `
          DELETE FROM work_job_claims
          WHERE event_id = $1
            AND handler_version = $2
            AND lease_token = $3
            AND lease_expires_at > statement_timestamp()
          RETURNING event_id AS "eventId"
        `,
        [key.eventId, key.handlerVersion, leaseToken],
      );
      if (!deleted.rows[0]) {
        throw new WorkJobLeaseLostError();
      }

      await client.query(
        `
          INSERT INTO work_job_results (
            id, event_id, handler_version, outcome, result
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          randomUUID(),
          key.eventId,
          key.handlerVersion,
          completion.outcome,
          completion.result,
        ],
      );
      if (completion.deadLetter) {
        const safeMessage = this.safeFailureMessage(
          completion.deadLetter.message,
        );
        const details = completion.deadLetter.details ?? {};
        const recorded = await client.query<{ id: string }>(
          `
            INSERT INTO work_dead_letters (
              id,
              event_id,
              handler_version,
              failure_code,
              failure_message,
              failure
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (event_id, handler_version) DO UPDATE
            SET failure_code = work_dead_letters.failure_code
            WHERE work_dead_letters.failure_code = EXCLUDED.failure_code
              AND work_dead_letters.failure_message = EXCLUDED.failure_message
              AND work_dead_letters.failure = EXCLUDED.failure
            RETURNING id
          `,
          [
            randomUUID(),
            key.eventId,
            key.handlerVersion,
            completion.deadLetter.code,
            safeMessage,
            details,
          ],
        );
        if (!recorded.rows[0]) {
          throw new WorkJobCompletionConflictError();
        }
      }
    });
  }

  async renew(
    key: JobExecutionKey,
    leaseToken: string,
    leaseMs: number,
  ): Promise<boolean> {
    const renewed = await this.pool.query<{ eventId: string }>(
      `
        UPDATE work_job_claims
        SET lease_expires_at = statement_timestamp()
              + ($4::integer * interval '1 millisecond'),
            renewed_at = statement_timestamp()
        WHERE event_id = $1
          AND handler_version = $2
          AND lease_token = $3
          AND lease_expires_at > statement_timestamp()
        RETURNING event_id AS "eventId"
      `,
      [key.eventId, key.handlerVersion, leaseToken, leaseMs],
    );
    return renewed.rows[0] !== undefined;
  }

  async release(key: JobExecutionKey, leaseToken: string): Promise<boolean> {
    const released = await this.pool.query<{ eventId: string }>(
      `
        DELETE FROM work_job_claims
        WHERE event_id = $1
          AND handler_version = $2
          AND lease_token = $3
        RETURNING event_id AS "eventId"
      `,
      [key.eventId, key.handlerVersion, leaseToken],
    );
    return released.rows[0] !== undefined;
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

  async findJobResult(
    eventId: string,
    handlerVersion: string,
  ): Promise<JobResult | null> {
    const result = await this.pool.query<JobResult>(
      `
        SELECT
          id,
          event_id AS "eventId",
          handler_version AS "handlerVersion",
          outcome,
          result
        FROM work_job_results
        WHERE event_id = $1 AND handler_version = $2
      `,
      [eventId, handlerVersion],
    );

    return result.rows[0] ?? null;
  }

  async recordDeadLetter(input: RecordDeadLetter): Promise<boolean> {
    const inserted = await this.pool.query<{ id: string }>(
      `
        INSERT INTO work_dead_letters (
          id,
          event_id,
          handler_version,
          failure_code,
          failure_message,
          failure
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (event_id, handler_version) DO NOTHING
        RETURNING id
      `,
      [
        input.id,
        input.eventId,
        input.handlerVersion,
        input.code,
        this.safeFailureMessage(input.message),
        input.details ?? {},
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
            event.owner_id,
            event.event_type,
            event.aggregate_type,
            event.aggregate_id,
            event.aggregate_version,
            event.payload_schema_version,
            event.payload,
            event.trace_context,
            event.max_attempts
          FROM work_dead_letters AS dead_letter
          JOIN work_outbox_events AS event ON event.id = dead_letter.event_id
          WHERE dead_letter.id = $1
            AND dead_letter.replayed_at IS NULL
          FOR UPDATE OF dead_letter
        ), replay_event AS (
          INSERT INTO work_outbox_events (
            id,
            owner_id,
            event_type,
            aggregate_type,
            aggregate_id,
            aggregate_version,
            payload_schema_version,
            payload,
            trace_context,
            max_attempts
          )
          SELECT
            $2,
            owner_id,
            event_type,
            aggregate_type,
            aggregate_id,
            aggregate_version,
            payload_schema_version,
            payload || jsonb_build_object('replayOf', original_event_id),
            trace_context,
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
    const redacted = redactTelemetryValue(message);
    return (typeof redacted === 'string' ? redacted : 'WORK_FAILURE')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
  }

  async readOutboxHealthSnapshot(): Promise<OutboxHealthSnapshot> {
    const result = await this.pool.query<{
      pending: number | string;
      oldestAgeSeconds: number | string;
    }>(`
      SELECT count(*)::integer AS pending,
             COALESCE(
               EXTRACT(EPOCH FROM (
                 statement_timestamp() - min(occurred_at)
               )),
               0
             ) AS "oldestAgeSeconds"
      FROM work_outbox_events
      WHERE published_at IS NULL AND terminal_at IS NULL
    `);
    return {
      pending: Number(result.rows[0]?.pending ?? 0),
      oldestAgeSeconds: Math.max(
        0,
        Number(result.rows[0]?.oldestAgeSeconds ?? 0),
      ),
    };
  }

  private currentTraceContext(eventId: string): Record<string, string> {
    try {
      return this.observability.traces.injectJob(eventId);
    } catch {
      return { 'x-studytube-job-id': eventId };
    }
  }

  private async withJobExecutionTransaction<T>(
    key: JobExecutionKey,
    task: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${key.eventId}:${key.handlerVersion}`],
      );
      const result = await task(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the transaction failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
