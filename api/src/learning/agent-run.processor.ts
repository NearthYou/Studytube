import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { McpLearningClient } from '../mcp/mcp-learning.client';
import type { ClaimAgentRun } from './learning.repository';
import type { LearningService } from './learning.service';
import type { AgentUsage, ProposedCourseStep } from './learning.types';

type LearningClient = Pick<
  LearningService,
  | 'claimRunAttempt'
  | 'reserveRunUsage'
  | 'completeRunAttempt'
  | 'failRunAttempt'
  | 'recordAgentToolCall'
>;

export type AgentRunProcessorOptions = {
  workerId: string;
  leaseMs: number;
  processTimeoutMs: number;
  pollIntervalMs: number;
  onError?: (error: unknown) => void;
};

type PreparedPlan = {
  proposedSteps: ProposedCourseStep[];
  usage: AgentUsage;
  sourceCount: number;
};

type FailureOutcome =
  | 'timeout'
  | 'invalid_schema'
  | 'failed'
  | 'budget_exhausted';

class AgentRunProcessingFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome: FailureOutcome,
    readonly usage: AgentUsage,
    readonly sourceCount = 0,
    readonly groundedStepCount = 0,
    readonly outputSchemaVersion: number | null = null,
  ) {
    super(message);
  }
}

export class AgentRunProcessor implements OnModuleInit, OnModuleDestroy {
  private stopped = true;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<boolean>;

  constructor(
    private readonly learning: LearningClient,
    private readonly mcp: McpLearningClient,
    private readonly options: AgentRunProcessorOptions,
  ) {
    if (
      !options.workerId.trim() ||
      !Number.isInteger(options.leaseMs) ||
      options.leaseMs < 2 ||
      !Number.isInteger(options.processTimeoutMs) ||
      options.processTimeoutMs < 1 ||
      options.processTimeoutMs >= options.leaseMs ||
      !Number.isInteger(options.pollIntervalMs) ||
      options.pollIntervalMs < 1
    ) {
      throw new RangeError(
        'AgentRun processor options require a timeout shorter than its lease.',
      );
    }
  }

  onModuleInit(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  async processOnce(): Promise<boolean> {
    if (this.inFlight) return false;
    const task = this.runOnce();
    this.inFlight = task;
    try {
      return await task;
    } finally {
      if (this.inFlight === task) this.inFlight = undefined;
    }
  }

  private async runOnce(): Promise<boolean> {
    const claimed = await this.learning.claimRunAttempt(
      this.options.workerId,
      this.options.leaseMs,
    );
    if (!claimed) return false;
    await this.processClaim(claimed);
    return true;
  }

  private async processClaim(claimed: ClaimAgentRun): Promise<void> {
    const startedAt = performance.now();
    const requestId = `${claimed.attemptId}:recommend:1`;
    let reservedUsage = claimedAttemptReservation(claimed);
    try {
      if (reservedUsage) {
        throw new AgentRunProcessingFailure(
          'AGENT_RUN_RESERVATION_RECOVERED',
          'A prior worker stopped after reserving this attempt budget.',
          'failed',
          reservedUsage,
        );
      }
      const input = readClaimedRunInput(claimed);
      const reservation = recommendationReservation(claimed);
      assertClaimedRunCanStartToolCall(claimed, reservation);
      const reserved = await this.learning.reserveRunUsage({
        runId: claimed.run.id,
        attemptId: claimed.attemptId,
        leaseToken: claimed.leaseToken,
        expectedVersion: claimed.run.version,
        usage: reservation,
      });
      if (
        reserved.status === 'lease_lost' ||
        reserved.status === 'reservation_conflict'
      ) {
        return;
      }
      if (reserved.status === 'budget_exhausted') {
        throw budgetExhaustedFailure();
      }
      reservedUsage = reservation;
      const remainingWallTimeMs = Math.floor(
        reserved.wallTimeDeadlineAtMs - Date.now(),
      );
      if (remainingWallTimeMs < 1) {
        throw budgetExhaustedFailure();
      }
      const plan = await withTimeout(
        this.preparePlan(claimed, input, reservation),
        Math.min(this.options.processTimeoutMs, remainingWallTimeMs),
      );
      if (!usageFitsReservation(plan.usage, reservation)) {
        throw new AgentRunProcessingFailure(
          'AGENT_USAGE_EXCEEDED_RESERVATION',
          'The tool reported usage above its reserved AgentRun budget.',
          'budget_exhausted',
          reservation,
          plan.sourceCount,
          plan.proposedSteps.length,
          1,
        );
      }
      try {
        await this.learning.completeRunAttempt({
          runId: claimed.run.id,
          attemptId: claimed.attemptId,
          leaseToken: claimed.leaseToken,
          expectedVersion: claimed.run.version,
          usage: plan.usage,
          proposedSteps: plan.proposedSteps,
        });
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        await this.learning.failRunAttempt({
          runId: claimed.run.id,
          attemptId: claimed.attemptId,
          leaseToken: claimed.leaseToken,
          expectedVersion: claimed.run.version,
          usage: plan.usage,
          failureCode: 'AGENT_BUDGET_EXCEEDED',
          failureMessage: 'The fixed AgentRun budget was exceeded.',
        });
      }
    } catch (error) {
      const failure = normalizeFailure(error, reservedUsage);
      await this.recordAudit(claimed, requestId, startedAt, {
        outcome: failure.outcome,
        outputSchemaVersion: failure.outputSchemaVersion,
        sourceCount: failure.sourceCount,
        groundedStepCount: failure.groundedStepCount,
        failureCode: failure.code,
      });
      await this.learning.failRunAttempt({
        runId: claimed.run.id,
        attemptId: claimed.attemptId,
        leaseToken: claimed.leaseToken,
        expectedVersion: claimed.run.version,
        usage: failure.usage,
        failureCode: failure.code,
        failureMessage: failure.message,
      });
    }
  }

  private async preparePlan(
    claimed: ClaimAgentRun,
    input: { objective: string; requestedStepCount: number },
    reservation: AgentUsage,
  ): Promise<PreparedPlan> {
    const { objective, requestedStepCount } = input;
    let response: unknown;
    try {
      response = await this.mcp.buildGroundedPlan(claimed, {
        objective: objective.trim(),
        requestedStepCount,
      });
    } catch {
      throw new AgentRunProcessingFailure(
        'AGENT_RETRIEVAL_FAILED',
        'The grounded retrieval request failed.',
        'failed',
        reservation,
      );
    }

    const parsed = parseMcpPlan(response, requestedStepCount);
    if (!parsed) {
      throw new AgentRunProcessingFailure(
        'INVALID_RETRIEVAL_RESPONSE',
        'The grounded retrieval response was invalid.',
        'invalid_schema',
        responseUsage(response, 1),
      );
    }
    const usage = responseUsage(response, 1);
    return {
      proposedSteps: parsed.proposedSteps,
      usage,
      sourceCount: parsed.evidenceCount,
    };
  }

  private async recordAudit(
    claimed: ClaimAgentRun,
    requestId: string,
    startedAt: number,
    result: {
      outcome: 'succeeded' | FailureOutcome;
      outputSchemaVersion: number | null;
      sourceCount: number;
      groundedStepCount: number;
      failureCode?: string;
    },
  ): Promise<void> {
    const requestedStepCount = finiteInteger(
      claimed.run.input.requestedStepCount,
    );
    const accepted = await this.learning.recordAgentToolCall({
      ownerId: claimed.run.ownerId,
      runId: claimed.run.id,
      attemptId: claimed.attemptId,
      requestId,
      toolName: 'retrieval.recommend',
      inputSchemaVersion: 1,
      outputSchemaVersion: result.outputSchemaVersion,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      outcome: result.outcome,
      source: 'worker:agent-run-processor',
      input: {
        requestedStepCount,
      },
      output: {
        sourceCount: result.sourceCount,
        groundedStepCount: result.groundedStepCount,
        outcome: result.outcome,
      },
    });
    if (!accepted) throw new Error('AgentRun tool-call audit was not accepted');
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runScheduledCycle();
    }, delayMs);
    this.timer.unref?.();
  }

  private async runScheduledCycle(): Promise<void> {
    try {
      await this.processOnce();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.schedule(this.options.pollIntervalMs);
    }
  }
}

function parseMcpPlan(
  value: unknown,
  requestedStepCount: number,
): {
  proposedSteps: ProposedCourseStep[];
  evidenceCount: number;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.schemaVersion !== 1 ||
    row.proposalVersion !== 1 ||
    !Array.isArray(row.proposedSteps) ||
    row.proposedSteps.length !== requestedStepCount ||
    !Number.isSafeInteger(row.evidenceCount) ||
    Number(row.evidenceCount) < requestedStepCount
  ) {
    return null;
  }
  return {
    proposedSteps: row.proposedSteps as ProposedCourseStep[],
    evidenceCount: Number(row.evidenceCount),
  };
}

function responseUsage(value: unknown, fallbackToolCalls: number): AgentUsage {
  const row = value && typeof value === 'object' ? value : {};
  const usageValue = (row as Record<string, unknown>).usage;
  const usage =
    usageValue && typeof usageValue === 'object'
      ? (usageValue as Record<string, unknown>)
      : {};
  return {
    toolCalls: Math.max(
      fallbackToolCalls,
      finiteInteger(usage.toolCalls) ?? fallbackToolCalls,
    ),
    tokens: Math.max(
      0,
      finiteInteger(usage.totalTokens ?? usage.tokens ?? usage.inputTokens) ??
        0,
    ),
    estimatedCostUsd: nonNegativeFinite(
      usage.estimatedCostUsd ?? usage.costUsd,
    ),
  };
}

function finiteInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nonNegativeFinite(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function emptyUsage(): AgentUsage {
  return { toolCalls: 0, tokens: 0, estimatedCostUsd: 0 };
}

function readClaimedRunInput(claimed: ClaimAgentRun): {
  objective: string;
  requestedStepCount: number;
} {
  const objective = claimed.run.input.objective;
  const requestedStepCount = claimed.run.input.requestedStepCount;
  if (
    typeof objective !== 'string' ||
    !objective.trim() ||
    !Number.isInteger(requestedStepCount) ||
    Number(requestedStepCount) < 3 ||
    Number(requestedStepCount) > 6
  ) {
    throw new AgentRunProcessingFailure(
      'INVALID_AGENT_RUN_INPUT',
      'The claimed AgentRun input is invalid.',
      'invalid_schema',
      emptyUsage(),
    );
  }
  return {
    objective: objective.trim(),
    requestedStepCount: Number(requestedStepCount),
  };
}

function claimedAttemptReservation(claimed: ClaimAgentRun): AgentUsage | null {
  const reservation = claimed.run.attempts.find(
    (attempt) => attempt.id === claimed.attemptId,
  )?.usage;
  if (
    !reservation ||
    (reservation.toolCalls === 0 &&
      reservation.tokens === 0 &&
      reservation.estimatedCostUsd === 0)
  ) {
    return null;
  }
  return reservation;
}

function recommendationReservation(claimed: ClaimAgentRun): AgentUsage {
  const usage = claimed.run.usage;
  const budgets = claimed.run.budgets;
  return {
    toolCalls: 1,
    tokens: Math.max(0, budgets.tokenBudget - usage.tokens),
    estimatedCostUsd: Math.max(
      0,
      roundCost(budgets.estimatedCostBudgetUsd - usage.estimatedCostUsd),
    ),
  };
}

function assertClaimedRunCanStartToolCall(
  claimed: ClaimAgentRun,
  reservation: AgentUsage,
): void {
  const usage = claimed.run.usage;
  const budgets = claimed.run.budgets;
  if (
    reservation.tokens < 1 ||
    reservation.estimatedCostUsd <= 0 ||
    usage.toolCalls + reservation.toolCalls > budgets.toolCallBudget ||
    usage.tokens + reservation.tokens > budgets.tokenBudget ||
    roundCost(usage.estimatedCostUsd + reservation.estimatedCostUsd) >
      budgets.estimatedCostBudgetUsd
  ) {
    throw budgetExhaustedFailure();
  }
}

function budgetExhaustedFailure(): AgentRunProcessingFailure {
  return new AgentRunProcessingFailure(
    'AGENT_BUDGET_EXCEEDED',
    'The fixed AgentRun budget was exhausted before the next tool call.',
    'budget_exhausted',
    emptyUsage(),
  );
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function usageFitsReservation(
  actual: AgentUsage,
  reservation: AgentUsage,
): boolean {
  return (
    actual.toolCalls <= reservation.toolCalls &&
    actual.tokens <= reservation.tokens &&
    roundCost(actual.estimatedCostUsd) <=
      roundCost(reservation.estimatedCostUsd)
  );
}

function normalizeFailure(
  error: unknown,
  reservedUsage: AgentUsage | null,
): AgentRunProcessingFailure {
  if (error instanceof AgentRunProcessingFailure) return error;
  if (error instanceof AgentRunTimeoutError) {
    return new AgentRunProcessingFailure(
      'AGENT_RUN_TIMEOUT',
      'The AgentRun processor exceeded its bounded execution time.',
      'timeout',
      reservedUsage ?? { toolCalls: 1, tokens: 0, estimatedCostUsd: 0 },
    );
  }
  return new AgentRunProcessingFailure(
    'AGENT_RUN_PROCESSING_FAILED',
    'The AgentRun processor could not verify grounded course steps.',
    'failed',
    reservedUsage ?? { toolCalls: 1, tokens: 0, estimatedCostUsd: 0 },
  );
}

class AgentRunTimeoutError extends Error {}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AgentRunTimeoutError()), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
