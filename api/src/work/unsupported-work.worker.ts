import { randomUUID } from 'node:crypto';
import type { WorkRepository } from './work.repository';
import type { WorkQueueJob } from './work.queue';
import { WorkJobTerminalError } from './video-asset.worker';

type TerminalResultStore = Pick<
  WorkRepository,
  'findJobResult' | 'recordDeadLetter' | 'recordJobResult'
>;

export class UnsupportedWorkJobHandler {
  constructor(private readonly results: TerminalResultStore) {}

  async handle(job: WorkQueueJob): Promise<never> {
    const existing = await this.results.findJobResult(
      job.eventId,
      job.handlerVersion,
    );
    const code =
      existing && typeof existing.result.code === 'string'
        ? existing.result.code
        : 'UNSUPPORTED_EVENT_TYPE';
    if (!existing) {
      await this.results.recordDeadLetter({
        id: randomUUID(),
        eventId: job.eventId,
        handlerVersion: job.handlerVersion,
        code,
        message: code,
        details: {
          eventType: job.eventType,
          payloadSchemaVersion: job.payloadSchemaVersion,
        },
      });
      await this.results.recordJobResult({
        id: randomUUID(),
        eventId: job.eventId,
        handlerVersion: job.handlerVersion,
        outcome: 'terminal_failure',
        result: { code },
      });
    }
    throw new WorkJobTerminalError(code);
  }
}
