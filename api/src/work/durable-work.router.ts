import type { WorkQueueJob } from './work.queue';
import type { LearningService } from '../learning/learning.service';
import { WorkJobTerminalError } from './video-asset.worker';

type DurableHandler = {
  handle(job: WorkQueueJob): Promise<Record<string, unknown>>;
  recordExhaustedFailure?(
    job: WorkQueueJob,
    error: Error,
    attemptsMade: number,
  ): Promise<void>;
};

export class DurableWorkRouter {
  constructor(
    private readonly videoAssets: DurableHandler,
    private readonly retrieval: DurableHandler,
    private readonly unsupported: DurableHandler,
    private readonly quiz?: DurableHandler,
    private readonly learning?: Pick<LearningService, 'settleAgentWorkItem'>,
  ) {}

  async handle(job: WorkQueueJob): Promise<Record<string, unknown>> {
    try {
      const result = await this.handler(job).handle(job);
      await this.settleLearningWork(job, 'completed');
      return result;
    } catch (error) {
      if (error instanceof WorkJobTerminalError) {
        await this.settleLearningWork(job, 'failed', error.code);
      }
      throw error;
    }
  }

  async recordExhaustedFailure(
    job: WorkQueueJob,
    error: Error,
    attemptsMade: number,
  ): Promise<void> {
    await this.handler(job).recordExhaustedFailure?.(job, error, attemptsMade);
    await this.settleLearningWork(job, 'failed', 'WORK_ATTEMPTS_EXHAUSTED');
  }

  private handler(job: WorkQueueJob): DurableHandler {
    if (job.eventType === 'video_asset.requested') {
      return this.videoAssets;
    }
    if (job.eventType === 'retrieval_embedding.requested') {
      return this.retrieval;
    }
    if (job.eventType === 'quiz_generation.requested' && this.quiz) {
      return this.quiz;
    }
    return this.unsupported;
  }

  private async settleLearningWork(
    job: WorkQueueJob,
    outcome: 'completed' | 'failed',
    reasonCode?: string,
  ): Promise<void> {
    if (!this.learning) return;
    const courseStepId = canonicalPositiveInteger(job.payload.courseStepId);
    const kind = learningWorkKind(job.eventType);
    if (!courseStepId || !kind) return;
    await this.learning.settleAgentWorkItem({
      courseStepId,
      kind,
      outcome,
      ...(reasonCode ? { reasonCode } : {}),
    });
  }
}

function learningWorkKind(
  eventType: string,
): 'video_asset' | 'retrieval_embedding' | 'quiz_generation' | null {
  if (eventType === 'video_asset.requested') return 'video_asset';
  if (eventType === 'retrieval_embedding.requested') {
    return 'retrieval_embedding';
  }
  if (eventType === 'quiz_generation.requested') return 'quiz_generation';
  return null;
}

function canonicalPositiveInteger(value: unknown): string | null {
  const normalized = typeof value === 'number' ? String(value) : value;
  return typeof normalized === 'string' && /^[1-9][0-9]*$/u.test(normalized)
    ? normalized
    : null;
}
