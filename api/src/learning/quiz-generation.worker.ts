import { AiProxyService } from '../ai-proxy.service';
import { DurableJobExecutor } from '../work/durable-job.executor';
import { deterministicWorkUuid } from '../work/deterministic-work-id';
import type { WorkAttemptContext, WorkQueueJob } from '../work/work.queue';
import { WorkJobTerminalError } from '../work/work.errors';
import type { QuizQuestionInput } from './learning.repository';
import { LearningService } from './learning.service';

type QuizPayload = {
  courseStepId: string;
  title: string;
  sourceUrl: string;
  timestampSeconds: number;
  durationSeconds: number;
};

type QuizResponse = {
  schemaVersion: 1;
  generatorVersion: string;
  questions: QuizQuestionInput[];
};

export class QuizGenerationJobHandler {
  constructor(
    private readonly learning: LearningService,
    private readonly ai: AiProxyService,
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
            code: 'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
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
    if (
      job.eventType !== 'quiz_generation.requested' ||
      job.payloadSchemaVersion !== 1
    ) {
      return this.terminal(job, 'UNSUPPORTED_QUIZ_SCHEMA');
    }
    const payload = parseQuizPayload(job.payload);
    if (!payload) {
      return this.terminal(job, 'INVALID_QUIZ_PAYLOAD');
    }

    const generated = parseQuizResponse(
      await this.ai.generateQuiz(
        {
          schemaVersion: 1,
          ...payload,
        },
        signal,
      ),
      payload.sourceUrl,
    );
    signal.throwIfAborted();
    if (!generated) {
      return this.terminal(job, 'INVALID_QUIZ_RESPONSE');
    }
    const quizId = deterministicWorkUuid(job.eventId, 'quiz');
    signal.throwIfAborted();
    await this.learning.createQuiz({
      quizId,
      courseStepId: payload.courseStepId,
      schemaVersion: generated.schemaVersion,
      generatorVersion: generated.generatorVersion,
      maxAttempts: 3,
      questions: generated.questions,
    });
    signal.throwIfAborted();
    const result = {
      quizId,
      courseStepId: payload.courseStepId,
      questionCount: generated.questions.length,
      generatorVersion: generated.generatorVersion,
    };
    return result;
  }

  private terminal(job: WorkQueueJob, code: string): never {
    throw new WorkJobTerminalError(code, {
      details: { payloadSchemaVersion: job.payloadSchemaVersion },
      result: { code },
    });
  }
}

function parseQuizPayload(
  payload: Record<string, unknown>,
): QuizPayload | null {
  const courseStepId = canonicalPositiveInteger(payload.courseStepId);
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const sourceUrl =
    typeof payload.sourceUrl === 'string' ? payload.sourceUrl.trim() : '';
  const timestampSeconds = Number(payload.timestampSeconds);
  const durationSeconds = Number(payload.durationSeconds);
  if (
    !courseStepId ||
    !title ||
    title.length > 500 ||
    !allowedYoutubeUrl(sourceUrl) ||
    !Number.isInteger(timestampSeconds) ||
    timestampSeconds < 0 ||
    !Number.isInteger(durationSeconds) ||
    durationSeconds <= 0 ||
    payload.questionCount !== 5
  ) {
    return null;
  }
  return {
    courseStepId,
    title,
    sourceUrl,
    timestampSeconds,
    durationSeconds,
  };
}

function parseQuizResponse(
  value: unknown,
  expectedSourceUrl: string,
): QuizResponse | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    row.schemaVersion !== 1 ||
    typeof row.generatorVersion !== 'string' ||
    !row.generatorVersion.trim() ||
    row.generatorVersion.length > 128 ||
    !Array.isArray(row.questions) ||
    row.questions.length !== 5
  ) {
    return null;
  }
  const questions: QuizQuestionInput[] = [];
  for (const raw of row.questions) {
    if (!raw || typeof raw !== 'object') return null;
    const question = raw as Record<string, unknown>;
    const choices = Array.isArray(question.choices)
      ? question.choices.filter(
          (choice): choice is string =>
            typeof choice === 'string' && choice.trim().length > 0,
        )
      : [];
    const correctChoiceIndex = Number(question.correctChoiceIndex);
    const sourceStartSeconds = Number(question.sourceStartSeconds);
    const sourceEndSeconds = Number(question.sourceEndSeconds);
    if (
      typeof question.prompt !== 'string' ||
      !question.prompt.trim() ||
      question.prompt.length > 1_000 ||
      choices.length < 2 ||
      choices.length > 8 ||
      !Number.isInteger(correctChoiceIndex) ||
      correctChoiceIndex < 0 ||
      correctChoiceIndex >= choices.length ||
      typeof question.explanation !== 'string' ||
      !question.explanation.trim() ||
      question.explanation.length > 2_000 ||
      question.sourceUrl !== expectedSourceUrl ||
      !Number.isInteger(sourceStartSeconds) ||
      !Number.isInteger(sourceEndSeconds) ||
      sourceStartSeconds < 0 ||
      sourceEndSeconds <= sourceStartSeconds
    ) {
      return null;
    }
    questions.push({
      prompt: question.prompt.trim(),
      choices: choices.map((choice) => choice.trim()),
      correctChoiceIndex,
      explanation: question.explanation.trim(),
      sourceUrl: expectedSourceUrl,
      sourceStartSeconds,
      sourceEndSeconds,
    });
  }
  return {
    schemaVersion: 1,
    generatorVersion: row.generatorVersion.trim(),
    questions,
  };
}

function canonicalPositiveInteger(value: unknown): string | null {
  const normalized = typeof value === 'number' ? String(value) : value;
  return typeof normalized === 'string' && /^[1-9][0-9]*$/u.test(normalized)
    ? normalized
    : null;
}

function allowedYoutubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(
        url.hostname.toLowerCase(),
      )
    );
  } catch {
    return false;
  }
}
