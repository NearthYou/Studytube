import type { StudyPost } from '../study-board.types';
import type { VideoAsset } from '../video-asset.types';
import { DurableJobExecutor } from './durable-job.executor';
import { MemoryJobExecutionStore } from './memory-job-execution.store';
import type { AppendOutboxEvent, JobResult } from './work.types';
import type { WorkQueueJob } from './work.queue';
import { WorkJobBusyError } from './work.errors';
import { VideoAssetJobHandler } from './video-asset.worker';

const POST: StudyPost = {
  id: 42,
  authorId: 7,
  authorName: 'Learner',
  title: 'Durable lesson',
  videoUrl: 'https://youtu.be/durableLesson',
  thumbnailUrl: '',
  channelName: 'StudyTube',
  summary: 'Summary',
  translatedNotes: 'Notes',
  tags: ['queue'],
  comments: [],
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

const ASSET: VideoAsset = {
  id: 9,
  postId: POST.id,
  videoId: 'durableLesson',
  videoUrl: POST.videoUrl,
  language: 'ko',
  sourceLanguage: 'en',
  status: 'ready',
  sourceCaptionStatus: 'ready',
  translationStatus: 'ready',
  summaryStatus: 'ready',
  sourceSegments: [],
  translatedSegments: [],
  summarySections: [],
  transcriptBody: 'ready',
  errorMessage: '',
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

const JOB: WorkQueueJob = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'video_asset.requested',
  handlerVersion: 'video-asset-v1',
  payloadSchemaVersion: 1,
  payload: { postId: POST.id, courseStepId: '24' },
};

class MemoryResults {
  result: JobResult | null = null;
  deadLetter: Record<string, unknown> | null = null;
  appendedEvents: AppendOutboxEvent[] = [];

  appendOutboxEvent(event: AppendOutboxEvent): Promise<void> {
    if (!this.appendedEvents.some((existing) => existing.id === event.id)) {
      this.appendedEvents.push(event);
    }
    return Promise.resolve();
  }

  findJobResult(): Promise<JobResult | null> {
    return Promise.resolve(this.result);
  }

  recordJobResult(result: JobResult): Promise<boolean> {
    if (this.result) {
      return Promise.resolve(false);
    }
    this.result = result;
    return Promise.resolve(true);
  }

  recordDeadLetter(input: Record<string, unknown>): Promise<boolean> {
    if (this.deadLetter) {
      return Promise.resolve(false);
    }
    this.deadLetter = input;
    return Promise.resolve(true);
  }
}

describe('VideoAssetJobHandler', () => {
  it('runs one provider call for concurrent delivery and replays the completed result', async () => {
    const results = new MemoryResults();
    const store = new MemoryJobExecutionStore();
    const executor = new DurableJobExecutor(store, {
      leaseOwner: 'video-worker',
      leaseMs: 30_000,
    });
    let finish: ((asset: VideoAsset) => void) | undefined;
    const preparePostAsset = jest.fn(
      () =>
        new Promise<VideoAsset>((resolve) => {
          finish = resolve;
        }),
    );
    const handler = new VideoAssetJobHandler(
      { findPost: () => Promise.resolve(POST) },
      { preparePostAsset },
      results,
      executor,
    );

    const active = handler.handle(JOB);
    await expect(handler.handle(JOB)).rejects.toBeInstanceOf(WorkJobBusyError);
    finish?.(ASSET);
    await expect(active).resolves.toEqual({
      assetId: 9,
      postId: 42,
      status: 'ready',
    });
    await expect(handler.handle(JOB)).resolves.toEqual({
      assetId: 9,
      postId: 42,
      status: 'ready',
    });

    expect(preparePostAsset).toHaveBeenCalledTimes(1);
  });

  it('persists one result and skips the side effect on duplicate delivery', async () => {
    const results = new MemoryResults();
    const execution = jobExecution();
    let preparations = 0;
    const handler = new VideoAssetJobHandler(
      { findPost: () => Promise.resolve(POST) },
      {
        preparePostAsset: () => {
          preparations += 1;
          return Promise.resolve(ASSET);
        },
      },
      results,
      execution.executor,
    );

    await expect(handler.handle(JOB)).resolves.toEqual({
      assetId: 9,
      postId: 42,
      status: 'ready',
    });
    await expect(handler.handle(JOB)).resolves.toEqual({
      assetId: 9,
      postId: 42,
      status: 'ready',
    });

    expect(preparations).toBe(1);
    expect(results.appendedEvents).toHaveLength(2);
    expect(results.appendedEvents[0]).toMatchObject({
      eventType: 'retrieval_embedding.requested',
      aggregateId: '42',
      payload: { postId: 42 },
    });
    expect(results.appendedEvents[1]).toMatchObject({
      eventType: 'retrieval_embedding.requested',
      aggregateType: 'course_step',
      aggregateId: '24',
      payload: {
        sourceKind: 'course_step',
        sourceId: '24',
        courseStepId: '24',
      },
    });
  });

  it('records a terminal typed failure for an unsupported payload schema', async () => {
    const results = new MemoryResults();
    const execution = jobExecution();
    const handler = new VideoAssetJobHandler(
      { findPost: () => Promise.resolve(POST) },
      { preparePostAsset: () => Promise.resolve(ASSET) },
      results,
      execution.executor,
    );

    await expect(
      handler.handle({
        ...JOB,
        payloadSchemaVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAYLOAD_SCHEMA' });

    expect(execution.store.findResult(JOB)).toMatchObject({
      outcome: 'terminal_failure',
      result: { code: 'UNSUPPORTED_PAYLOAD_SCHEMA' },
    });
    expect(execution.store.findDeadLetter(JOB)).toMatchObject({
      code: 'UNSUPPORTED_PAYLOAD_SCHEMA',
    });

    await expect(
      handler.handle({
        ...JOB,
        payloadSchemaVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAYLOAD_SCHEMA' });
  });

  it('leaves transient provider failures unrecorded so BullMQ can retry', async () => {
    const results = new MemoryResults();
    const execution = jobExecution();
    const providerFailure = new Error('caption provider timeout');
    const preparePostAsset = jest
      .fn()
      .mockRejectedValueOnce(providerFailure)
      .mockResolvedValue(ASSET);
    const handler = new VideoAssetJobHandler(
      { findPost: () => Promise.resolve(POST) },
      { preparePostAsset },
      results,
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toBe(providerFailure);
    expect(execution.store.findResult(JOB)).toBeNull();
    await expect(handler.handle(JOB)).resolves.toMatchObject({
      assetId: ASSET.id,
    });
    expect(preparePostAsset).toHaveBeenCalledTimes(2);
  });

  it('persists an exhausted transient failure for audit and replay', async () => {
    const results = new MemoryResults();
    const execution = jobExecution();
    const rawFailure =
      'Bearer video-secret-canary https://worker:video-url-secret@example.invalid/captions?token=video-query-secret';
    const preparePostAsset = jest.fn().mockRejectedValue(new Error(rawFailure));
    const handler = new VideoAssetJobHandler(
      { findPost: () => Promise.resolve(POST) },
      { preparePostAsset },
      results,
      execution.executor,
    );

    await expect(
      handler.handle(JOB, {
        attemptNumber: 8,
        maxAttempts: 8,
        isFinalAttempt: true,
      }),
    ).rejects.toMatchObject({
      code: 'JOB_ATTEMPTS_EXHAUSTED',
      message: 'JOB_ATTEMPTS_EXHAUSTED',
    });

    expect(execution.store.findDeadLetter(JOB)).toMatchObject({
      code: 'JOB_ATTEMPTS_EXHAUSTED',
      details: { attemptsMade: 8 },
    });
    expect(execution.store.findResult(JOB)).toMatchObject({
      outcome: 'terminal_failure',
      result: { code: 'JOB_ATTEMPTS_EXHAUSTED', attemptsMade: 8 },
    });
    const persisted = JSON.stringify({
      result: execution.store.findResult(JOB),
      deadLetter: execution.store.findDeadLetter(JOB),
    });
    expect(persisted).not.toContain('video-secret-canary');
    expect(persisted).not.toContain('video-url-secret');
    expect(persisted).not.toContain('video-query-secret');

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'JOB_ATTEMPTS_EXHAUSTED',
    });
    expect(preparePostAsset).toHaveBeenCalledTimes(1);
  });
});

function jobExecution(): {
  store: MemoryJobExecutionStore;
  executor: DurableJobExecutor;
} {
  const store = new MemoryJobExecutionStore();
  return {
    store,
    executor: new DurableJobExecutor(store, {
      leaseOwner: 'video-worker',
      leaseMs: 30_000,
    }),
  };
}
