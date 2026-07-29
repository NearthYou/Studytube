import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { validateProposedSteps } from './learning.domain';
import {
  LearningLifecycleError,
  LearningNotFoundError,
  LearningPersistenceUnavailableError,
  LearningVersionConflictError,
} from './learning.errors';
import type {
  ClaimAgentRun,
  CompleteAgentRunCommand,
  CreateAgentRunCommand,
  FailAgentRunCommand,
  RecordAgentToolCallCommand,
  ReserveAgentRunUsageCommand,
  ReserveAgentRunUsageResult,
  SettleAgentWorkItemCommand,
  VersionedRunCommand,
} from './learning.repository';
import type {
  AgentRun,
  AgentRunAttempt,
  ProposedCourseStep,
} from './learning.types';
import {
  type AgentRunTransitionInput,
  PostgresAgentRunAttemptRepository,
} from './postgres-agent-run-attempt.repository';
import {
  assertSameHash,
  iso,
  mutate,
  nullableIso,
  type SqlClient,
  translatePostgresError,
} from './postgres-learning.persistence';
import {
  observabilityRuntime,
  type ObservabilityRuntime,
} from '../observability/runtime';

type AgentRunRow = {
  id: string;
  ownerId: number;
  courseId: number | null;
  state: AgentRun['state'];
  version: number;
  input: Record<string, unknown>;
  wallTimeBudgetMs: number;
  toolCallBudget: number;
  tokenBudget: number;
  estimatedCostBudgetUsd: string | number;
  consumedToolCalls: number;
  consumedTokens: number;
  consumedEstimatedCostUsd: string | number;
  queuedAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  updatedAt: Date | string;
  cancellationRequestedAt: Date | string | null;
  failureCode: string | null;
};

type AttemptRow = {
  id: string;
  attemptNumber: number;
  state: AgentRunAttempt['state'];
  queuedAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  failureCode: string | null;
  failureMessage: string | null;
  consumedToolCalls: number;
  consumedTokens: number;
  consumedEstimatedCostUsd: string | number;
};

export class PostgresAgentRunRepository {
  private readonly attempts: PostgresAgentRunAttemptRepository;

  constructor(
    private readonly pool: Pool,
    private readonly observability: ObservabilityRuntime = observabilityRuntime,
  ) {
    this.attempts = new PostgresAgentRunAttemptRepository(pool, {
      requireOwnerRun: (client, ownerId, runId) =>
        this.requireOwnerRun(client, ownerId, runId),
      recordTransition: (client, input) => this.recordTransition(client, input),
    });
  }

  async createRun(command: CreateAgentRunCommand): Promise<AgentRun> {
    return mutate(this.pool, async (client) => {
      const existing = await client.query<{
        id: string;
        payloadHash: Buffer;
      }>(
        `
          SELECT id, idempotency_payload_hash AS "payloadHash"
          FROM agent_runs
          WHERE owner_id = $1 AND idempotency_key_digest = $2
          FOR UPDATE
        `,
        [command.ownerId, command.idempotencyKeyDigest],
      );
      if (existing.rows[0]) {
        assertSameHash(existing.rows[0].payloadHash, command.payloadHash);
        return this.requireOwnerRun(
          client,
          command.ownerId,
          existing.rows[0].id,
        );
      }

      const runId = randomUUID();
      const attemptId = randomUUID();
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO agent_runs (
            id, owner_id, state, version, input,
            wall_time_budget_ms, tool_call_budget, token_budget,
            estimated_cost_budget_usd,
            idempotency_key_digest, idempotency_payload_hash,
            queued_at, updated_at
          )
          VALUES (
            $1, $2, 'queued', 1, $3::jsonb,
            $4, $5, $6, $7, $8, $9,
            statement_timestamp(), statement_timestamp()
          )
          ON CONFLICT (owner_id, idempotency_key_digest)
            WHERE idempotency_key_digest IS NOT NULL
          DO NOTHING
          RETURNING id
        `,
        [
          runId,
          command.ownerId,
          JSON.stringify(command.input),
          command.budgets.wallTimeBudgetMs,
          command.budgets.toolCallBudget,
          command.budgets.tokenBudget,
          command.budgets.estimatedCostBudgetUsd,
          command.idempotencyKeyDigest,
          command.payloadHash,
        ],
      );
      if (!inserted.rows[0]) {
        const raced = await client.query<{ id: string; payloadHash: Buffer }>(
          `
            SELECT id, idempotency_payload_hash AS "payloadHash"
            FROM agent_runs
            WHERE owner_id = $1 AND idempotency_key_digest = $2
          `,
          [command.ownerId, command.idempotencyKeyDigest],
        );
        const row = raced.rows[0];
        if (!row) throw new LearningPersistenceUnavailableError();
        assertSameHash(row.payloadHash, command.payloadHash);
        return this.requireOwnerRun(client, command.ownerId, row.id);
      }
      await client.query(
        `
          INSERT INTO agent_run_attempts (id, run_id, attempt_number, state, queued_at)
          VALUES ($1, $2, 1, 'queued', statement_timestamp())
        `,
        [attemptId, runId],
      );
      await this.recordTransition(client, {
        runId,
        attemptId,
        fromState: null,
        toState: 'queued',
        version: 1,
        reasonCode: 'created',
        actorKind: 'user',
      });
      return this.requireOwnerRun(client, command.ownerId, runId);
    });
  }

  async findOwnerRun(ownerId: number, runId: string): Promise<AgentRun | null> {
    try {
      return await this.loadRun(this.pool, ownerId, runId);
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  async cancelRun(command: VersionedRunCommand): Promise<AgentRun> {
    return mutate(this.pool, async (client) => {
      const current = await this.lockOwnerRun(client, command);
      if (!['queued', 'running', 'awaiting_approval'].includes(current.state)) {
        throw new LearningLifecycleError(
          'AgentRun cannot be cancelled from its current state',
        );
      }
      const nextVersion = current.version + 1;
      await client.query(
        `
          UPDATE agent_runs
          SET state = 'cancelled', version = $2,
              cancellation_requested_at = statement_timestamp(),
              finished_at = statement_timestamp(),
              updated_at = statement_timestamp()
          WHERE id = $1
        `,
        [command.runId, nextVersion],
      );
      await client.query(
        `
          UPDATE agent_run_attempts
          SET state = 'cancelled', finished_at = statement_timestamp(),
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
          WHERE run_id = $1 AND state IN ('queued', 'running')
        `,
        [command.runId],
      );
      await this.recordTransition(client, {
        runId: command.runId,
        attemptId: null,
        fromState: current.state,
        toState: 'cancelled',
        version: nextVersion,
        reasonCode: 'user_cancelled',
        actorKind: 'user',
      });
      return this.requireOwnerRun(client, command.ownerId, command.runId);
    });
  }

  async retryRun(command: VersionedRunCommand): Promise<AgentRun> {
    return mutate(this.pool, async (client) => {
      const current = await this.lockOwnerRun(client, command);
      if (!['failed', 'cancelled'].includes(current.state)) {
        throw new LearningLifecycleError(
          'Only a failed or cancelled AgentRun can be retried',
        );
      }
      if (current.courseId !== null) {
        if (current.state !== 'failed') {
          throw new LearningLifecycleError(
            'An approved AgentRun can only retry failed materialization work',
          );
        }
        return this.requeueApprovedWork(client, command, current.version);
      }
      const nextAttempt = await client.query<{ attemptNumber: number }>(
        `
          SELECT COALESCE(max(attempt_number), 0)::integer + 1 AS "attemptNumber"
          FROM agent_run_attempts
          WHERE run_id = $1
        `,
        [command.runId],
      );
      const attemptId = randomUUID();
      await client.query(
        `
          INSERT INTO agent_run_attempts (
            id, run_id, attempt_number, state, queued_at
          )
          VALUES ($1, $2, $3, 'queued', statement_timestamp())
        `,
        [attemptId, command.runId, nextAttempt.rows[0]?.attemptNumber ?? 1],
      );
      const nextVersion = current.version + 1;
      await client.query(
        `
          UPDATE agent_runs
          SET state = 'queued', version = $2,
              queued_at = statement_timestamp(),
              finished_at = NULL, cancellation_requested_at = NULL,
              failure_code = NULL, updated_at = statement_timestamp()
          WHERE id = $1
        `,
        [command.runId, nextVersion],
      );
      await this.recordTransition(client, {
        runId: command.runId,
        attemptId,
        fromState: current.state,
        toState: 'queued',
        version: nextVersion,
        reasonCode: 'user_retry',
        actorKind: 'user',
      });
      return this.requireOwnerRun(client, command.ownerId, command.runId);
    });
  }

  async approveRun(command: VersionedRunCommand): Promise<AgentRun> {
    return mutate(this.pool, async (client) => {
      const current = await this.lockOwnerRun(client, command);
      if (current.state !== 'awaiting_approval') {
        throw new LearningLifecycleError(
          'Only an AgentRun awaiting approval can be approved',
        );
      }
      const steps = await this.loadProposedSteps(client, command.runId);
      try {
        validateProposedSteps(steps);
      } catch (error) {
        throw new LearningLifecycleError(
          error instanceof Error ? error.message : 'Proposed steps are invalid',
        );
      }
      const objective =
        typeof current.input.objective === 'string'
          ? current.input.objective
          : 'Generated Study Course';
      const course = await client.query<{ id: number }>(
        `
          INSERT INTO courses (owner_id, title, description)
          VALUES ($1, $2, 'Generated from an approved AgentRun')
          RETURNING id
        `,
        [command.ownerId, objective],
      );
      const courseId = course.rows[0]?.id;
      if (!courseId) throw new LearningPersistenceUnavailableError();

      for (const step of steps) {
        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO course_steps (
              course_id, source_post_id, position,
              title_snapshot, video_url_snapshot,
              thumbnail_url_snapshot, channel_name_snapshot,
              evidence_source_url, evidence_timestamp_seconds,
              evidence_confidence, generation_status, duration_seconds
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id::text AS id
          `,
          [
            courseId,
            step.sourcePostId,
            step.position,
            step.title,
            step.videoUrl,
            step.thumbnailUrl,
            step.channelName,
            step.evidenceSourceUrl,
            step.evidenceTimestampSeconds,
            step.evidenceConfidence,
            step.status,
            step.durationSeconds,
          ],
        );
        const courseStepId = inserted.rows[0]?.id;
        if (!courseStepId) throw new LearningPersistenceUnavailableError();
        await this.enqueueApprovedStep(
          client,
          command.runId,
          courseStepId,
          step,
        );
      }
      await client.query(
        `
          UPDATE courses
          SET status = 'published', visibility = 'public',
              version = version + 1,
              published_at = statement_timestamp(),
              updated_at = statement_timestamp()
          WHERE id = $1
        `,
        [courseId],
      );
      const nextVersion = current.version + 1;
      await client.query(
        `
          UPDATE agent_runs
          SET state = 'approved', version = $2, course_id = $3,
              updated_at = statement_timestamp()
          WHERE id = $1
        `,
        [command.runId, nextVersion, courseId],
      );
      await this.recordTransition(client, {
        runId: command.runId,
        attemptId: null,
        fromState: 'awaiting_approval',
        toState: 'approved',
        version: nextVersion,
        reasonCode: 'user_approved',
        actorKind: 'user',
      });
      return this.requireOwnerRun(client, command.ownerId, command.runId);
    });
  }

  async claimRunAttempt(
    workerId: string,
    leaseMs: number,
  ): Promise<ClaimAgentRun | null> {
    return this.attempts.claimRunAttempt(workerId, leaseMs);
  }

  async reserveRunUsage(
    command: ReserveAgentRunUsageCommand,
  ): Promise<ReserveAgentRunUsageResult> {
    return this.attempts.reserveRunUsage(command);
  }

  async completeRunAttempt(command: CompleteAgentRunCommand): Promise<boolean> {
    return this.attempts.completeRunAttempt(command);
  }

  async failRunAttempt(command: FailAgentRunCommand): Promise<boolean> {
    return this.attempts.failRunAttempt(command);
  }

  async recordAgentToolCall(
    command: RecordAgentToolCallCommand,
  ): Promise<boolean> {
    return this.attempts.recordAgentToolCall(command);
  }

  async settleAgentWorkItem(
    command: SettleAgentWorkItemCommand,
  ): Promise<void> {
    await mutate(this.pool, async (client) => {
      const items = await client.query<{
        id: string;
        runId: string;
        status: string;
        runState: AgentRun['state'];
        runVersion: number;
      }>(
        `
          SELECT item.id, item.run_id AS "runId", item.status,
                 run.state AS "runState", run.version AS "runVersion"
          FROM agent_run_work_items AS item
          JOIN agent_runs AS run ON run.id = item.run_id
          WHERE item.course_step_id = $1::bigint AND item.kind = $2
          FOR UPDATE OF item, run
        `,
        [command.courseStepId, command.kind],
      );
      for (const item of items.rows) {
        if (['completed', 'failed', 'cancelled'].includes(item.status)) {
          continue;
        }
        await client.query(
          `
            UPDATE agent_run_work_items
            SET status = $2,
                completed_at = CASE WHEN $2 = 'completed'
                  THEN statement_timestamp() ELSE NULL END
            WHERE id = $1
          `,
          [item.id, command.outcome],
        );

        const nextVersion = item.runVersion + 1;
        if (command.outcome === 'failed') {
          if (!['completed', 'failed', 'cancelled'].includes(item.runState)) {
            await client.query(
              `
                UPDATE agent_runs
                SET state = 'failed', version = $2,
                    failure_code = $3, finished_at = statement_timestamp(),
                    updated_at = statement_timestamp()
                WHERE id = $1
              `,
              [
                item.runId,
                nextVersion,
                command.reasonCode ?? 'APPROVED_WORK_FAILED',
              ],
            );
            await this.recordTransition(client, {
              runId: item.runId,
              attemptId: null,
              fromState: item.runState,
              toState: 'failed',
              version: nextVersion,
              reasonCode: command.reasonCode ?? 'APPROVED_WORK_FAILED',
              actorKind: 'worker',
            });
          }
          continue;
        }

        const remaining = await client.query<{ count: number }>(
          `
            SELECT count(*)::integer AS count
            FROM agent_run_work_items
            WHERE run_id = $1
              AND kind IN ('video_asset', 'retrieval_embedding', 'quiz_generation')
              AND status <> 'completed'
          `,
          [item.runId],
        );
        if (
          (remaining.rows[0]?.count ?? 0) === 0 &&
          item.runState === 'approved'
        ) {
          await client.query(
            `
              UPDATE agent_runs
              SET state = 'completed', version = $2,
                  finished_at = statement_timestamp(),
                  updated_at = statement_timestamp()
              WHERE id = $1 AND state = 'approved'
            `,
            [item.runId, nextVersion],
          );
          await this.recordTransition(client, {
            runId: item.runId,
            attemptId: null,
            fromState: 'approved',
            toState: 'completed',
            version: nextVersion,
            reasonCode: 'approved_work_completed',
            actorKind: 'worker',
          });
        }
      }
    });
  }

  private async lockOwnerRun(client: PoolClient, command: VersionedRunCommand) {
    const result = await client.query<{
      ownerId: number;
      courseId: number | null;
      state: AgentRun['state'];
      version: number;
      input: Record<string, unknown>;
    }>(
      `
        SELECT owner_id AS "ownerId", course_id AS "courseId",
               state, version, input
        FROM agent_runs
        WHERE id = $1
        FOR UPDATE
      `,
      [command.runId],
    );
    const row = result.rows[0];
    if (!row || row.ownerId !== command.ownerId)
      throw new LearningNotFoundError();
    if (row.version !== command.expectedVersion) {
      throw new LearningVersionConflictError(
        command.expectedVersion,
        row.version,
      );
    }
    return row;
  }

  private async enqueueApprovedStep(
    client: PoolClient,
    runId: string,
    courseStepId: string,
    step: ProposedCourseStep,
  ): Promise<void> {
    const work: Array<{
      kind: 'video_asset' | 'retrieval_embedding' | 'quiz_generation';
      eventType:
        | 'video_asset.requested'
        | 'retrieval_embedding.requested'
        | 'quiz_generation.requested';
      payload: Record<string, unknown>;
      enqueue: boolean;
    }> = [];
    if (step.sourcePostId !== null) {
      work.push({
        kind: 'video_asset',
        eventType: 'video_asset.requested',
        payload: {
          courseStepId,
          postId: step.sourcePostId,
          sourcePostId: step.sourcePostId,
          videoUrl: step.videoUrl,
        },
        enqueue: true,
      });
    }
    work.push(
      {
        kind: 'retrieval_embedding',
        eventType: 'retrieval_embedding.requested',
        payload: {
          sourceKind: 'course_step',
          sourceId: courseStepId,
          courseStepId,
        },
        enqueue: step.sourcePostId === null,
      },
      {
        kind: 'quiz_generation',
        eventType: 'quiz_generation.requested',
        payload: {
          courseStepId,
          questionCount: 5,
          title: step.title,
          sourceUrl: step.evidenceSourceUrl,
          timestampSeconds: step.evidenceTimestampSeconds,
          durationSeconds: step.durationSeconds,
        },
        enqueue: true,
      },
    );
    for (const item of work) {
      const workItemId = randomUUID();
      const eventId = randomUUID();
      const traceContext = this.currentTraceContext(eventId);
      await client.query(
        `
          INSERT INTO agent_run_work_items (
            id, run_id, course_step_id, kind, position, status,
            payload_schema_version, payload
          )
          VALUES ($1, $2, $3::bigint, $4, $5, 'queued', 1, $6::jsonb)
        `,
        [
          workItemId,
          runId,
          courseStepId,
          item.kind,
          step.position,
          JSON.stringify(item.payload),
        ],
      );
      if (!item.enqueue) continue;
      await client.query(
        `
          INSERT INTO work_outbox_events (
            id, event_type, aggregate_type, aggregate_id,
            aggregate_version, payload_schema_version, payload, trace_context
          )
          VALUES ($1, $2, 'course_step', $3, 1, 1, $4::jsonb, $5::jsonb)
        `,
        [
          eventId,
          item.eventType,
          courseStepId,
          JSON.stringify(item.payload),
          JSON.stringify(traceContext),
        ],
      );
    }
  }

  private async requeueApprovedWork(
    client: PoolClient,
    command: VersionedRunCommand,
    currentVersion: number,
  ): Promise<AgentRun> {
    const failed = await client.query<{
      id: string;
      courseStepId: string;
      kind: 'video_asset' | 'retrieval_embedding' | 'quiz_generation';
      payloadSchemaVersion: number;
      payload: Record<string, unknown>;
    }>(
      `
        SELECT id, course_step_id::text AS "courseStepId", kind,
               payload_schema_version AS "payloadSchemaVersion", payload
        FROM agent_run_work_items
        WHERE run_id = $1
          AND kind IN ('video_asset', 'retrieval_embedding', 'quiz_generation')
          AND status = 'failed'
        ORDER BY position, kind
        FOR UPDATE
      `,
      [command.runId],
    );
    if (failed.rows.length === 0) {
      throw new LearningLifecycleError(
        'Approved AgentRun has no failed materialization work to retry',
      );
    }
    const eventTypes = {
      video_asset: 'video_asset.requested',
      retrieval_embedding: 'retrieval_embedding.requested',
      quiz_generation: 'quiz_generation.requested',
    } as const;
    for (const item of failed.rows) {
      const eventId = randomUUID();
      await client.query(
        `
          UPDATE agent_run_work_items
          SET status = 'queued', completed_at = NULL
          WHERE id = $1
        `,
        [item.id],
      );
      await client.query(
        `
          INSERT INTO work_outbox_events (
            id, event_type, aggregate_type, aggregate_id,
            aggregate_version, payload_schema_version, payload, trace_context
          )
          VALUES ($1, $2, 'course_step', $3, 1, $4, $5::jsonb, $6::jsonb)
        `,
        [
          eventId,
          eventTypes[item.kind],
          item.courseStepId,
          item.payloadSchemaVersion,
          JSON.stringify(item.payload),
          JSON.stringify(this.currentTraceContext(eventId)),
        ],
      );
    }
    const nextVersion = currentVersion + 1;
    await client.query(
      `
        UPDATE agent_runs
        SET state = 'approved', version = $2,
            failure_code = NULL, finished_at = NULL,
            updated_at = statement_timestamp()
        WHERE id = $1
      `,
      [command.runId, nextVersion],
    );
    await this.recordTransition(client, {
      runId: command.runId,
      attemptId: null,
      fromState: 'failed',
      toState: 'approved',
      version: nextVersion,
      reasonCode: 'approved_work_retry',
      actorKind: 'user',
    });
    return this.requireOwnerRun(client, command.ownerId, command.runId);
  }

  private currentTraceContext(eventId: string): Record<string, string> {
    try {
      return this.observability.traces.injectJob(eventId);
    } catch {
      return { 'x-studytube-job-id': eventId };
    }
  }

  private async requireOwnerRun(
    client: SqlClient,
    ownerId: number,
    runId: string,
  ): Promise<AgentRun> {
    const run = await this.loadRun(client, ownerId, runId);
    if (!run) throw new LearningNotFoundError();
    return run;
  }

  private async loadRun(
    client: SqlClient,
    ownerId: number,
    runId: string,
  ): Promise<AgentRun | null> {
    const result = await client.query<AgentRunRow>(
      `
        SELECT id, owner_id AS "ownerId", course_id AS "courseId",
               state, version, input,
               wall_time_budget_ms AS "wallTimeBudgetMs",
               tool_call_budget AS "toolCallBudget",
               token_budget AS "tokenBudget",
               estimated_cost_budget_usd AS "estimatedCostBudgetUsd",
               consumed_tool_calls AS "consumedToolCalls",
               consumed_tokens AS "consumedTokens",
               consumed_estimated_cost_usd AS "consumedEstimatedCostUsd",
               queued_at AS "queuedAt", started_at AS "startedAt",
               finished_at AS "finishedAt", updated_at AS "updatedAt",
               cancellation_requested_at AS "cancellationRequestedAt",
               failure_code AS "failureCode"
        FROM agent_runs
        WHERE id = $1 AND owner_id = $2
      `,
      [runId, ownerId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const attempts = await client.query<AttemptRow>(
      `
        SELECT id, attempt_number AS "attemptNumber", state,
               queued_at AS "queuedAt", started_at AS "startedAt",
               finished_at AS "finishedAt", failure_code AS "failureCode",
               failure_message AS "failureMessage",
               consumed_tool_calls AS "consumedToolCalls",
               consumed_tokens AS "consumedTokens",
               consumed_estimated_cost_usd AS "consumedEstimatedCostUsd"
        FROM agent_run_attempts
        WHERE run_id = $1
        ORDER BY attempt_number
      `,
      [runId],
    );
    const transitions = await client.query<{
      fromState: AgentRun['state'] | null;
      toState: AgentRun['state'];
      runVersion: number;
      reasonCode: string | null;
      actorKind: 'user' | 'worker' | 'system';
      occurredAt: Date | string;
    }>(
      `
        SELECT from_state AS "fromState", to_state AS "toState",
               run_version AS "runVersion", reason_code AS "reasonCode",
               actor_kind AS "actorKind", occurred_at AS "occurredAt"
        FROM agent_run_state_transitions
        WHERE run_id = $1
        ORDER BY run_version
      `,
      [runId],
    );
    return {
      id: row.id,
      ownerId: row.ownerId,
      courseId: row.courseId,
      state: row.state,
      version: row.version,
      input: row.input,
      budgets: {
        wallTimeBudgetMs: row.wallTimeBudgetMs,
        toolCallBudget: row.toolCallBudget,
        tokenBudget: row.tokenBudget,
        estimatedCostBudgetUsd: Number(row.estimatedCostBudgetUsd),
      },
      usage: {
        toolCalls: row.consumedToolCalls,
        tokens: row.consumedTokens,
        estimatedCostUsd: Number(row.consumedEstimatedCostUsd),
      },
      queuedAt: iso(row.queuedAt),
      startedAt: nullableIso(row.startedAt),
      finishedAt: nullableIso(row.finishedAt),
      updatedAt: iso(row.updatedAt),
      cancellationRequestedAt: nullableIso(row.cancellationRequestedAt),
      failureCode: row.failureCode,
      attempts: attempts.rows.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        state: attempt.state,
        queuedAt: iso(attempt.queuedAt),
        startedAt: nullableIso(attempt.startedAt),
        finishedAt: nullableIso(attempt.finishedAt),
        failureCode: attempt.failureCode,
        failureMessage: attempt.failureMessage,
        usage: {
          toolCalls: attempt.consumedToolCalls,
          tokens: attempt.consumedTokens,
          estimatedCostUsd: Number(attempt.consumedEstimatedCostUsd),
        },
      })),
      transitions: transitions.rows.map((transition) => ({
        ...transition,
        occurredAt: iso(transition.occurredAt),
      })),
      proposedSteps: await this.loadProposedSteps(client, runId),
    };
  }

  private async loadProposedSteps(
    client: SqlClient,
    runId: string,
  ): Promise<ProposedCourseStep[]> {
    const result = await client.query<{ payload: ProposedCourseStep }>(
      `
        SELECT payload
        FROM agent_run_work_items
        WHERE run_id = $1 AND kind = 'proposed_step' AND status = 'completed'
        ORDER BY position
      `,
      [runId],
    );
    return result.rows.map(({ payload }) => payload);
  }

  private async recordTransition(
    client: SqlClient,
    input: AgentRunTransitionInput,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO agent_run_state_transitions (
          run_id, attempt_id, from_state, to_state,
          run_version, reason_code, actor_kind
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        input.runId,
        input.attemptId,
        input.fromState,
        input.toState,
        input.version,
        input.reasonCode,
        input.actorKind,
      ],
    );
  }
}
