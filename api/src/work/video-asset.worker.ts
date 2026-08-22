import type { BoardRepository, StudyPost } from '../study-board.types';
import type { VideoAsset } from '../video-asset.types';
import type {
  CaptionPipelineRequest,
  CaptionSafeErrorCode,
  LearningCaptionResult,
} from '../video-asset.types';
import { CaptionTranslationPendingError } from '../video-asset.service';
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
  prepareLearningCaptions?(
    request: CaptionPipelineRequest,
    signal?: AbortSignal,
  ): Promise<LearningCaptionResult>;
  failLearningCaptions?(
    request: CaptionPipelineRequest,
    errorCode: CaptionSafeErrorCode,
  ): Promise<LearningCaptionResult>;
};
type FollowUpEventStore = Pick<
  WorkRepository,
  'appendOutboxEvent' | 'listLearningRetrievalContexts'
>;

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
      (signal, lease) =>
        this.process(
          job,
          signal,
          lease.leaseToken,
          attempt?.isFinalAttempt === true,
        ),
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
    leaseToken: string,
    isFinalAttempt: boolean,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    if (job.eventType === 'learning_intake.requested') {
      return this.processLearningIntake(
        job,
        signal,
        leaseToken,
        isFinalAttempt,
      );
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

  private async processLearningIntake(
    job: WorkQueueJob,
    signal: AbortSignal,
    leaseToken: string,
    isFinalAttempt: boolean,
  ): Promise<Record<string, unknown>> {
    if (job.payloadSchemaVersion !== 1) {
      return this.terminal(job, 'UNSUPPORTED_PAYLOAD_SCHEMA');
    }
    const canonicalVideoId = this.canonicalVideoId(
      job.payload.canonicalVideoId,
    );
    const durationSeconds = this.processingDuration(
      job.payload.processingRangeKey,
    );
    const reservationId = this.positiveIntegerString(job.payload.reservationId);
    if (
      !canonicalVideoId ||
      !durationSeconds ||
      !reservationId ||
      !this.videoAssets.prepareLearningCaptions
    ) {
      return this.terminal(job, 'INVALID_LEARNING_INTAKE_PAYLOAD');
    }
    signal.throwIfAborted();
    const request: CaptionPipelineRequest = {
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      leaseToken,
      canonicalVideoId,
      targetLanguage: 'ko',
      durationSeconds,
    };
    let result: LearningCaptionResult;
    try {
      result = await this.videoAssets.prepareLearningCaptions(request, signal);
    } catch (error) {
      if (!(error instanceof CaptionTranslationPendingError)) throw error;
      if (!isFinalAttempt) throw error;
      if (!this.videoAssets.failLearningCaptions) throw error;
      result = await this.videoAssets.failLearningCaptions(
        request,
        'TRANSLATION_PROVIDER_UNAVAILABLE',
      );
    }
    signal.throwIfAborted();
    const captionArtifactId =
      result.translationArtifactId ?? result.sourceArtifactId;
    if (
      result.status === 'ready' &&
      captionArtifactId &&
      this.events.listLearningRetrievalContexts
    ) {
      const contexts = await this.events.listLearningRetrievalContexts({
        causeEventId: job.eventId,
        reservationId,
        captionArtifactId,
      });
      signal.throwIfAborted();
      for (const context of contexts) {
        await this.events.appendOutboxEvent({
          id: deterministicWorkUuid(
            job.eventId,
            `retrieval_embedding.learning_context.${context.studyContextId}.${context.sourceVersion}`,
          ),
          eventType: 'retrieval_embedding.requested',
          aggregateType: 'study_context',
          aggregateId: context.studyContextId,
          aggregateVersion: Number(context.sourceVersion),
          payloadSchemaVersion: 1,
          payload: {
            sourceKind: 'learning_context',
            sourceId: context.studyContextId,
            sourceVersion: context.sourceVersion,
            causeEventId: job.eventId,
            captionArtifactId,
          },
        });
        signal.throwIfAborted();
      }
    }
    return { ...result };
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

  private canonicalVideoId(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/u.test(value)
      ? value
      : null;
  }

  private processingDuration(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d+)-(\d+)$/u.exec(value);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start === 0 && Number.isSafeInteger(end) && end > 0 && end <= 14_400
      ? end
      : null;
  }
}

export { WorkJobTerminalError } from './work.errors';
