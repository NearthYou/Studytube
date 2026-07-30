import { DurableJobExecutor } from './durable-job.executor';
import { MemoryJobExecutionStore } from './memory-job-execution.store';
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
    const store = new MemoryJobExecutionStore();
    const executor = new DurableJobExecutor(store, {
      leaseOwner: 'unsupported-worker',
      leaseMs: 30_000,
    });
    const handler = new UnsupportedWorkJobHandler(executor);

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'UNSUPPORTED_EVENT_TYPE',
    });
    expect(store.findDeadLetter(JOB)).toEqual({
      code: 'UNSUPPORTED_EVENT_TYPE',
      message: 'UNSUPPORTED_EVENT_TYPE',
      details: {
        eventType: JOB.eventType,
        payloadSchemaVersion: JOB.payloadSchemaVersion,
      },
    });
    expect(store.findResult(JOB)).toMatchObject({
      outcome: 'terminal_failure',
      result: {
        code: 'UNSUPPORTED_EVENT_TYPE',
      },
    });

    await expect(handler.handle(JOB)).rejects.toMatchObject({
      code: 'UNSUPPORTED_EVENT_TYPE',
    });
    expect(store.findDeadLetter(JOB)).toEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_EVENT_TYPE',
      }),
    );
  });
});
