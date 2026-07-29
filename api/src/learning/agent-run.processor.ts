import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { AiProxyService } from '../ai-proxy.service';
import type { BoardRepository } from '../study-board.types';
import type { VideoAsset, VideoAssetSegment } from '../video-asset.types';
import type { ClaimAgentRun } from './learning.repository';
import type { LearningService } from './learning.service';
import type { AgentUsage, ProposedCourseStep } from './learning.types';

const DEFAULT_STEP_DURATION_SECONDS = 300;

type LearningClient = Pick<
  LearningService,
  | 'claimRunAttempt'
  | 'reserveRunUsage'
  | 'completeRunAttempt'
  | 'failRunAttempt'
  | 'recordAgentToolCall'
>;

type RecommendationClient = Pick<AiProxyService, 'recommend'>;
type PostReader = Pick<BoardRepository, 'findPost' | 'findVideoAsset'>;

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
    private readonly recommendations: RecommendationClient,
    private readonly posts: PostReader,
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
      await this.recordAudit(claimed, requestId, startedAt, {
        outcome: 'succeeded',
        outputSchemaVersion: 1,
        sourceCount: plan.sourceCount,
        groundedStepCount: plan.proposedSteps.length,
      });
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
      response = await this.recommendations.recommend(
        {
          query: objective.trim(),
          limit: Math.min(10, Number(requestedStepCount) * 2),
        },
        claimed.run.ownerId,
      );
    } catch {
      throw new AgentRunProcessingFailure(
        'AGENT_RETRIEVAL_FAILED',
        'The grounded retrieval request failed.',
        'failed',
        reservation,
      );
    }

    const parsed = parseRecommendation(response);
    if (!parsed) {
      throw new AgentRunProcessingFailure(
        'INVALID_RETRIEVAL_RESPONSE',
        'The grounded retrieval response was invalid.',
        'invalid_schema',
        responseUsage(response, 1),
      );
    }
    const usage = responseUsage(response, 1);
    const proposedSteps: ProposedCourseStep[] = [];
    const seenPostIds = new Set<number>();
    try {
      for (const source of parsed.sources) {
        if (proposedSteps.length >= Number(requestedStepCount)) break;
        const citation = parsePostCitation(source);
        if (!citation || seenPostIds.has(citation.postId)) continue;
        seenPostIds.add(citation.postId);
        const step = await this.verifiedStep(
          citation.postId,
          citation.sourceUrl,
          citation.timestampSeconds,
          citation.score,
          proposedSteps.length + 1,
        );
        if (step) proposedSteps.push(step);
      }
    } catch {
      throw new AgentRunProcessingFailure(
        'SOURCE_VERIFICATION_FAILED',
        'The retrieved post sources could not be verified.',
        'failed',
        usage,
        parsed.sources.length,
        proposedSteps.length,
        1,
      );
    }
    if (proposedSteps.length < Number(requestedStepCount)) {
      throw new AgentRunProcessingFailure(
        'INSUFFICIENT_GROUNDED_SOURCES',
        'The retrieval result did not contain enough verified post citations.',
        'invalid_schema',
        usage,
        parsed.sources.length,
        proposedSteps.length,
        1,
      );
    }
    return {
      proposedSteps,
      usage,
      sourceCount: parsed.sources.length,
    };
  }

  private async verifiedStep(
    postId: number,
    evidenceSourceUrl: string,
    evidenceTimestampSeconds: number,
    score: number,
    position: number,
  ): Promise<ProposedCourseStep | null> {
    const post = await this.posts.findPost(postId);
    if (
      !post ||
      !isAllowedYoutubeUrl(post.videoUrl) ||
      !sameYoutubeVideo(post.videoUrl, evidenceSourceUrl)
    ) {
      return null;
    }
    const asset = await this.posts.findVideoAsset(postId);
    return {
      position,
      title: post.title,
      videoUrl: post.videoUrl,
      thumbnailUrl: post.thumbnailUrl,
      channelName: post.channelName,
      sourcePostId: post.id,
      evidenceSourceUrl,
      evidenceTimestampSeconds,
      evidenceConfidence: Math.max(0, Math.min(1, score)),
      status: 'ready',
      durationSeconds: citedSegmentDuration(asset, evidenceTimestampSeconds),
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
    const objective = claimed.run.input.objective;
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
        queryLength: typeof objective === 'string' ? objective.length : 0,
        requestedStepCount,
      },
      output: {
        sourceCount: result.sourceCount,
        groundedStepCount: result.groundedStepCount,
        ...(result.failureCode ? { failureCode: result.failureCode } : {}),
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

function parseRecommendation(
  value: unknown,
): { sources: Array<Record<string, unknown>> } | null {
  if (!value || typeof value !== 'object') return null;
  const sources = (value as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) return null;
  return {
    sources: sources.filter(
      (source): source is Record<string, unknown> =>
        source !== null && typeof source === 'object',
    ),
  };
}

function parsePostCitation(source: Record<string, unknown>): {
  postId: number;
  sourceUrl: string;
  timestampSeconds: number;
  score: number;
} | null {
  if (source.sourceKind !== 'post') return null;
  const postId = positiveInteger(source.sourceId);
  const citation = source.citation;
  const score = Number(source.score);
  if (
    !postId ||
    !citation ||
    typeof citation !== 'object' ||
    !Number.isFinite(score)
  ) {
    return null;
  }
  const row = citation as Record<string, unknown>;
  const sourceUrl = row.sourceUrl;
  const timestampSeconds = Number(row.timestampSeconds);
  if (
    typeof sourceUrl !== 'string' ||
    !isAllowedYoutubeUrl(sourceUrl) ||
    !Number.isInteger(timestampSeconds) ||
    timestampSeconds < 0
  ) {
    return null;
  }
  return { postId, sourceUrl, timestampSeconds, score };
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

function citedSegmentDuration(
  asset: VideoAsset | null,
  timestampSeconds: number,
): number {
  if (!asset) return DEFAULT_STEP_DURATION_SECONDS;
  const segment = [...asset.translatedSegments, ...asset.sourceSegments].find(
    (candidate) =>
      validSegment(candidate) &&
      timestampSeconds >= candidate.start &&
      timestampSeconds < candidate.end,
  );
  return segment
    ? Math.max(1, Math.ceil(segment.end - segment.start))
    : DEFAULT_STEP_DURATION_SECONDS;
}

function validSegment(segment: VideoAssetSegment): boolean {
  return (
    Number.isFinite(segment.start) &&
    Number.isFinite(segment.end) &&
    segment.start >= 0 &&
    segment.end > segment.start
  );
}

function sameYoutubeVideo(left: string, right: string): boolean {
  const leftId = youtubeVideoId(left);
  return leftId !== null && leftId === youtubeVideoId(right);
}

function isAllowedYoutubeUrl(value: string): boolean {
  return youtubeVideoId(value) !== null;
}

function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] ?? null;
    }
    if (
      !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hostname)
    ) {
      return null;
    }
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const [kind, id] = url.pathname.split('/').filter(Boolean);
    return ['embed', 'shorts', 'live'].includes(kind ?? '') && id ? id : null;
  } catch {
    return null;
  }
}

function positiveInteger(value: unknown): number | null {
  const normalized = typeof value === 'number' ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/u.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
