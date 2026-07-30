import { DurableJobExecutor } from './durable-job.executor';
import type { WorkQueueJob } from './work.queue';
import { WorkJobTerminalError } from './work.errors';

export class UnsupportedWorkJobHandler {
  constructor(private readonly executor: DurableJobExecutor) {}

  handle(job: WorkQueueJob): Promise<Record<string, unknown>> {
    return this.executor.execute(
      {
        eventId: job.eventId,
        handlerVersion: job.handlerVersion,
      },
      () =>
        Promise.reject(
          new WorkJobTerminalError('UNSUPPORTED_EVENT_TYPE', {
            details: {
              eventType: job.eventType,
              payloadSchemaVersion: job.payloadSchemaVersion,
            },
          }),
        ),
    );
  }
}
