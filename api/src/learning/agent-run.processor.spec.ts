import type { ClaimAgentRun } from './learning.repository';
import type { LearningService } from './learning.service';
import type { BoardRepository, StudyPost } from '../study-board.types';
import type { McpLearningClient } from '../mcp/mcp-learning.client';
import {
  AgentRunProcessor,
  type AgentRunProcessorOptions,
} from './agent-run.processor';

const OBJECTIVE = 'Build a grounded TypeScript course';
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=grounded-source';

function claim(overrides: Partial<ClaimAgentRun['run']> = {}): ClaimAgentRun {
  return {
    run: {
      id: '11111111-1111-4111-8111-111111111111',
      ownerId: 42,
      courseId: null,
      state: 'running',
      version: 2,
      input: { objective: OBJECTIVE, requestedStepCount: 3 },
      budgets: {
        wallTimeBudgetMs: 180_000,
        toolCallBudget: 12,
        tokenBudget: 24_000,
        estimatedCostBudgetUsd: 0.5,
      },
      usage: { toolCalls: 0, tokens: 0, estimatedCostUsd: 0 },
      queuedAt: '2026-07-29T00:00:00.000Z',
      startedAt: '2026-07-29T00:00:01.000Z',
      finishedAt: null,
      updatedAt: '2026-07-29T00:00:01.000Z',
      cancellationRequestedAt: null,
      failureCode: null,
      attempts: [],
      transitions: [],
      proposedSteps: [],
      ...overrides,
    },
    attemptId: '22222222-2222-4222-8222-222222222222',
    attemptNumber: 1,
    leaseToken: '33333333-3333-4333-8333-333333333333',
  };
}

function post(id: number): StudyPost {
  return {
    id,
    authorId: 7,
    authorName: 'Author',
    title: `Lesson ${id}`,
    videoUrl: `${YOUTUBE_URL}-${id}`,
    thumbnailUrl: `https://i.ytimg.com/vi/source-${id}/hqdefault.jpg`,
    channelName: `Channel ${id}`,
    summary: `Summary ${id}`,
    translatedNotes: `Notes ${id}`,
    tags: ['typescript'],
    comments: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
}

function recommendation(ids: number[]) {
  return {
    mode: 'hybrid',
    query: OBJECTIVE,
    sources: ids.map((id, index) => ({
      sourceKind: 'post',
      sourceId: String(id),
      visibility: 'public',
      title: `Untrusted title ${id}`,
      content: `Untrusted content ${id}`,
      score: 0.9 - index * 0.1,
      citation: {
        sourceUrl: `${YOUTUBE_URL}-${id}&t=${10 + index * 20}s`,
        timestampSeconds: 10 + index * 20,
      },
    })),
    usage: {
      toolCalls: 1,
      totalTokens: 321,
      estimatedCostUsd: 0.012,
    },
  };
}

async function emulateMcpPlan(
  response: unknown,
  posts: Map<number, StudyPost>,
  board: Pick<BoardRepository, 'findPost' | 'findVideoAsset'>,
) {
  if (!response || typeof response !== 'object') return response as never;
  const row = response as Record<string, unknown>;
  if (!Array.isArray(row.sources)) return response as never;
  const proposedSteps = [];
  for (const value of row.sources) {
    if (!value || typeof value !== 'object') continue;
    const source = value as Record<string, unknown>;
    const id = Number(source.sourceId);
    const citation = source.citation as Record<string, unknown> | undefined;
    const sourcePost = posts.get(id);
    if (
      source.sourceKind !== 'post' ||
      !sourcePost ||
      !citation ||
      !String(citation.sourceUrl).includes(`-${id}`)
    ) {
      continue;
    }
    const asset = await board.findVideoAsset(id);
    const timestamp = Number(citation.timestampSeconds);
    const segment = asset?.sourceSegments.find(
      (item) => timestamp >= item.start && timestamp < item.end,
    );
    proposedSteps.push({
      position: proposedSteps.length + 1,
      title: sourcePost.title,
      videoUrl: sourcePost.videoUrl,
      thumbnailUrl: sourcePost.thumbnailUrl,
      channelName: sourcePost.channelName,
      sourcePostId: id,
      evidenceSourceUrl: String(citation.sourceUrl),
      evidenceTimestampSeconds: timestamp,
      evidenceConfidence: Number(source.score),
      status: 'ready' as const,
      durationSeconds: segment ? Math.ceil(segment.end - segment.start) : 300,
    });
  }
  return {
    schemaVersion: 1 as const,
    proposedSteps,
    usage: row.usage,
    evidenceCount: proposedSteps.length,
    proposalVersion: 1,
  };
}

type LearningDouble = Pick<
  LearningService,
  | 'claimRunAttempt'
  | 'reserveRunUsage'
  | 'completeRunAttempt'
  | 'failRunAttempt'
  | 'recordAgentToolCall'
>;

function harness(input?: {
  claimed?: ClaimAgentRun | null;
  response?: unknown;
  completeResult?: boolean;
  reservationResult?: Awaited<ReturnType<LearningService['reserveRunUsage']>>;
  options?: Partial<AgentRunProcessorOptions>;
}) {
  const claimed = input?.claimed === undefined ? claim() : input.claimed;
  const completeCommands: Array<Record<string, unknown>> = [];
  const failureCommands: Array<Record<string, unknown>> = [];
  const auditCommands: Array<Record<string, unknown>> = [];
  const reserveCommands: Array<Record<string, unknown>> = [];
  let claimCalls = 0;
  const learning: LearningDouble = {
    claimRunAttempt: () => {
      claimCalls += 1;
      return Promise.resolve(claimed);
    },
    reserveRunUsage: (command) => {
      reserveCommands.push(command);
      return Promise.resolve(
        input?.reservationResult ?? {
          status: 'reserved',
          wallTimeDeadlineAtMs: Date.now() + 30_000,
        },
      );
    },
    completeRunAttempt: (command) => {
      completeCommands.push(command);
      return Promise.resolve(input?.completeResult ?? true);
    },
    failRunAttempt: (command) => {
      failureCommands.push(command);
      return Promise.resolve(true);
    },
    recordAgentToolCall: (command) => {
      auditCommands.push(command);
      return Promise.resolve(true);
    },
  };
  const posts = new Map([1, 2, 3, 4, 5, 6].map((id) => [id, post(id)]));
  const board: Pick<BoardRepository, 'findPost' | 'findVideoAsset'> = {
    findPost: (id) => Promise.resolve(posts.get(id) ?? null),
    findVideoAsset: (id) =>
      Promise.resolve({
        id,
        postId: id,
        videoId: `source-${id}`,
        videoUrl: post(id).videoUrl,
        language: 'ko',
        sourceLanguage: 'en',
        status: 'ready',
        sourceCaptionStatus: 'ready',
        translationStatus: 'ready',
        summaryStatus: 'ready',
        sourceSegments: [
          { start: 0, end: 30, text: 'First grounded segment' },
          { start: 30, end: 75, text: 'Second grounded segment' },
        ],
        translatedSegments: [],
        summarySections: [],
        transcriptBody: 'Grounded transcript',
        errorMessage: '',
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      }),
  };
  const buildGroundedPlan = jest.fn().mockImplementation(async () => {
    const response = input?.response ?? recommendation([1, 2, 3]);
    return emulateMcpPlan(response, posts, board);
  });
  const mcp: jest.Mocked<McpLearningClient> = {
    buildGroundedPlan,
  };
  const processor = new AgentRunProcessor(learning, mcp, {
    workerId: 'agent-run-worker-test',
    leaseMs: 30_000,
    processTimeoutMs: 25_000,
    pollIntervalMs: 1_000,
    ...input?.options,
  });

  return {
    processor,
    mcp,
    buildGroundedPlan,
    board,
    completeCommands,
    failureCommands,
    auditCommands,
    reserveCommands,
    claimCalls: () => claimCalls,
  };
}

describe('AgentRunProcessor', () => {
  it('does no work when no AgentRun can be claimed', async () => {
    const test = harness({ claimed: null });

    await expect(test.processor.processOnce()).resolves.toBe(false);

    expect(test.buildGroundedPlan).not.toHaveBeenCalled();
    expect(test.completeCommands).toEqual([]);
    expect(test.failureCommands).toEqual([]);
    expect(test.auditCommands).toEqual([]);
  });

  it('does not start a paid tool call after the run tool-call budget is exhausted', async () => {
    const test = harness({
      claimed: claim({
        budgets: {
          wallTimeBudgetMs: 180_000,
          toolCallBudget: 1,
          tokenBudget: 24_000,
          estimatedCostBudgetUsd: 0.5,
        },
        usage: { toolCalls: 1, tokens: 0, estimatedCostUsd: 0 },
      }),
    });

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.buildGroundedPlan).not.toHaveBeenCalled();
    expect(test.completeCommands).toEqual([]);
    expect(test.failureCommands).toEqual([
      expect.objectContaining({
        failureCode: 'AGENT_BUDGET_EXCEEDED',
        usage: { toolCalls: 0, tokens: 0, estimatedCostUsd: 0 },
      }),
    ]);
    expect(test.auditCommands).toEqual([
      expect.objectContaining({
        outcome: 'budget_exhausted',
      }),
    ]);
  });

  it('does not start the tool call when the atomic run-budget reservation is rejected', async () => {
    const test = harness({
      reservationResult: { status: 'budget_exhausted' },
    });

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.reserveCommands).toEqual([
      expect.objectContaining({
        runId: '11111111-1111-4111-8111-111111111111',
        attemptId: '22222222-2222-4222-8222-222222222222',
        leaseToken: '33333333-3333-4333-8333-333333333333',
        expectedVersion: 2,
        usage: {
          toolCalls: 1,
          tokens: 24_000,
          estimatedCostUsd: 0.5,
        },
      }),
    ]);
    expect(test.buildGroundedPlan).not.toHaveBeenCalled();
    expect(test.completeCommands).toEqual([]);
    expect(test.failureCommands).toEqual([
      expect.objectContaining({
        failureCode: 'AGENT_BUDGET_EXCEEDED',
        usage: { toolCalls: 0, tokens: 0, estimatedCostUsd: 0 },
      }),
    ]);
  });

  it('leaves a shared attempt untouched when another processor owns its reservation', async () => {
    const test = harness({
      reservationResult: { status: 'reservation_conflict' },
    });

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.buildGroundedPlan).not.toHaveBeenCalled();
    expect(test.completeCommands).toEqual([]);
    expect(test.failureCommands).toEqual([]);
    expect(test.auditCommands).toEqual([]);
  });

  it('fails safely when reported tool usage exceeds the reservation', async () => {
    const response = recommendation([1, 2, 3]);
    response.usage.totalTokens = 24_001;
    response.usage.estimatedCostUsd = 0.51;
    const test = harness({ response });

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.completeCommands).toEqual([]);
    expect(test.failureCommands).toEqual([
      expect.objectContaining({
        failureCode: 'AGENT_USAGE_EXCEEDED_RESERVATION',
        usage: {
          toolCalls: 1,
          tokens: 24_000,
          estimatedCostUsd: 0.5,
        },
      }),
    ]);
  });

  it('completes a run with three verified and cited post snapshots', async () => {
    const test = harness({ response: recommendation([1, 2, 3]) });

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.buildGroundedPlan).toHaveBeenCalledWith(claim(), {
      objective: OBJECTIVE,
      requestedStepCount: 3,
    });
    expect(test.failureCommands).toEqual([]);
    expect(test.completeCommands).toHaveLength(1);
    expect(test.completeCommands[0]).toMatchObject({
      runId: '11111111-1111-4111-8111-111111111111',
      attemptId: '22222222-2222-4222-8222-222222222222',
      leaseToken: '33333333-3333-4333-8333-333333333333',
      expectedVersion: 2,
      usage: { toolCalls: 1, tokens: 321, estimatedCostUsd: 0.012 },
      proposedSteps: [
        {
          position: 1,
          title: 'Lesson 1',
          videoUrl: `${YOUTUBE_URL}-1`,
          thumbnailUrl: 'https://i.ytimg.com/vi/source-1/hqdefault.jpg',
          channelName: 'Channel 1',
          sourcePostId: 1,
          evidenceTimestampSeconds: 10,
          evidenceConfidence: 0.9,
          status: 'ready',
          durationSeconds: 30,
        },
        {
          position: 2,
          title: 'Lesson 2',
          sourcePostId: 2,
          evidenceTimestampSeconds: 30,
          durationSeconds: 45,
        },
        {
          position: 3,
          title: 'Lesson 3',
          sourcePostId: 3,
          evidenceTimestampSeconds: 50,
          durationSeconds: 45,
        },
      ],
    });
    expect(test.auditCommands).toEqual([]);
  });

  it('fails with a typed error when fewer than the requested grounded posts remain', async () => {
    const response = recommendation([1, 2]);
    response.sources.push({
      ...response.sources[0],
      sourceKind: 'course_step',
      sourceId: '99',
    });
    const test = harness({ response });

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.completeCommands).toEqual([]);
    expect(test.failureCommands).toEqual([
      expect.objectContaining({
        failureCode: 'INVALID_RETRIEVAL_RESPONSE',
        failureMessage: 'The grounded retrieval response was invalid.',
        usage: { toolCalls: 1, tokens: 321, estimatedCostUsd: 0.012 },
      }),
    ]);
    expect(test.auditCommands).toEqual([
      expect.objectContaining({
        outcome: 'invalid_schema',
        output: {
          sourceCount: 0,
          groundedStepCount: 0,
          outcome: 'invalid_schema',
        },
      }),
    ]);
  });

  it('preserves returned usage when post verification fails', async () => {
    const test = harness();
    test.buildGroundedPlan.mockRejectedValueOnce(new Error('MCP unavailable'));

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.failureCommands).toEqual([
      expect.objectContaining({
        failureCode: 'AGENT_RETRIEVAL_FAILED',
        failureMessage: 'The grounded retrieval request failed.',
      }),
    ]);
    expect(test.auditCommands).toEqual([
      expect.objectContaining({
        outcome: 'failed',
        output: {
          sourceCount: 0,
          groundedStepCount: 0,
          outcome: 'failed',
        },
      }),
    ]);
  });

  it('treats a lost completion lease as a normal cancellation race', async () => {
    const test = harness({ completeResult: false });

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.completeCommands).toHaveLength(1);
    expect(test.failureCommands).toEqual([]);
  });

  it('does not overlap claims while an earlier cycle is still running', async () => {
    let resolveRecommendation!: (value: unknown) => void;
    const pendingRecommendation = new Promise((resolve) => {
      resolveRecommendation = resolve;
    });
    const test = harness();
    test.buildGroundedPlan.mockReturnValueOnce(pendingRecommendation);

    const first = test.processor.processOnce();
    await Promise.resolve();

    await expect(test.processor.processOnce()).resolves.toBe(false);
    expect(test.claimCalls()).toBe(1);

    resolveRecommendation(recommendation([1, 2, 3]));
    await expect(first).resolves.toBe(true);
  });

  it('keeps the full reservation charged when a paid tool call times out without usage', async () => {
    jest.useFakeTimers();
    const test = harness({ options: { processTimeoutMs: 10 } });
    test.buildGroundedPlan.mockReturnValueOnce(new Promise(() => undefined));
    try {
      const processing = test.processor.processOnce();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(10);

      await expect(processing).resolves.toBe(true);
      expect(test.failureCommands).toEqual([
        expect.objectContaining({
          failureCode: 'AGENT_RUN_TIMEOUT',
          usage: {
            toolCalls: 1,
            tokens: 24_000,
            estimatedCostUsd: 0.5,
          },
        }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps an existing attempt reservation charged after a lease is reclaimed', async () => {
    const reservedUsage = {
      toolCalls: 1,
      tokens: 24_000,
      estimatedCostUsd: 0.5,
    };
    const reclaimed = claim({
      usage: reservedUsage,
      attempts: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          attemptNumber: 1,
          state: 'running',
          queuedAt: '2026-07-29T00:00:00.000Z',
          startedAt: '2026-07-29T00:00:01.000Z',
          finishedAt: null,
          failureCode: null,
          failureMessage: null,
          usage: reservedUsage,
        },
      ],
    });
    const test = harness({ claimed: reclaimed });

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.buildGroundedPlan).not.toHaveBeenCalled();
    expect(test.reserveCommands).toEqual([]);
    expect(test.failureCommands).toEqual([
      expect.objectContaining({
        failureCode: 'AGENT_RUN_RESERVATION_RECOVERED',
        usage: reservedUsage,
      }),
    ]);
  });

  it('stops scheduling new polls during shutdown', async () => {
    jest.useFakeTimers();
    const test = harness({ claimed: null, options: { pollIntervalMs: 50 } });
    try {
      test.processor.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(test.claimCalls()).toBe(1);

      await test.processor.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(test.claimCalls()).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
