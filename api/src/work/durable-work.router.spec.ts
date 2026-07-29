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
    await router.handle(job('retrieval_embedding.requested'));

    expect(video.handle).toHaveBeenCalledTimes(1);
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
    expect(unsupported.handle).toHaveBeenCalledWith(job('unknown.requested'));
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

  it('settles terminal and exhausted jobs as failed', async () => {
    const terminal = new WorkJobTerminalError('INVALID_QUIZ_RESPONSE');
    const quiz = {
      handle: jest.fn().mockRejectedValue(terminal),
      recordExhaustedFailure: jest.fn().mockResolvedValue(undefined),
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
    await router.recordExhaustedFailure(
      quizJob,
      new Error('provider timeout'),
      8,
    );
    expect(quiz.recordExhaustedFailure).toHaveBeenCalledWith(
      quizJob,
      expect.any(Error),
      8,
    );
    expect(learning.settleAgentWorkItem).toHaveBeenCalledWith({
      courseStepId: '24',
      kind: 'quiz_generation',
      outcome: 'failed',
      reasonCode: 'WORK_ATTEMPTS_EXHAUSTED',
    });
  });
});
