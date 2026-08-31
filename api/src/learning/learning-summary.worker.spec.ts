import { DurableJobExecutor } from '../work/durable-job.executor';
import { MemoryJobExecutionStore } from '../work/memory-job-execution.store';
import type { WorkQueueJob } from '../work/work.queue';
import type {
  LearningOverviewGeneration,
  LearningOverviewRepository,
} from './learning-overview.repository';
import {
  LearningSummaryJobHandler,
  type LearningOverviewGenerator,
} from './learning-summary.worker';

const JOB: WorkQueueJob = {
  eventId: '33333333-3333-4333-8333-333333333333',
  ownerId: 7,
  eventType: 'learning_summary.requested',
  handlerVersion: 'learning-summary-v1',
  payloadSchemaVersion: 1,
  payload: { summaryId: '9' },
};

function generation(): LearningOverviewGeneration {
  return {
    summaryId: '9',
    contextId: '8',
    status: 'pending',
    videoId: 'abcdefghijk',
    captionArtifactId: '42',
    captionGeneration: 3,
    coverage: { scope: 'full_video', startSeconds: 0, endSeconds: 60 },
    segments: [
      { start: 0, end: 20, text: 'First chapter' },
      { start: 20, end: 40, text: 'Second chapter' },
      { start: 40, end: 60, text: 'Third chapter' },
    ],
  };
}

function generatedSummary() {
  return {
    status: 'ready',
    summary: {
      overview:
        '이 영상은 작은 습관을 시작하고 반복한 뒤 다시 이어가는 방법을 차례로 설명합니다.',
      chapters: [
        {
          startSeconds: 0,
          endSeconds: 20,
          title: '시작',
          body: '작게 시작합니다.',
        },
        {
          startSeconds: 20,
          endSeconds: 40,
          title: '반복',
          body: '반복을 만듭니다.',
        },
        {
          startSeconds: 40,
          endSeconds: 60,
          title: '복귀',
          body: '다시 이어갑니다.',
        },
      ],
      takeaways: ['작게 시작한다', '다시 이어가기 쉽게 만든다'],
    },
  };
}

describe('LearningSummaryJobHandler', () => {
  it('does not summarize only the opening study range', async () => {
    const partial = generation();
    partial.coverage = {
      scope: 'study_range',
      startSeconds: 0,
      endSeconds: 60,
    };
    const failGeneration = jest.fn().mockResolvedValue(true);
    const generate = jest.fn();
    const execution = jobExecution();
    const handler = handlerWith(
      {
        loadGeneration: jest.fn().mockResolvedValue(partial),
        failGeneration,
      },
      { generate },
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'LEARNING_SUMMARY_FULL_VIDEO_REQUIRED',
    });
    expect(generate).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith(
      '9',
      'LEARNING_SUMMARY_FULL_VIDEO_REQUIRED',
    );
  });

  it('stores a validated overview for the pinned caption range', async () => {
    const loadGeneration = jest.fn().mockResolvedValue(generation());
    const completeGeneration = jest.fn().mockResolvedValue(true);
    const generate = jest.fn().mockResolvedValue(generatedSummary());
    const execution = jobExecution();
    const handler = handlerWith(
      { loadGeneration, completeGeneration },
      { generate },
      execution.executor,
    );

    await expect(handler.handle(JOB)).resolves.toEqual({
      summaryId: '9',
      state: 'ready',
      chapterCount: 3,
    });
    expect(generate).toHaveBeenCalledWith(
      generation(),
      expect.any(AbortSignal),
    );
    expect(completeGeneration).toHaveBeenCalledWith(
      '9',
      generatedSummary().summary,
    );
  });

  it('rejects chapter timestamps outside the pinned range', async () => {
    const invalid = generatedSummary();
    invalid.summary.chapters[2].endSeconds = 61;
    const failGeneration = jest.fn().mockResolvedValue(true);
    const execution = jobExecution();
    const handler = handlerWith(
      {
        loadGeneration: jest.fn().mockResolvedValue(generation()),
        failGeneration,
      },
      { generate: jest.fn().mockResolvedValue(invalid) },
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'INVALID_LEARNING_SUMMARY_RESPONSE',
    });
    expect(failGeneration).toHaveBeenCalledWith(
      '9',
      'INVALID_LEARNING_SUMMARY_RESPONSE',
    );
  });

  it('rejects an overview whose chapters cover only the opening', async () => {
    const openingOnly = generatedSummary();
    openingOnly.summary.chapters = [
      { startSeconds: 0, endSeconds: 10, title: '시작', body: '시작 내용' },
      { startSeconds: 10, endSeconds: 20, title: '초반', body: '초반 내용' },
      { startSeconds: 20, endSeconds: 30, title: '도입', body: '도입 내용' },
    ];
    const failGeneration = jest.fn().mockResolvedValue(true);
    const completeGeneration = jest.fn().mockResolvedValue(true);
    const execution = jobExecution();
    const handler = handlerWith(
      {
        loadGeneration: jest.fn().mockResolvedValue(generation()),
        failGeneration,
        completeGeneration,
      },
      { generate: jest.fn().mockResolvedValue(openingOnly) },
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'INVALID_LEARNING_SUMMARY_RESPONSE',
    });
    expect(failGeneration).toHaveBeenCalledWith(
      '9',
      'INVALID_LEARNING_SUMMARY_RESPONSE',
    );
  });

  it('rejects an overview that skips the middle of the video', async () => {
    const missingMiddle = generatedSummary();
    missingMiddle.summary.chapters = [
      { startSeconds: 0, endSeconds: 5, title: '시작', body: '시작 내용' },
      { startSeconds: 5, endSeconds: 10, title: '도입', body: '도입 내용' },
      {
        startSeconds: 55,
        endSeconds: 60,
        title: '마무리',
        body: '마무리 내용',
      },
    ];
    const failGeneration = jest.fn().mockResolvedValue(true);
    const completeGeneration = jest.fn().mockResolvedValue(true);
    const execution = jobExecution();
    const handler = handlerWith(
      {
        loadGeneration: jest.fn().mockResolvedValue(generation()),
        failGeneration,
        completeGeneration,
      },
      { generate: jest.fn().mockResolvedValue(missingMiddle) },
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'INVALID_LEARNING_SUMMARY_RESPONSE',
    });
    expect(failGeneration).toHaveBeenCalledWith(
      '9',
      'INVALID_LEARNING_SUMMARY_RESPONSE',
    );
  });

  it('stores only a safe code when transient attempts are exhausted', async () => {
    const rawFailure =
      'Bearer summary-secret-canary https://user:secret@example.invalid/?token=hidden';
    const failGeneration = jest.fn().mockResolvedValue(true);
    const execution = jobExecution();
    const handler = handlerWith(
      {
        loadGeneration: jest.fn().mockResolvedValue(generation()),
        failGeneration,
      },
      { generate: jest.fn().mockRejectedValue(new Error(rawFailure)) },
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toThrow(rawFailure);
    expect(failGeneration).not.toHaveBeenCalled();
    await expect(
      handler.handle(JOB, {
        attemptNumber: 8,
        maxAttempts: 8,
        isFinalAttempt: true,
      }),
    ).rejects.toMatchObject({ code: 'LEARNING_SUMMARY_ATTEMPTS_EXHAUSTED' });
    expect(failGeneration).toHaveBeenCalledWith(
      '9',
      'LEARNING_SUMMARY_ATTEMPTS_EXHAUSTED',
    );
    expect(
      JSON.stringify({
        result: execution.store.findResult(JOB),
        deadLetter: execution.store.findDeadLetter(JOB),
      }),
    ).not.toContain('summary-secret-canary');
  });
});

function handlerWith(
  repository: Partial<LearningOverviewRepository>,
  generator: Pick<LearningOverviewGenerator, 'generate'>,
  executor: DurableJobExecutor,
) {
  return new LearningSummaryJobHandler(
    repository as LearningOverviewRepository,
    generator,
    executor,
  );
}

function jobExecution() {
  const store = new MemoryJobExecutionStore();
  return {
    store,
    executor: new DurableJobExecutor(store, {
      leaseOwner: 'learning-summary-worker',
      leaseMs: 30_000,
    }),
  };
}
