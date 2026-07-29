import type { WorkQueueJob } from './work.queue';
import { UnsupportedWorkJobHandler } from './unsupported-work.worker';

const JOB: WorkQueueJob = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'unknown.requested',
  handlerVersion: 'unsupported-v1',
  payloadSchemaVersion: 1,
  payload: {},
};

describe('UnsupportedWorkJobHandler', () => {
  it('records one terminal result and dead letter before rejecting', async () => {
    const recordDeadLetter = jest.fn().mockResolvedValue(true);
    const recordJobResult = jest.fn().mockResolvedValue(true);
    const handler = new UnsupportedWorkJobHandler({
      findJobResult: jest.fn().mockResolvedValue(null),
      recordDeadLetter,
      recordJobResult,
    });

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'UNSUPPORTED_EVENT_TYPE',
    });
    expect(recordDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: JOB.eventId,
        code: 'UNSUPPORTED_EVENT_TYPE',
      }),
    );
    expect(recordJobResult).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: JOB.eventId,
        outcome: 'terminal_failure',
      }),
    );
  });
});
