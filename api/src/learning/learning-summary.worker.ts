import { AiProxyService } from '../ai-proxy.service';
import { DurableJobExecutor } from '../work/durable-job.executor';
import { WorkJobTerminalError } from '../work/work.errors';
import type { WorkAttemptContext, WorkQueueJob } from '../work/work.queue';
import type {
  LearningOverviewGeneration,
  LearningOverviewRepository,
  LearningOverviewSummary,
} from './learning-overview.repository';

export interface LearningOverviewGenerator {
  generate(
    snapshot: LearningOverviewGeneration,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class AiLearningOverviewGenerator implements LearningOverviewGenerator {
  constructor(private readonly ai: AiProxyService) {}

  generate(snapshot: LearningOverviewGeneration, signal: AbortSignal) {
    return this.ai.generateLearningOverview(
      {
        videoId: snapshot.videoId,
        language: 'ko',
        coverage: snapshot.coverage,
        segments: snapshot.segments,
      },
      signal,
    );
  }
}

export class LearningSummaryJobHandler {
  constructor(
    private readonly repository: LearningOverviewRepository,
    private readonly generator: LearningOverviewGenerator,
    private readonly executor: DurableJobExecutor,
  ) {}

  async handle(
    job: WorkQueueJob,
    attempt?: WorkAttemptContext,
  ): Promise<Record<string, unknown>> {
    const summaryId = learningSummaryId(job);
    try {
      return await this.executor.execute(
        { eventId: job.eventId, handlerVersion: job.handlerVersion },
        (signal) => this.process(job, signal),
        attempt?.isFinalAttempt
          ? {
              code: 'LEARNING_SUMMARY_ATTEMPTS_EXHAUSTED',
              attemptsMade: attempt.attemptNumber,
            }
          : undefined,
      );
    } catch (error) {
      if (attempt?.isFinalAttempt && summaryId) {
        await this.repository.failGeneration(
          summaryId,
          'LEARNING_SUMMARY_ATTEMPTS_EXHAUSTED',
        );
      }
      throw error;
    }
  }

  private async process(
    job: WorkQueueJob,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    if (
      job.eventType !== 'learning_summary.requested' ||
      job.payloadSchemaVersion !== 1
    ) {
      return this.terminal(job, 'UNSUPPORTED_LEARNING_SUMMARY_SCHEMA');
    }
    const summaryId = learningSummaryId(job);
    if (!summaryId)
      return this.terminal(job, 'INVALID_LEARNING_SUMMARY_PAYLOAD');
    const snapshot = await this.repository.loadGeneration(summaryId);
    signal.throwIfAborted();
    if (!snapshot) return this.terminal(job, 'LEARNING_SUMMARY_NOT_FOUND');
    if (snapshot.status === 'ready') {
      return { summaryId, state: 'ready' };
    }
    if (snapshot.status !== 'pending') {
      return this.terminal(job, 'LEARNING_SUMMARY_NOT_GENERATABLE');
    }
    const generated = await this.generator.generate(snapshot, signal);
    signal.throwIfAborted();
    const summary = validateLearningOverview(generated, snapshot);
    if (!summary) {
      await this.repository.failGeneration(
        summaryId,
        'INVALID_LEARNING_SUMMARY_RESPONSE',
      );
      return this.terminal(job, 'INVALID_LEARNING_SUMMARY_RESPONSE');
    }
    const completed = await this.repository.completeGeneration(
      summaryId,
      summary,
    );
    signal.throwIfAborted();
    if (!completed) {
      return this.terminal(job, 'LEARNING_SUMMARY_CHECKPOINT_CONFLICT');
    }
    return {
      summaryId,
      state: 'ready',
      chapterCount: summary.chapters.length,
    };
  }

  private terminal(job: WorkQueueJob, code: string): never {
    throw new WorkJobTerminalError(code, {
      details: { payloadSchemaVersion: job.payloadSchemaVersion },
      result: { code },
    });
  }
}

function learningSummaryId(job: WorkQueueJob): string | null {
  const value = job.payload.summaryId;
  return typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)
    ? value
    : null;
}

export function validateLearningOverview(
  value: unknown,
  snapshot: LearningOverviewGeneration,
): LearningOverviewSummary | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  if (
    root.status !== 'ready' ||
    !root.summary ||
    typeof root.summary !== 'object'
  ) {
    return null;
  }
  const summary = root.summary as Record<string, unknown>;
  if (
    typeof summary.overview !== 'string' ||
    summary.overview.trim().length < 20 ||
    !Array.isArray(summary.chapters) ||
    summary.chapters.length < 3 ||
    summary.chapters.length > 5 ||
    !Array.isArray(summary.takeaways) ||
    summary.takeaways.length > 3
  ) {
    return null;
  }
  const chapters = [];
  for (const rawChapter of summary.chapters) {
    if (!rawChapter || typeof rawChapter !== 'object') return null;
    const chapter = rawChapter as Record<string, unknown>;
    if (
      typeof chapter.startSeconds !== 'number' ||
      typeof chapter.endSeconds !== 'number' ||
      chapter.startSeconds < snapshot.coverage.startSeconds ||
      chapter.endSeconds > snapshot.coverage.endSeconds ||
      chapter.endSeconds <= chapter.startSeconds ||
      typeof chapter.title !== 'string' ||
      !chapter.title.trim() ||
      typeof chapter.body !== 'string' ||
      !chapter.body.trim()
    ) {
      return null;
    }
    chapters.push({
      startSeconds: chapter.startSeconds,
      endSeconds: chapter.endSeconds,
      title: chapter.title.trim().slice(0, 120),
      body: chapter.body.trim().slice(0, 2_000),
    });
  }
  const takeaways: string[] = [];
  for (const item of summary.takeaways) {
    if (typeof item !== 'string' || !item.trim()) return null;
    takeaways.push(item.trim().slice(0, 1_000));
  }
  return {
    overview: summary.overview.trim().slice(0, 4_000),
    chapters,
    takeaways,
  };
}
