import type { AiProxyService } from '../ai-proxy.service';
import { DurableJobExecutor } from '../work/durable-job.executor';
import { MemoryJobExecutionStore } from '../work/memory-job-execution.store';
import type { WorkQueueJob } from '../work/work.queue';
import { WorkJobBusyError } from '../work/work.errors';
import type { LearningService } from './learning.service';
import { QuizGenerationJobHandler } from './quiz-generation.worker';

const SOURCE_URL = 'https://www.youtube.com/watch?v=quiz-source';

const JOB: WorkQueueJob = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'quiz_generation.requested',
  handlerVersion: 'quiz-generation-v1',
  payloadSchemaVersion: 1,
  payload: {
    courseStepId: '42',
    title: 'Grounded lesson',
    sourceUrl: SOURCE_URL,
    timestampSeconds: 10,
    durationSeconds: 120,
    questionCount: 5,
  },
};

function generatedQuiz() {
  return {
    schemaVersion: 1 as const,
    generatorVersion: 'grounded-quiz-v1',
    questions: Array.from({ length: 5 }, (_, index) => ({
      prompt: `Question ${index + 1}`,
      choices: ['A', 'B', 'C', 'D'],
      correctChoiceIndex: index % 4,
      explanation: `Explanation ${index + 1}`,
      sourceUrl: SOURCE_URL,
      sourceStartSeconds: 10 + index * 5,
      sourceEndSeconds: 14 + index * 5,
    })),
  };
}

describe('QuizGenerationJobHandler', () => {
  it('runs one quiz provider call for concurrent delivery and replays the result', async () => {
    const execution = jobExecution();
    let finish: ((quiz: ReturnType<typeof generatedQuiz>) => void) | undefined;
    const generateQuiz = jest.fn(
      () =>
        new Promise<ReturnType<typeof generatedQuiz>>((resolve) => {
          finish = resolve;
        }),
    );
    const createQuiz = jest.fn().mockResolvedValue(undefined);
    const handler = new QuizGenerationJobHandler(
      { createQuiz } as unknown as LearningService,
      { generateQuiz } as unknown as AiProxyService,
      execution.executor,
    );

    const active = handler.handle(JOB);
    await expect(handler.handle(JOB)).rejects.toBeInstanceOf(WorkJobBusyError);
    finish?.(generatedQuiz());
    await expect(active).resolves.toMatchObject({
      courseStepId: '42',
      questionCount: 5,
    });
    await expect(handler.handle(JOB)).resolves.toMatchObject({
      courseStepId: '42',
      questionCount: 5,
    });

    expect(generateQuiz).toHaveBeenCalledTimes(1);
    expect(createQuiz).toHaveBeenCalledTimes(1);
  });

  it('persists a deterministic grounded quiz once across duplicate delivery', async () => {
    const execution = jobExecution();
    const generateQuiz = jest.fn().mockResolvedValue(generatedQuiz());
    const createQuiz = jest.fn().mockResolvedValue(undefined);
    const handler = new QuizGenerationJobHandler(
      { createQuiz } as unknown as LearningService,
      { generateQuiz } as unknown as AiProxyService,
      execution.executor,
    );

    const first = await handler.handle(JOB);
    const replay = await handler.handle(JOB);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      courseStepId: '42',
      questionCount: 5,
      generatorVersion: 'grounded-quiz-v1',
    });
    expect(first.quizId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(generateQuiz).toHaveBeenCalledTimes(1);
    expect(createQuiz).toHaveBeenCalledTimes(1);
    expect(createQuiz).toHaveBeenCalledWith(
      expect.objectContaining({
        quizId: first.quizId,
        courseStepId: '42',
        questions: generatedQuiz().questions,
      }),
    );
  });

  it('records malformed model output as a durable terminal failure', async () => {
    const execution = jobExecution();
    const handler = new QuizGenerationJobHandler(
      { createQuiz: jest.fn() } as unknown as LearningService,
      {
        generateQuiz: jest.fn().mockResolvedValue({
          ...generatedQuiz(),
          questions: generatedQuiz().questions.slice(0, 4),
        }),
      } as unknown as AiProxyService,
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'INVALID_QUIZ_RESPONSE',
    });
    expect(execution.store.findResult(JOB)).toMatchObject({
      outcome: 'terminal_failure',
      result: { code: 'INVALID_QUIZ_RESPONSE' },
    });
    expect(execution.store.findDeadLetter(JOB)).toMatchObject({
      code: 'INVALID_QUIZ_RESPONSE',
    });
  });

  it('leaves transient AI failures unrecorded for queue retry', async () => {
    const execution = jobExecution();
    const failure = new Error('AI timeout');
    const generateQuiz = jest
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(generatedQuiz());
    const handler = new QuizGenerationJobHandler(
      { createQuiz: jest.fn() } as unknown as LearningService,
      {
        generateQuiz,
      } as unknown as AiProxyService,
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toBe(failure);
    expect(execution.store.findResult(JOB)).toBeNull();
    expect(execution.store.findDeadLetter(JOB)).toBeNull();
    await expect(handler.handle(JOB)).resolves.toMatchObject({
      courseStepId: '42',
      questionCount: 5,
    });
    expect(generateQuiz).toHaveBeenCalledTimes(2);
  });

  it('atomically records a redacted terminal result on the final AI attempt', async () => {
    const execution = jobExecution();
    const rawFailure =
      'Bearer quiz-secret-canary https://quiz:quiz-url-secret@example.invalid/generate?token=quiz-query-secret';
    const generateQuiz = jest.fn().mockRejectedValue(new Error(rawFailure));
    const handler = new QuizGenerationJobHandler(
      { createQuiz: jest.fn() } as unknown as LearningService,
      { generateQuiz } as unknown as AiProxyService,
      execution.executor,
    );

    await expect(
      handler.handle(JOB, {
        attemptNumber: 8,
        maxAttempts: 8,
        isFinalAttempt: true,
      }),
    ).rejects.toMatchObject({
      code: 'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
    });
    expect(execution.store.findResult(JOB)).toMatchObject({
      outcome: 'terminal_failure',
      result: {
        code: 'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
        attemptsMade: 8,
      },
    });
    expect(execution.store.findDeadLetter(JOB)).toMatchObject({
      code: 'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
      details: { attemptsMade: 8 },
    });
    const persisted = JSON.stringify({
      result: execution.store.findResult(JOB),
      deadLetter: execution.store.findDeadLetter(JOB),
    });
    expect(persisted).not.toContain('quiz-secret-canary');
    expect(persisted).not.toContain('quiz-url-secret');
    expect(persisted).not.toContain('quiz-query-secret');

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
    });
    expect(generateQuiz).toHaveBeenCalledTimes(1);
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
      leaseOwner: 'quiz-worker',
      leaseMs: 30_000,
    }),
  };
}
