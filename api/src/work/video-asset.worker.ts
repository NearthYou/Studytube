import { randomUUID } from 'node:crypto';
import type { BoardRepository, StudyPost } from '../study-board.types';
import type { VideoAsset } from '../video-asset.types';
import type { WorkRepository } from './work.repository';
import type { WorkQueueJob } from './work.queue';

type PostReader = Pick<BoardRepository, 'findPost'>;
type VideoAssetPreparer = {
  preparePostAsset(post: StudyPost): Promise<VideoAsset | null>;
};
type JobResultStore = Pick<
  WorkRepository,
  'findJobResult' | 'recordJobResult' | 'recordDeadLetter'
>;

export class VideoAssetJobHandler {
  constructor(
    private readonly posts: PostReader,
    private readonly videoAssets: VideoAssetPreparer,
    private readonly results: JobResultStore,
  ) {}

  async handle(job: WorkQueueJob): Promise<Record<string, unknown>> {
    const existing = await this.results.findJobResult(
      job.eventId,
      job.handlerVersion,
    );
    if (existing) {
      if (existing.outcome === 'terminal_failure') {
        throw new WorkJobTerminalError(
          typeof existing.result.code === 'string'
            ? existing.result.code
            : 'TERMINAL_FAILURE',
        );
      }
      return existing.result;
    }

    if (job.eventType !== 'video_asset.requested') {
      return this.terminal(job, 'UNSUPPORTED_EVENT_TYPE');
    }
    if (job.payloadSchemaVersion !== 1) {
      return this.terminal(job, 'UNSUPPORTED_PAYLOAD_SCHEMA');
    }

    const postId = this.positiveInteger(job.payload.postId);
    if (!postId) {
      return this.terminal(job, 'INVALID_VIDEO_ASSET_PAYLOAD');
    }
    const post = await this.posts.findPost(postId);
    if (!post) {
      return this.terminal(job, 'POST_NOT_FOUND');
    }

    const asset = await this.videoAssets.preparePostAsset(post);
    if (!asset) {
      return this.terminal(job, 'VIDEO_ASSET_UNSUPPORTED');
    }

    const result = {
      assetId: asset.id,
      postId: asset.postId,
      status: asset.status,
    };
    await this.results.recordJobResult({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      outcome: 'succeeded',
      result,
    });
    return result;
  }

  async recordExhaustedFailure(
    job: WorkQueueJob,
    error: Error,
    attemptsMade: number,
  ): Promise<void> {
    if (await this.results.findJobResult(job.eventId, job.handlerVersion)) {
      return;
    }

    const code = 'JOB_ATTEMPTS_EXHAUSTED';
    await this.results.recordDeadLetter({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      code,
      message: error.message,
      details: { attemptsMade },
    });
    await this.results.recordJobResult({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      outcome: 'terminal_failure',
      result: { code, attemptsMade },
    });
  }

  private async terminal(job: WorkQueueJob, code: string): Promise<never> {
    await this.results.recordDeadLetter({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      code,
      message: code,
      details: {
        eventType: job.eventType,
        payloadSchemaVersion: job.payloadSchemaVersion,
      },
    });
    await this.results.recordJobResult({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      outcome: 'terminal_failure',
      result: { code },
    });
    throw new WorkJobTerminalError(code);
  }

  private positiveInteger(value: unknown): number | null {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }
}

export class WorkJobTerminalError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
