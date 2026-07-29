import type { AiProxyService } from '../ai-proxy.service';
import type { WorkQueueJob } from '../work/work.queue';
import type { JobResult } from '../work/work.types';
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

class MemoryResults {
  result: JobResult | null = null;
  deadLetter: Record<string, unknown> | null = null;

  findJobResult(): Promise<JobResult | null> {
    return Promise.resolve(this.result);
  }

  recordJobResult(result: JobResult): Promise<boolean> {
    if (this.result) return Promise.resolve(false);
    this.result = result;
    return Promise.resolve(true);
  }

  recordDeadLetter(input: Record<string, unknown>): Promise<boolean> {
    if (this.deadLetter) return Promise.resolve(false);
    this.deadLetter = input;
    return Promise.resolve(true);
  }
}

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
  it('persists a deterministic grounded quiz once across duplicate delivery', async () => {
    const results = new MemoryResults();
    const generateQuiz = jest.fn().mockResolvedValue(generatedQuiz());
    const createQuiz = jest.fn().mockResolvedValue(undefined);
    const handler = new QuizGenerationJobHandler(
      { createQuiz } as unknown as LearningService,
      { generateQuiz } as unknown as AiProxyService,
      results,
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
    const results = new MemoryResults();
    const handler = new QuizGenerationJobHandler(
      { createQuiz: jest.fn() } as unknown as LearningService,
      {
        generateQuiz: jest.fn().mockResolvedValue({
          ...generatedQuiz(),
          questions: generatedQuiz().questions.slice(0, 4),
        }),
      } as unknown as AiProxyService,
      results,
    );

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'INVALID_QUIZ_RESPONSE',
    });
    expect(results.result).toMatchObject({
      outcome: 'terminal_failure',
      result: { code: 'INVALID_QUIZ_RESPONSE' },
    });
    expect(results.deadLetter).toMatchObject({
      eventId: JOB.eventId,
      code: 'INVALID_QUIZ_RESPONSE',
    });
  });

  it('leaves transient AI failures unrecorded for queue retry', async () => {
    const results = new MemoryResults();
    const failure = new Error('AI timeout');
    const handler = new QuizGenerationJobHandler(
      { createQuiz: jest.fn() } as unknown as LearningService,
      {
        generateQuiz: jest.fn().mockRejectedValue(failure),
      } as unknown as AiProxyService,
      results,
    );

    await expect(handler.handle(JOB)).rejects.toBe(failure);
    expect(results.result).toBeNull();
    expect(results.deadLetter).toBeNull();
  });
});
