import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  validateAgentUsage,
  validateRecordedAgentUsage,
  validateProposedSteps,
} from './learning.domain';
import { LearningValidationError } from './learning.errors';
import type {
  AuthorizeAgentMcpCallCommand,
  ClaimAgentRun,
  CompleteAgentRunCommand,
  FailAgentRunCommand,
  RecordAgentToolCallCommand,
  ReserveAgentRunUsageCommand,
  ReserveAgentRunUsageResult,
} from './learning.repository';
import type { AgentRun, AgentRunAttempt, AgentUsage } from './learning.types';
import {
  mutate,
  type SqlClient,
  translatePostgresError,
} from './postgres-learning.persistence';

export type AgentRunTransitionInput = {
  runId: string;
  attemptId: string | null;
  fromState: AgentRun['state'] | null;
  toState: AgentRun['state'];
  version: number;
  reasonCode: string;
  actorKind: 'user' | 'worker' | 'system';
};

export type AgentRunAttemptRepositorySupport = {
  requireOwnerRun(
    client: SqlClient,
    ownerId: number,
    runId: string,
  ): Promise<AgentRun>;
  recordTransition(
    client: SqlClient,
    input: AgentRunTransitionInput,
  ): Promise<void>;
};

export class PostgresAgentRunAttemptRepository {
  constructor(
    private readonly pool: Pool,
    private readonly support: AgentRunAttemptRepositorySupport,
  ) {}

  async claimRunAttempt(
    workerId: string,
    leaseMs: number,
  ): Promise<ClaimAgentRun | null> {
    if (!workerId.trim() || !Number.isInteger(leaseMs) || leaseMs < 1) {
      throw new LearningValidationError(
        'lease',
        'A valid worker lease is required',
      );
    }
    return mutate(this.pool, async (client) => {
      const candidate = await client.query<{
        runId: string;
        ownerId: number;
        attemptId: string;
        attemptNumber: number;
        runState: AgentRun['state'];
        runVersion: number;
      }>(
        `
          SELECT r.id AS "runId", r.owner_id AS "ownerId",
                 a.id AS "attemptId", a.attempt_number AS "attemptNumber",
                 r.state AS "runState", r.version AS "runVersion"
          FROM agent_runs r
          JOIN agent_run_attempts a ON a.run_id = r.id
          WHERE r.cancellation_requested_at IS NULL
            AND (
              NOT (r.input ? 'studyContextId')
              OR EXISTS (
                SELECT 1
                FROM learning_retrieval_context_snapshots snapshot
                WHERE snapshot.agent_run_id = r.id
                  AND snapshot.owner_id = r.owner_id
              )
            )
            AND (
              (r.state = 'queued' AND a.state = 'queued')
              OR (
                r.state = 'running' AND a.state = 'running'
                AND a.lease_expires_at < statement_timestamp()
              )
            )
          ORDER BY r.queued_at, r.id, a.attempt_number
          FOR UPDATE OF r, a SKIP LOCKED
          LIMIT 1
        `,
      );
      const row = candidate.rows[0];
      if (!row) return null;
      const leaseToken = randomUUID();
      await client.query(
        `
          UPDATE agent_run_attempts
          SET state = 'running', lease_owner = $2, lease_token = $3,
              lease_expires_at = statement_timestamp() + ($4 * interval '1 millisecond'),
              started_at = COALESCE(started_at, statement_timestamp())
          WHERE id = $1
        `,
        [row.attemptId, workerId, leaseToken, leaseMs],
      );
      const nextVersion = row.runVersion + 1;
      await client.query(
        `
          UPDATE agent_runs
          SET state = 'running', version = $2,
              started_at = COALESCE(started_at, statement_timestamp()),
              updated_at = statement_timestamp()
          WHERE id = $1
        `,
        [row.runId, nextVersion],
      );
      await this.support.recordTransition(client, {
        runId: row.runId,
        attemptId: row.attemptId,
        fromState: row.runState,
        toState: 'running',
        version: nextVersion,
        reasonCode:
          row.runState === 'running' ? 'lease_reclaimed' : 'worker_claimed',
        actorKind: 'worker',
      });
      const run = await this.support.requireOwnerRun(
        client,
        row.ownerId,
        row.runId,
      );
      return {
        run,
        attemptId: row.attemptId,
        attemptNumber: row.attemptNumber,
        leaseToken,
      };
    });
  }

  async reserveRunUsage(
    command: ReserveAgentRunUsageCommand,
  ): Promise<ReserveAgentRunUsageResult> {
    validateRecordedAgentUsage(command.usage);
    return mutate(this.pool, async (client) => {
      const locked = await this.lockLeasedAttempt(client, command);
      if (!locked) return { status: 'lease_lost' };
      const cumulativeUsage = addUsage(locked.previousUsage, command.usage);
      try {
        validateAgentUsage(cumulativeUsage, locked.budgets, locked.elapsedMs);
      } catch (error) {
        if (error instanceof RangeError) {
          if (sameUsage(locked.attemptReservation, command.usage)) {
            return { status: 'reservation_conflict' };
          }
          return { status: 'budget_exhausted' };
        }
        throw error;
      }
      await client.query(
        `
          UPDATE agent_run_attempts
          SET consumed_tool_calls = consumed_tool_calls + $2,
              consumed_tokens = consumed_tokens + $3,
              consumed_estimated_cost_usd = consumed_estimated_cost_usd + $4
          WHERE id = $1
        `,
        [
          command.attemptId,
          command.usage.toolCalls,
          command.usage.tokens,
          command.usage.estimatedCostUsd,
        ],
      );
      await client.query(
        `
          UPDATE agent_runs
          SET consumed_tool_calls = $2, consumed_tokens = $3,
              consumed_estimated_cost_usd = $4,
              updated_at = statement_timestamp()
          WHERE id = $1
        `,
        [
          command.runId,
          cumulativeUsage.toolCalls,
          cumulativeUsage.tokens,
          cumulativeUsage.estimatedCostUsd,
        ],
      );
      return {
        status: 'reserved',
        wallTimeDeadlineAtMs: locked.wallTimeDeadlineAtMs,
      };
    });
  }

  async completeRunAttempt(command: CompleteAgentRunCommand): Promise<boolean> {
    validateProposedSteps(command.proposedSteps);
    return mutate(this.pool, async (client) => {
      const locked = await this.lockLeasedAttempt(client, command);
      if (!locked) return false;
      validateRecordedAgentUsage(command.usage);
      const cumulativeUsage = reconcileReservedUsage(
        locked.previousUsage,
        locked.attemptReservation,
        command.usage,
      );
      validateAgentUsage(cumulativeUsage, locked.budgets, locked.elapsedMs);
      await client.query(
        `
          UPDATE agent_run_attempts
          SET state = 'completed', finished_at = statement_timestamp(),
              consumed_tool_calls = $2, consumed_tokens = $3,
              consumed_estimated_cost_usd = $4,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
          WHERE id = $1
        `,
        [
          command.attemptId,
          command.usage.toolCalls,
          command.usage.tokens,
          command.usage.estimatedCostUsd,
        ],
      );
      await client.query(
        `DELETE FROM agent_run_work_items WHERE run_id = $1 AND kind = 'proposed_step'`,
        [command.runId],
      );
      for (const step of command.proposedSteps) {
        await client.query(
          `
            INSERT INTO agent_run_work_items (
              id, run_id, attempt_id, kind, position, status,
              payload_schema_version, payload, completed_at
            )
            VALUES ($1, $2, $3, 'proposed_step', $4, 'completed', 1,
                    $5::jsonb, statement_timestamp())
          `,
          [
            randomUUID(),
            command.runId,
            command.attemptId,
            step.position,
            JSON.stringify(step),
          ],
        );
      }
      const nextVersion = locked.version + 1;
      await client.query(
        `
          UPDATE agent_runs
          SET state = 'awaiting_approval', version = $2,
              consumed_tool_calls = $3, consumed_tokens = $4,
              consumed_estimated_cost_usd = $5,
              updated_at = statement_timestamp()
          WHERE id = $1
        `,
        [
          command.runId,
          nextVersion,
          cumulativeUsage.toolCalls,
          cumulativeUsage.tokens,
          cumulativeUsage.estimatedCostUsd,
        ],
      );
      await this.support.recordTransition(client, {
        runId: command.runId,
        attemptId: command.attemptId,
        fromState: 'running',
        toState: 'awaiting_approval',
        version: nextVersion,
        reasonCode: 'worker_completed_plan',
        actorKind: 'worker',
      });
      return true;
    });
  }

  async failRunAttempt(command: FailAgentRunCommand): Promise<boolean> {
    return mutate(this.pool, async (client) => {
      const locked = await this.lockLeasedAttempt(client, command);
      if (!locked) return false;
      validateRecordedAgentUsage(command.usage);
      const cumulativeUsage = reconcileReservedUsage(
        locked.previousUsage,
        locked.attemptReservation,
        command.usage,
      );
      await client.query(
        `
          UPDATE agent_run_attempts
          SET state = 'failed', finished_at = statement_timestamp(),
              failure_code = $2, failure_message = $3,
              consumed_tool_calls = $4, consumed_tokens = $5,
              consumed_estimated_cost_usd = $6,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
          WHERE id = $1
        `,
        [
          command.attemptId,
          command.failureCode,
          command.failureMessage,
          command.usage.toolCalls,
          command.usage.tokens,
          command.usage.estimatedCostUsd,
        ],
      );
      const nextVersion = locked.version + 1;
      await client.query(
        `
          UPDATE agent_runs
          SET state = 'failed', version = $2,
              consumed_tool_calls = $3, consumed_tokens = $4,
              consumed_estimated_cost_usd = $5,
              failure_code = $6, finished_at = statement_timestamp(),
              updated_at = statement_timestamp()
          WHERE id = $1
        `,
        [
          command.runId,
          nextVersion,
          cumulativeUsage.toolCalls,
          cumulativeUsage.tokens,
          cumulativeUsage.estimatedCostUsd,
          command.failureCode,
        ],
      );
      await this.support.recordTransition(client, {
        runId: command.runId,
        attemptId: command.attemptId,
        fromState: 'running',
        toState: 'failed',
        version: nextVersion,
        reasonCode: command.failureCode,
        actorKind: 'worker',
      });
      return true;
    });
  }

  async recordAgentToolCall(
    command: RecordAgentToolCallCommand,
  ): Promise<boolean> {
    if (
      !command.requestId.trim() ||
      command.requestId.length > 128 ||
      !command.toolName.trim() ||
      command.toolName.length > 128 ||
      !command.source.trim() ||
      command.source.length > 256 ||
      !Number.isInteger(command.inputSchemaVersion) ||
      command.inputSchemaVersion < 1 ||
      (command.outputSchemaVersion !== null &&
        (!Number.isInteger(command.outputSchemaVersion) ||
          command.outputSchemaVersion < 1)) ||
      !Number.isInteger(command.durationMs) ||
      command.durationMs < 0
    ) {
      throw new LearningValidationError(
        'toolCall',
        'Agent tool call audit data is invalid',
      );
    }
    try {
      const inserted = await this.pool.query<{ id: string }>(
        `
          INSERT INTO agent_tool_calls (
            id, run_id, attempt_id, request_id, tool_name,
            input_schema_version, output_schema_version,
            duration_ms, outcome, source, input, output
          )
          SELECT $1, run.id, attempt.id, $5, $6,
                 $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb
          FROM agent_runs AS run
          JOIN agent_run_attempts AS attempt
            ON attempt.run_id = run.id AND attempt.id = $4
          WHERE run.id = $3 AND run.owner_id = $2
          ON CONFLICT (run_id, request_id) DO NOTHING
          RETURNING id
        `,
        [
          randomUUID(),
          command.ownerId,
          command.runId,
          command.attemptId,
          command.requestId,
          command.toolName,
          command.inputSchemaVersion,
          command.outputSchemaVersion,
          command.durationMs,
          command.outcome,
          command.source,
          JSON.stringify(command.input),
          command.output === null ? null : JSON.stringify(command.output),
        ],
      );
      if (inserted.rows[0]) return true;
      const existing = await this.pool.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM agent_tool_calls AS call
            JOIN agent_runs AS run ON run.id = call.run_id
            WHERE call.run_id = $1 AND call.request_id = $2
              AND run.owner_id = $3
          ) AS exists
        `,
        [command.runId, command.requestId, command.ownerId],
      );
      return existing.rows[0]?.exists === true;
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  async authorizeAgentMcpCall(
    command: AuthorizeAgentMcpCallCommand,
  ): Promise<boolean> {
    return mutate(this.pool, async (client) => {
      const authorized = await client.query<{ authorized: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM agent_runs AS run
            JOIN agent_run_attempts AS attempt
              ON attempt.run_id = run.id
             AND attempt.id = $3::uuid
            JOIN learning_retrieval_context_snapshots AS snapshot
              ON snapshot.agent_run_id = run.id
             AND snapshot.owner_id = run.owner_id
            JOIN study_contexts AS context
              ON context.id = snapshot.study_context_id
             AND context.user_id = snapshot.owner_id
             AND context.learning_item_id = snapshot.learning_item_id
            WHERE run.id = $2::uuid
              AND run.owner_id = $1
              AND run.state = 'running'
              AND run.cancellation_requested_at IS NULL
              AND attempt.state = 'running'
              AND attempt.lease_token = $4::uuid
              AND attempt.lease_expires_at > statement_timestamp()
              AND snapshot.agent_run_id = $5::uuid
          ) AS authorized
        `,
        [
          command.ownerId,
          command.runId,
          command.attemptId,
          command.leaseToken,
          command.contextSnapshotId,
        ],
      );
      return authorized.rows[0]?.authorized === true;
    });
  }

  private async lockLeasedAttempt(
    client: PoolClient,
    command: {
      runId: string;
      attemptId: string;
      leaseToken: string;
      expectedVersion: number;
    },
  ): Promise<{
    version: number;
    elapsedMs: number;
    wallTimeDeadlineAtMs: number;
    previousUsage: AgentUsage;
    attemptReservation: AgentUsage;
    budgets: {
      wallTimeBudgetMs: number;
      toolCallBudget: number;
      tokenBudget: number;
      estimatedCostBudgetUsd: number;
    };
  } | null> {
    const result = await client.query<{
      version: number;
      state: AgentRun['state'];
      cancellationRequestedAt: Date | null;
      attemptState: AgentRunAttempt['state'];
      leaseToken: string | null;
      leaseExpiresAt: Date | null;
      wallTimeBudgetMs: number;
      toolCallBudget: number;
      tokenBudget: number;
      estimatedCostBudgetUsd: string | number;
      elapsedMs: string | number;
      wallTimeDeadlineAtMs: string | number;
      consumedToolCalls: number;
      consumedTokens: number;
      consumedEstimatedCostUsd: string | number;
      attemptReservedToolCalls: number;
      attemptReservedTokens: number;
      attemptReservedEstimatedCostUsd: string | number;
    }>(
      `
        SELECT r.version, r.state,
               r.cancellation_requested_at AS "cancellationRequestedAt",
               a.state AS "attemptState", a.lease_token AS "leaseToken",
               a.lease_expires_at AS "leaseExpiresAt",
               r.wall_time_budget_ms AS "wallTimeBudgetMs",
               r.tool_call_budget AS "toolCallBudget",
               r.token_budget AS "tokenBudget",
               r.estimated_cost_budget_usd AS "estimatedCostBudgetUsd",
               r.consumed_tool_calls AS "consumedToolCalls",
               r.consumed_tokens AS "consumedTokens",
               r.consumed_estimated_cost_usd AS "consumedEstimatedCostUsd",
               a.consumed_tool_calls AS "attemptReservedToolCalls",
               a.consumed_tokens AS "attemptReservedTokens",
               a.consumed_estimated_cost_usd AS "attemptReservedEstimatedCostUsd",
               GREATEST(
                0,
                EXTRACT(EPOCH FROM (
                  statement_timestamp() - COALESCE(r.started_at, statement_timestamp())
                )) * 1000
               ) AS "elapsedMs",
               EXTRACT(EPOCH FROM (
                 COALESCE(r.started_at, statement_timestamp())
                 + (r.wall_time_budget_ms * interval '1 millisecond')
               )) * 1000 AS "wallTimeDeadlineAtMs"
        FROM agent_runs r
        JOIN agent_run_attempts a ON a.run_id = r.id AND a.id = $2
        WHERE r.id = $1
        FOR UPDATE OF r, a
      `,
      [command.runId, command.attemptId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.version !== command.expectedVersion ||
      row.state !== 'running' ||
      row.attemptState !== 'running' ||
      row.cancellationRequestedAt !== null ||
      row.leaseToken !== command.leaseToken ||
      !row.leaseExpiresAt ||
      new Date(row.leaseExpiresAt).getTime() <= Date.now()
    ) {
      return null;
    }
    return {
      version: row.version,
      elapsedMs: Number(row.elapsedMs),
      wallTimeDeadlineAtMs: Number(row.wallTimeDeadlineAtMs),
      previousUsage: {
        toolCalls: row.consumedToolCalls,
        tokens: row.consumedTokens,
        estimatedCostUsd: Number(row.consumedEstimatedCostUsd),
      },
      attemptReservation: {
        toolCalls: row.attemptReservedToolCalls,
        tokens: row.attemptReservedTokens,
        estimatedCostUsd: Number(row.attemptReservedEstimatedCostUsd),
      },
      budgets: {
        wallTimeBudgetMs: row.wallTimeBudgetMs,
        toolCallBudget: row.toolCallBudget,
        tokenBudget: row.tokenBudget,
        estimatedCostBudgetUsd: Number(row.estimatedCostBudgetUsd),
      },
    };
  }
}

function addUsage(previous: AgentUsage, current: AgentUsage): AgentUsage {
  return {
    toolCalls: previous.toolCalls + current.toolCalls,
    tokens: previous.tokens + current.tokens,
    estimatedCostUsd: roundUsageCost(
      previous.estimatedCostUsd + current.estimatedCostUsd,
    ),
  };
}

function sameUsage(left: AgentUsage, right: AgentUsage): boolean {
  return (
    left.toolCalls === right.toolCalls &&
    left.tokens === right.tokens &&
    roundUsageCost(left.estimatedCostUsd) ===
      roundUsageCost(right.estimatedCostUsd)
  );
}

function reconcileReservedUsage(
  cumulativeReservation: AgentUsage,
  attemptReservation: AgentUsage,
  actualUsage: AgentUsage,
): AgentUsage {
  const normalizedActual = {
    ...actualUsage,
    estimatedCostUsd: roundUsageCost(actualUsage.estimatedCostUsd),
  };
  if (
    normalizedActual.toolCalls > attemptReservation.toolCalls ||
    normalizedActual.tokens > attemptReservation.tokens ||
    normalizedActual.estimatedCostUsd >
      roundUsageCost(attemptReservation.estimatedCostUsd)
  ) {
    throw new RangeError('Agent usage exceeds its reserved budget');
  }
  return {
    toolCalls:
      cumulativeReservation.toolCalls -
      attemptReservation.toolCalls +
      normalizedActual.toolCalls,
    tokens:
      cumulativeReservation.tokens -
      attemptReservation.tokens +
      normalizedActual.tokens,
    estimatedCostUsd: roundUsageCost(
      cumulativeReservation.estimatedCostUsd -
        attemptReservation.estimatedCostUsd +
        normalizedActual.estimatedCostUsd,
    ),
  };
}

function roundUsageCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
