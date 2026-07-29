import type { StudyPost } from '../study-board.types';
import type { VideoAsset } from '../video-asset.types';
import type { JobResult } from './work.types';
import type { WorkQueueJob } from './work.queue';
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
  payload: { postId: POST.id },
};

class MemoryResults {
  result: JobResult | null = null;
  deadLetter: Record<string, unknown> | null = null;

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

type HandlerContract = {
  handle(job: WorkQueueJob): Promise<Record<string, unknown>>;
  recordExhaustedFailure(
    job: WorkQueueJob,
    error: Error,
    attemptsMade: number,
  ): Promise<void>;
};

describe('VideoAssetJobHandler', () => {
  it('persists one result and skips the side effect on duplicate delivery', async () => {
    const results = new MemoryResults();
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
    );

    await expect(
      (handler as unknown as HandlerContract).handle(JOB),
    ).resolves.toEqual({ assetId: 9, postId: 42, status: 'ready' });
    await expect(
      (handler as unknown as HandlerContract).handle(JOB),
    ).resolves.toEqual({ assetId: 9, postId: 42, status: 'ready' });

    expect(preparations).toBe(1);
  });

  it('records a terminal typed failure for an unsupported payload schema', async () => {
    const results = new MemoryResults();
    const handler = new VideoAssetJobHandler(
      { findPost: () => Promise.resolve(POST) },
      { preparePostAsset: () => Promise.resolve(ASSET) },
      results,
    );

    await expect(
      (handler as unknown as HandlerContract).handle({
        ...JOB,
        payloadSchemaVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAYLOAD_SCHEMA' });

    expect(results.result).toMatchObject({
      outcome: 'terminal_failure',
      result: { code: 'UNSUPPORTED_PAYLOAD_SCHEMA' },
    });
    expect(results.deadLetter).toMatchObject({
      eventId: JOB.eventId,
      handlerVersion: JOB.handlerVersion,
      code: 'UNSUPPORTED_PAYLOAD_SCHEMA',
    });

    await expect(
      (handler as unknown as HandlerContract).handle({
        ...JOB,
        payloadSchemaVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAYLOAD_SCHEMA' });
  });

  it('leaves transient provider failures unrecorded so BullMQ can retry', async () => {
    const results = new MemoryResults();
    const providerFailure = new Error('caption provider timeout');
    const handler = new VideoAssetJobHandler(
      { findPost: () => Promise.resolve(POST) },
      { preparePostAsset: () => Promise.reject(providerFailure) },
      results,
    );

    await expect(
      (handler as unknown as HandlerContract).handle(JOB),
    ).rejects.toBe(providerFailure);
    expect(results.result).toBeNull();
  });

  it('persists an exhausted transient failure for audit and replay', async () => {
    const results = new MemoryResults();
    const handler = new VideoAssetJobHandler(
      { findPost: () => Promise.resolve(POST) },
      { preparePostAsset: () => Promise.resolve(ASSET) },
      results,
    );

    await (handler as unknown as HandlerContract).recordExhaustedFailure(
      JOB,
      new Error('caption provider timeout'),
      8,
    );

    expect(results.deadLetter).toMatchObject({
      eventId: JOB.eventId,
      code: 'JOB_ATTEMPTS_EXHAUSTED',
      details: { attemptsMade: 8 },
    });
    expect(results.result).toMatchObject({
      outcome: 'terminal_failure',
      result: { code: 'JOB_ATTEMPTS_EXHAUSTED', attemptsMade: 8 },
    });
  });
});
