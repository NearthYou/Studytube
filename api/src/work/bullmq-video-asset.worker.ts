import { UnrecoverableError, Worker } from 'bullmq';
import {
  WORK_QUEUE_NAME,
  type WorkAttemptContext,
  type WorkQueueJob,
} from './work.queue';
import { WorkJobTerminalError } from './work.errors';
import {
  observabilityRuntime,
  type ObservabilityRuntime,
} from '../observability/runtime';

export type BullMqJob = {
  data: WorkQueueJob;
  attemptsMade?: number;
  opts?: { attempts?: number };
};
export type BullMqProcessor = (job: BullMqJob) => Promise<unknown>;

export interface BullMqWorkerClient {
  waitUntilReady(): Promise<unknown>;
  close(): Promise<void>;
}

export type BullMqWorkerFactory = (
  url: string,
  processor: BullMqProcessor,
) => BullMqWorkerClient;

const createWorker: BullMqWorkerFactory = (url, processor) =>
  new Worker<WorkQueueJob, unknown>(WORK_QUEUE_NAME, processor, {
    connection: { url, maxRetriesPerRequest: null },
    concurrency: 2,
    lockDuration: 300_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  });

type DurableJobHandler = {
  handle(
    job: WorkQueueJob,
    attempt?: WorkAttemptContext,
  ): Promise<Record<string, unknown>>;
};

export class BullMqVideoAssetWorker {
  private worker?: BullMqWorkerClient;

  constructor(
    private readonly valkeyUrl: string,
    private readonly handler: DurableJobHandler,
    private readonly workerFactory: BullMqWorkerFactory = createWorker,
    private readonly observability: ObservabilityRuntime = observabilityRuntime,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = this.workerFactory(this.valkeyUrl, (job) =>
      this.process(job),
    );
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }

  private async process(job: BullMqJob): Promise<unknown> {
    const carrier = {
      ...job.data.telemetry,
      'x-studytube-job-id': job.data.eventId,
    };
    return this.observability.traces.runJob(
      carrier,
      async () => {
        const startedAt = performance.now();
        this.observability.logger.info('worker_job_started', {
          event_id: job.data.eventId,
          event_type: job.data.eventType,
        });
        try {
          const result = await this.handler.handle(
            job.data,
            attemptContext(job),
          );
          this.recordJobMetric(job.data, 'succeeded', startedAt);
          return result;
        } catch (error) {
          const terminal = error instanceof WorkJobTerminalError;
          this.recordJobMetric(
            job.data,
            terminal ? 'failed' : 'retry',
            startedAt,
          );
          this.observability.logger.error('worker_job_failed', error, {
            event_id: job.data.eventId,
            event_type: job.data.eventType,
            terminal,
          });
          if (terminal) {
            throw new UnrecoverableError(error.message);
          }
          throw error;
        }
      },
      {
        spanName: `${WORK_QUEUE_NAME} process`,
        attributes: {
          'messaging.system': 'redis',
          'messaging.destination.name': WORK_QUEUE_NAME,
          'messaging.operation.type': 'process',
          'messaging.message.id': job.data.eventId,
          'studytube.event.type': job.data.eventType,
        },
      },
    );
  }

  private recordJobMetric(
    job: WorkQueueJob,
    outcome: 'succeeded' | 'failed' | 'retry',
    startedAt: number,
  ): void {
    this.observability.metrics.workerJob(
      WORK_QUEUE_NAME,
      job.eventType,
      outcome,
      performance.now() - startedAt,
    );
  }
}

function attemptContext(job: BullMqJob): WorkAttemptContext {
  const maxAttempts = Math.max(1, job.opts?.attempts ?? 1);
  const attemptNumber = Math.max(1, (job.attemptsMade ?? 0) + 1);
  return {
    attemptNumber,
    maxAttempts,
    isFinalAttempt: attemptNumber >= maxAttempts,
  };
}
