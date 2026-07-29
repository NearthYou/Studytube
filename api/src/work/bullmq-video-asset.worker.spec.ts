import type { WorkQueueJob } from './work.queue';
import { WorkJobTerminalError } from './video-asset.worker';
import {
  BullMqVideoAssetWorker,
  type BullMqJob,
  type BullMqWorkerClient,
  type BullMqWorkerFactory,
} from './bullmq-video-asset.worker';

const JOB: WorkQueueJob = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'video_asset.requested',
  handlerVersion: 'video-asset-v1',
  payloadSchemaVersion: 1,
  payload: { postId: 42 },
};

class RecordingWorker implements BullMqWorkerClient {
  ready = false;
  closed = false;
  failedListener?: (job: BullMqJob | undefined, error: Error) => void;

  waitUntilReady(): Promise<unknown> {
    this.ready = true;
    return Promise.resolve(this);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  on(
    _event: 'failed',
    listener: (job: BullMqJob | undefined, error: Error) => void,
  ): this {
    this.failedListener = listener;
    return this;
  }

  emitFailed(job: BullMqJob, error: Error): void {
    this.failedListener?.(job, error);
  }
}

describe('BullMqVideoAssetWorker', () => {
  it('waits until Valkey is ready and closes gracefully', async () => {
    const worker = new RecordingWorker();
    let processor: ((job: BullMqJob) => Promise<unknown>) | undefined;
    const factory: BullMqWorkerFactory = (_url, jobProcessor) => {
      processor = jobProcessor;
      return worker;
    };
    const runner = new BullMqVideoAssetWorker(
      'redis://127.0.0.1:6379',
      { handle: () => Promise.resolve({ status: 'ready' }) },
      factory,
    );

    await runner.onModuleInit();
    await expect(processor?.({ data: JOB })).resolves.toEqual({
      status: 'ready',
    });
    await runner.onModuleDestroy();

    expect(worker.ready).toBe(true);
    expect(worker.closed).toBe(true);
  });

  it('marks typed terminal failures as unrecoverable', async () => {
    let processor: ((job: BullMqJob) => Promise<unknown>) | undefined;
    const factory: BullMqWorkerFactory = (_url, jobProcessor) => {
      processor = jobProcessor;
      return new RecordingWorker();
    };
    const runner = new BullMqVideoAssetWorker(
      'redis://127.0.0.1:6379',
      {
        handle: () =>
          Promise.reject(new WorkJobTerminalError('POST_NOT_FOUND')),
      },
      factory,
    );

    await runner.onModuleInit();

    await expect(processor?.({ data: JOB })).rejects.toMatchObject({
      name: 'UnrecoverableError',
      message: 'POST_NOT_FOUND',
    });
  });

  it('records a dead letter only after the final transient attempt', async () => {
    const worker = new RecordingWorker();
    const recordExhaustedFailure = jest.fn().mockResolvedValue(undefined);
    const handler = {
      handle: () => Promise.resolve({ status: 'ready' }),
      recordExhaustedFailure,
    };
    const runner = new BullMqVideoAssetWorker(
      'redis://127.0.0.1:6379',
      handler,
      () => worker,
    );
    await runner.onModuleInit();

    worker.emitFailed(
      { data: JOB, attemptsMade: 7, opts: { attempts: 8 } },
      new Error('transient'),
    );
    worker.emitFailed(
      { data: JOB, attemptsMade: 8, opts: { attempts: 8 } },
      new Error('exhausted'),
    );
    await runner.onModuleDestroy();

    expect(recordExhaustedFailure).toHaveBeenCalledTimes(1);
    expect(recordExhaustedFailure).toHaveBeenCalledWith(
      JOB,
      expect.objectContaining({ message: 'exhausted' }),
      8,
    );
  });
});
