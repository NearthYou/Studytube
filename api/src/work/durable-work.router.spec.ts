import type { WorkQueueJob } from './work.queue';
import { DurableWorkRouter } from './durable-work.router';
import { WorkJobTerminalError } from './video-asset.worker';

function job(eventType: string): WorkQueueJob {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    eventType,
    handlerVersion: `${eventType}-v1`,
    payloadSchemaVersion: 1,
    payload: { postId: 42, courseStepId: '24' },
  };
}

describe('DurableWorkRouter', () => {
  it('dispatches each schema-versioned event to its bounded handler', async () => {
    const video = { handle: jest.fn().mockResolvedValue({ assetId: 9 }) };
    const retrieval = {
      handle: jest.fn().mockResolvedValue({ sourceId: 42 }),
    };
    const unsupported = { handle: jest.fn() };
    const router = new DurableWorkRouter(video, retrieval, unsupported);

    await router.handle(job('video_asset.requested'));
    await router.handle(job('learning_intake.requested'));
    await router.handle(job('retrieval_embedding.requested'));

    expect(video.handle).toHaveBeenCalledTimes(2);
    expect(video.handle).toHaveBeenNthCalledWith(
      2,
      job('learning_intake.requested'),
      undefined,
    );
    expect(retrieval.handle).toHaveBeenCalledTimes(1);
    expect(unsupported.handle).not.toHaveBeenCalled();
  });

  it('routes unknown events through the durable terminal recorder', async () => {
    const error = new Error('UNSUPPORTED_EVENT_TYPE');
    const unsupported = { handle: jest.fn().mockRejectedValue(error) };
    const router = new DurableWorkRouter(
      { handle: jest.fn() },
      { handle: jest.fn() },
      unsupported,
    );

    await expect(router.handle(job('unknown.requested'))).rejects.toBe(error);
    expect(unsupported.handle).toHaveBeenCalledWith(
      job('unknown.requested'),
      undefined,
    );
  });

  it('routes quiz generation and settles its approved run work item', async () => {
    const quiz = { handle: jest.fn().mockResolvedValue({ quizId: 'quiz-1' }) };
    const learning = { settleAgentWorkItem: jest.fn().mockResolvedValue() };
    const router = new DurableWorkRouter(
      { handle: jest.fn() },
      { handle: jest.fn() },
      { handle: jest.fn() },
      quiz,
      learning,
    );

    await expect(
      router.handle(job('quiz_generation.requested')),
    ).resolves.toEqual({ quizId: 'quiz-1' });
    expect(quiz.handle).toHaveBeenCalledTimes(1);
    expect(learning.settleAgentWorkItem).toHaveBeenCalledWith({
      courseStepId: '24',
      kind: 'quiz_generation',
      outcome: 'completed',
    });
  });

  it('routes learning summaries through their dedicated durable handler', async () => {
    const summary = {
      handle: jest.fn().mockResolvedValue({ summaryId: 'summary-1' }),
    };
    const router = new DurableWorkRouter(
      { handle: jest.fn() },
      { handle: jest.fn() },
      { handle: jest.fn() },
      undefined,
      undefined,
      summary,
    );
    const summaryJob = job('learning_summary.requested');

    await expect(router.handle(summaryJob)).resolves.toEqual({
      summaryId: 'summary-1',
    });
    expect(summary.handle).toHaveBeenCalledWith(summaryJob, undefined);
  });

  it('settles terminal and final-attempt jobs as failed', async () => {
    const terminal = new WorkJobTerminalError('INVALID_QUIZ_RESPONSE');
    const exhausted = new WorkJobTerminalError(
      'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
    );
    const quiz = {
      handle: jest
        .fn()
        .mockRejectedValueOnce(terminal)
        .mockRejectedValueOnce(exhausted),
    };
    const learning = { settleAgentWorkItem: jest.fn().mockResolvedValue() };
    const router = new DurableWorkRouter(
      { handle: jest.fn() },
      { handle: jest.fn() },
      { handle: jest.fn() },
      quiz,
      learning,
    );
    const quizJob = job('quiz_generation.requested');

    await expect(router.handle(quizJob)).rejects.toBe(terminal);
    expect(learning.settleAgentWorkItem).toHaveBeenCalledWith({
      courseStepId: '24',
      kind: 'quiz_generation',
      outcome: 'failed',
      reasonCode: 'INVALID_QUIZ_RESPONSE',
    });

    learning.settleAgentWorkItem.mockClear();
    const finalAttempt = {
      attemptNumber: 8,
      maxAttempts: 8,
      isFinalAttempt: true,
    };
    await expect(router.handle(quizJob, finalAttempt)).rejects.toBe(exhausted);
    expect(quiz.handle).toHaveBeenLastCalledWith(quizJob, finalAttempt);
    expect(learning.settleAgentWorkItem).toHaveBeenCalledWith({
      courseStepId: '24',
      kind: 'quiz_generation',
      outcome: 'failed',
      reasonCode: 'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
    });
  });
});
