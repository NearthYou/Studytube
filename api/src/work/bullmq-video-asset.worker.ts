import { UnrecoverableError, Worker } from 'bullmq';
import { WORK_QUEUE_NAME, type WorkQueueJob } from './work.queue';
import { WorkJobTerminalError } from './video-asset.worker';
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
export type BullMqFailedListener = (
  job: BullMqJob | undefined,
  error: Error,
) => void;

export interface BullMqWorkerClient {
  waitUntilReady(): Promise<unknown>;
  close(): Promise<void>;
  on(event: 'failed', listener: BullMqFailedListener): unknown;
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
  handle(job: WorkQueueJob): Promise<Record<string, unknown>>;
  recordExhaustedFailure?(
    job: WorkQueueJob,
    error: Error,
    attemptsMade: number,
  ): Promise<void>;
};

export class BullMqVideoAssetWorker {
  private worker?: BullMqWorkerClient;
  private readonly pendingFailureRecords = new Set<Promise<void>>();

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
    this.worker.on('failed', (job, error) =>
      this.recordExhaustedFailure(job, error),
    );
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await Promise.allSettled([...this.pendingFailureRecords]);
    this.worker = undefined;
  }

  private async process(job: BullMqJob): Promise<unknown> {
    const carrier = {
      ...job.data.telemetry,
      'x-studytube-job-id': job.data.eventId,
    };
    return this.observability.traces.runJob(carrier, async () => {
      const startedAt = performance.now();
      this.observability.logger.info('worker_job_started', {
        event_id: job.data.eventId,
        event_type: job.data.eventType,
      });
      try {
        const result = await this.handler.handle(job.data);
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
    });
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

  private recordExhaustedFailure(
    job: BullMqJob | undefined,
    error: Error,
  ): void {
    const attemptsMade = job?.attemptsMade ?? 0;
    const attemptBudget = job?.opts?.attempts ?? 1;
    if (
      !job ||
      attemptsMade < attemptBudget ||
      !this.handler.recordExhaustedFailure
    ) {
      return;
    }

    const record = this.handler.recordExhaustedFailure(
      job.data,
      error,
      attemptsMade,
    );
    this.pendingFailureRecords.add(record);
    void record
      .catch(() => undefined)
      .finally(() => this.pendingFailureRecords.delete(record));
  }
}
