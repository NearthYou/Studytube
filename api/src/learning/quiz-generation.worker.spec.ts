import { DurableJobExecutor } from '../work/durable-job.executor';
import { MemoryJobExecutionStore } from '../work/memory-job-execution.store';
import type { WorkQueueJob } from '../work/work.queue';
import { WorkJobBusyError } from '../work/work.errors';
import type { LearningService } from './learning.service';
import {
  QuizGenerationJobHandler,
  type GroundedQuizGenerator,
  type QuizGenerationSnapshot,
} from './quiz-generation.worker';

const LOOP_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '42';
const SOURCE_URL = 'https://www.youtube.com/watch?v=quizsource1';

const JOB: WorkQueueJob = {
  eventId: '22222222-2222-4222-8222-222222222222',
  eventType: 'quiz_generation.requested',
  handlerVersion: 'quiz-generation-v2',
  payloadSchemaVersion: 2,
  payload: { quizLoopId: LOOP_ID },
};

function snapshot(
  state: QuizGenerationSnapshot['state'] = 'generating',
): QuizGenerationSnapshot {
  return {
    loopId: LOOP_ID,
    state,
    ownerId: 7,
    studyContextId: '8',
    captionArtifactId: ARTIFACT_ID,
    captionGeneration: 3,
    watchedRange: { start: 10, end: 90 },
    evidence: Array.from({ length: 5 }, (_, index) => ({
      resourceId: `caption-segment-${index + 1}`,
      content: `Grounded caption ${index + 1}`,
      sourceUrl: SOURCE_URL,
      startSeconds: 10 + index * 10,
      endSeconds: 15 + index * 10,
      artifactId: ARTIFACT_ID,
      artifactGeneration: 3,
    })),
  };
}

function groundedQuiz() {
  return {
    schemaVersion: 1 as const,
    generatorVersion: 'fake-mcp-quiz-v1',
    questions: snapshot().evidence.map((evidence, index) => ({
      prompt: `Question ${index + 1}`,
      choices: ['A', 'B', 'C', 'D'],
      correctChoiceIndex: index % 4,
      explanation: `Explanation ${index + 1}`,
      citation: {
        resourceId: evidence.resourceId,
        sourceUrl: evidence.sourceUrl,
        startSeconds: evidence.startSeconds,
        endSeconds: evidence.endSeconds,
        artifactId: evidence.artifactId,
        artifactGeneration: evidence.artifactGeneration,
      },
    })),
  };
}

describe('QuizGenerationJobHandler', () => {
  it('uses only the pinned MCP evidence contract and checkpoints a ready quiz', async () => {
    const execution = jobExecution();
    const generation = snapshot();
    const loadAdaptiveQuizGeneration = jest.fn().mockResolvedValue(generation);
    const completeAdaptiveQuizGeneration = jest.fn().mockResolvedValue(true);
    const generate = jest.fn().mockResolvedValue(groundedQuiz());
    const handler = handlerWith(
      { loadAdaptiveQuizGeneration, completeAdaptiveQuizGeneration },
      { generate },
      execution.executor,
    );

    await expect(handler.handle(JOB)).resolves.toEqual({
      quizLoopId: LOOP_ID,
      state: 'ready',
      questionCount: 5,
      generatorVersion: 'fake-mcp-quiz-v1',
    });
    expect(generate).toHaveBeenCalledWith(generation, expect.any(AbortSignal));
    expect(completeAdaptiveQuizGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        loopId: LOOP_ID,
        captionArtifactId: ARTIFACT_ID,
        captionGeneration: 3,
      }),
    );
  });

  it('replays a completed database checkpoint without another generator call', async () => {
    const execution = jobExecution();
    const generate = jest.fn();
    const handler = handlerWith(
      {
        loadAdaptiveQuizGeneration: jest
          .fn()
          .mockResolvedValue(snapshot('ready')),
      },
      { generate },
      execution.executor,
    );

    await expect(handler.handle(JOB)).resolves.toMatchObject({
      quizLoopId: LOOP_ID,
      state: 'ready',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('runs one generation for concurrent delivery', async () => {
    const execution = jobExecution();
    let finish!: (value: ReturnType<typeof groundedQuiz>) => void;
    const generate = jest.fn(
      () =>
        new Promise<ReturnType<typeof groundedQuiz>>((resolve) => {
          finish = resolve;
        }),
    );
    const handler = handlerWith(
      {
        loadAdaptiveQuizGeneration: jest.fn().mockResolvedValue(snapshot()),
        completeAdaptiveQuizGeneration: jest.fn().mockResolvedValue(true),
      },
      { generate },
      execution.executor,
    );

    const active = handler.handle(JOB);
    await expect(handler.handle(JOB)).rejects.toBeInstanceOf(WorkJobBusyError);
    finish(groundedQuiz());
    await expect(active).resolves.toMatchObject({ state: 'ready' });
    await expect(handler.handle(JOB)).resolves.toMatchObject({
      state: 'ready',
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects a citation outside the pinned artifact and stores only a safe failure code', async () => {
    const execution = jobExecution();
    const quiz = groundedQuiz();
    quiz.questions[0].citation.artifactGeneration = 99;
    const failAdaptiveQuizGeneration = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWith(
      {
        loadAdaptiveQuizGeneration: jest.fn().mockResolvedValue(snapshot()),
        failAdaptiveQuizGeneration,
      },
      { generate: jest.fn().mockResolvedValue(quiz) },
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'INVALID_GROUNDED_QUIZ_RESPONSE',
    });
    expect(failAdaptiveQuizGeneration).toHaveBeenCalledWith(
      LOOP_ID,
      'INVALID_GROUNDED_QUIZ_RESPONSE',
    );
    expect(execution.store.findDeadLetter(JOB)).toMatchObject({
      code: 'INVALID_GROUNDED_QUIZ_RESPONSE',
    });
  });

  it('marks the database checkpoint failed only when transient attempts are exhausted', async () => {
    const execution = jobExecution();
    const rawFailure =
      'Bearer quiz-secret-canary https://quiz:secret@example.invalid/?token=hidden';
    const failAdaptiveQuizGeneration = jest.fn().mockResolvedValue(undefined);
    const generate = jest.fn().mockRejectedValue(new Error(rawFailure));
    const handler = handlerWith(
      {
        loadAdaptiveQuizGeneration: jest.fn().mockResolvedValue(snapshot()),
        failAdaptiveQuizGeneration,
      },
      { generate },
      execution.executor,
    );

    await expect(handler.handle(JOB)).rejects.toThrow(rawFailure);
    expect(failAdaptiveQuizGeneration).not.toHaveBeenCalled();
    await expect(
      handler.handle(JOB, {
        attemptNumber: 8,
        maxAttempts: 8,
        isFinalAttempt: true,
      }),
    ).rejects.toMatchObject({ code: 'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED' });
    expect(failAdaptiveQuizGeneration).toHaveBeenCalledWith(
      LOOP_ID,
      'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
    );
    expect(
      JSON.stringify({
        result: execution.store.findResult(JOB),
        deadLetter: execution.store.findDeadLetter(JOB),
      }),
    ).not.toContain('quiz-secret-canary');
  });
});

function handlerWith(
  learning: Partial<LearningService>,
  generator: Pick<GroundedQuizGenerator, 'generate'>,
  executor: DurableJobExecutor,
) {
  return new QuizGenerationJobHandler(
    learning as LearningService,
    generator,
    executor,
  );
}

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
