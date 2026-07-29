import type { ClaimAgentRun } from './learning.repository';
import type { LearningService } from './learning.service';
import type { BoardRepository, StudyPost } from '../study-board.types';
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
  const ai = {
    recommend: jest
      .fn()
      .mockResolvedValue(input?.response ?? recommendation([1, 2, 3])),
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
  const processor = new AgentRunProcessor(learning, ai, board, {
    workerId: 'agent-run-worker-test',
    leaseMs: 30_000,
    processTimeoutMs: 25_000,
    pollIntervalMs: 1_000,
    ...input?.options,
  });

  return {
    processor,
    ai,
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

    expect(test.ai.recommend).not.toHaveBeenCalled();
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

    expect(test.ai.recommend).not.toHaveBeenCalled();
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
    expect(test.ai.recommend).not.toHaveBeenCalled();
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

    expect(test.ai.recommend).not.toHaveBeenCalled();
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

    expect(test.ai.recommend).toHaveBeenCalledWith(
      { query: OBJECTIVE, limit: 6 },
      42,
    );
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
    expect(test.auditCommands).toHaveLength(1);
    expect(test.auditCommands[0]).toMatchObject({
      ownerId: 42,
      runId: '11111111-1111-4111-8111-111111111111',
      attemptId: '22222222-2222-4222-8222-222222222222',
      requestId: '22222222-2222-4222-8222-222222222222:recommend:1',
      toolName: 'retrieval.recommend',
      outcome: 'succeeded',
      input: { queryLength: OBJECTIVE.length, requestedStepCount: 3 },
      output: { sourceCount: 3, groundedStepCount: 3 },
    });
    expect(JSON.stringify(test.auditCommands[0])).not.toContain(OBJECTIVE);
    expect(JSON.stringify(test.auditCommands[0])).not.toContain(YOUTUBE_URL);
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
        failureCode: 'INSUFFICIENT_GROUNDED_SOURCES',
        failureMessage:
          'The retrieval result did not contain enough verified post citations.',
        usage: { toolCalls: 1, tokens: 321, estimatedCostUsd: 0.012 },
      }),
    ]);
    expect(test.auditCommands).toEqual([
      expect.objectContaining({
        outcome: 'invalid_schema',
        output: {
          failureCode: 'INSUFFICIENT_GROUNDED_SOURCES',
          sourceCount: 3,
          groundedStepCount: 2,
        },
      }),
    ]);
  });

  it('preserves returned usage when post verification fails', async () => {
    const test = harness();
    test.board.findPost = jest
      .fn()
      .mockRejectedValue(new Error('database unavailable'));

    await expect(test.processor.processOnce()).resolves.toBe(true);

    expect(test.failureCommands).toEqual([
      expect.objectContaining({
        failureCode: 'SOURCE_VERIFICATION_FAILED',
        failureMessage: 'The retrieved post sources could not be verified.',
        usage: { toolCalls: 1, tokens: 321, estimatedCostUsd: 0.012 },
      }),
    ]);
    expect(test.auditCommands).toEqual([
      expect.objectContaining({
        outcome: 'failed',
        output: {
          failureCode: 'SOURCE_VERIFICATION_FAILED',
          sourceCount: 3,
          groundedStepCount: 0,
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
    test.ai.recommend.mockReturnValueOnce(pendingRecommendation);

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
    test.ai.recommend.mockReturnValueOnce(new Promise(() => undefined));
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

    expect(test.ai.recommend).not.toHaveBeenCalled();
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
