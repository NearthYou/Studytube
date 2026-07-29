import { randomUUID } from 'node:crypto';
import type { BoardRepository, StudyPost } from '../study-board.types';
import type { VideoAsset } from '../video-asset.types';
import type { WorkRepository } from './work.repository';
import type { WorkQueueJob } from './work.queue';
import { deterministicWorkUuid } from './deterministic-work-id';

type PostReader = Pick<BoardRepository, 'findPost'>;
type VideoAssetPreparer = {
  preparePostAsset(post: StudyPost): Promise<VideoAsset | null>;
};
type JobResultStore = Pick<
  WorkRepository,
  'appendOutboxEvent' | 'findJobResult' | 'recordJobResult' | 'recordDeadLetter'
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
    const courseStepId = this.positiveIntegerString(job.payload.courseStepId);
    if (!postId || (job.payload.courseStepId !== undefined && !courseStepId)) {
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
    await this.results.appendOutboxEvent({
      id: deterministicWorkUuid(job.eventId, 'retrieval_embedding.requested'),
      eventType: 'retrieval_embedding.requested',
      aggregateType: 'post',
      aggregateId: String(post.id),
      aggregateVersion: 1,
      payloadSchemaVersion: 1,
      payload: { postId: post.id, causeEventId: job.eventId },
    });
    if (courseStepId) {
      await this.results.appendOutboxEvent({
        id: deterministicWorkUuid(
          job.eventId,
          `retrieval_embedding.course_step.${courseStepId}`,
        ),
        eventType: 'retrieval_embedding.requested',
        aggregateType: 'course_step',
        aggregateId: courseStepId,
        aggregateVersion: 1,
        payloadSchemaVersion: 1,
        payload: {
          sourceKind: 'course_step',
          sourceId: courseStepId,
          courseStepId,
          causeEventId: job.eventId,
        },
      });
    }
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

  private positiveIntegerString(value: unknown): string | null {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    }
    return typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)
      ? value
      : null;
  }
}

export class WorkJobTerminalError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
