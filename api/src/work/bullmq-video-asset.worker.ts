import { UnrecoverableError, Worker } from 'bullmq';
import { WORK_QUEUE_NAME, type WorkQueueJob } from './work.queue';
import { WorkJobTerminalError } from './video-asset.worker';

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
    try {
      return await this.handler.handle(job.data);
    } catch (error) {
      if (error instanceof WorkJobTerminalError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
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
