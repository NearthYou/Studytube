import type { WorkAttemptContext, WorkQueueJob } from './work.queue';
import type { LearningService } from '../learning/learning.service';
import { WorkJobTerminalError } from './work.errors';

type DurableHandler = {
  handle(
    job: WorkQueueJob,
    attempt?: WorkAttemptContext,
  ): Promise<Record<string, unknown>>;
};

export class DurableWorkRouter {
  constructor(
    private readonly videoAssets: DurableHandler,
    private readonly retrieval: DurableHandler,
    private readonly unsupported: DurableHandler,
    private readonly quiz?: DurableHandler,
    private readonly learning?: Pick<LearningService, 'settleAgentWorkItem'>,
    private readonly summary?: DurableHandler,
  ) {}

  async handle(
    job: WorkQueueJob,
    attempt?: WorkAttemptContext,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.handler(job).handle(job, attempt);
      await this.settleLearningWork(job, 'completed');
      return result;
    } catch (error) {
      if (error instanceof WorkJobTerminalError) {
        await this.settleLearningWork(job, 'failed', error.code);
      }
      throw error;
    }
  }

  private handler(job: WorkQueueJob): DurableHandler {
    if (
      job.eventType === 'video_asset.requested' ||
      job.eventType === 'learning_intake.requested'
    ) {
      return this.videoAssets;
    }
    if (job.eventType === 'retrieval_embedding.requested') {
      return this.retrieval;
    }
    if (job.eventType === 'quiz_generation.requested' && this.quiz) {
      return this.quiz;
    }
    if (job.eventType === 'learning_summary.requested' && this.summary) {
      return this.summary;
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
