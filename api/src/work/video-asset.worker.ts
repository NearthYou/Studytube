import type { BoardRepository, StudyPost } from '../study-board.types';
import type { VideoAsset } from '../video-asset.types';
import type { WorkRepository } from './work.repository';
import type { WorkAttemptContext, WorkQueueJob } from './work.queue';
import { deterministicWorkUuid } from './deterministic-work-id';
import { DurableJobExecutor } from './durable-job.executor';
import { WorkJobTerminalError } from './work.errors';

type PostReader = Pick<BoardRepository, 'findPost'>;
type VideoAssetPreparer = {
  preparePostAsset(
    post: StudyPost,
    signal?: AbortSignal,
  ): Promise<VideoAsset | null>;
};
type FollowUpEventStore = Pick<WorkRepository, 'appendOutboxEvent'>;

export class VideoAssetJobHandler {
  constructor(
    private readonly posts: PostReader,
    private readonly videoAssets: VideoAssetPreparer,
    private readonly events: FollowUpEventStore,
    private readonly executor: DurableJobExecutor,
  ) {}

  async handle(
    job: WorkQueueJob,
    attempt?: WorkAttemptContext,
  ): Promise<Record<string, unknown>> {
    return this.executor.execute(
      {
        eventId: job.eventId,
        handlerVersion: job.handlerVersion,
      },
      (signal) => this.process(job, signal),
      attempt?.isFinalAttempt
        ? {
            code: 'JOB_ATTEMPTS_EXHAUSTED',
            attemptsMade: attempt.attemptNumber,
          }
        : undefined,
    );
  }

  private async process(
    job: WorkQueueJob,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
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
    signal.throwIfAborted();
    if (!post) {
      return this.terminal(job, 'POST_NOT_FOUND');
    }

    const asset = await this.videoAssets.preparePostAsset(post, signal);
    signal.throwIfAborted();
    if (!asset) {
      return this.terminal(job, 'VIDEO_ASSET_UNSUPPORTED');
    }

    const result = {
      assetId: asset.id,
      postId: asset.postId,
      status: asset.status,
    };
    signal.throwIfAborted();
    await this.events.appendOutboxEvent({
      id: deterministicWorkUuid(job.eventId, 'retrieval_embedding.requested'),
      eventType: 'retrieval_embedding.requested',
      aggregateType: 'post',
      aggregateId: String(post.id),
      aggregateVersion: 1,
      payloadSchemaVersion: 1,
      payload: { postId: post.id, causeEventId: job.eventId },
    });
    if (courseStepId) {
      signal.throwIfAborted();
      await this.events.appendOutboxEvent({
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
    return result;
  }

  private terminal(job: WorkQueueJob, code: string): never {
    throw new WorkJobTerminalError(code, {
      details: {
        eventType: job.eventType,
        payloadSchemaVersion: job.payloadSchemaVersion,
      },
      result: { code },
    });
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

export { WorkJobTerminalError } from './work.errors';
