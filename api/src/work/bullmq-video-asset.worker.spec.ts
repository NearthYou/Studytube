import type { WorkQueueJob } from './work.queue';
import { WorkJobTerminalError } from './video-asset.worker';
import type { ObservabilityRuntime } from '../observability/runtime';
import {
  BullMqVideoAssetWorker,
  type BullMqJob,
  type BullMqWorkerClient,
  type BullMqWorkerFactory,
} from './bullmq-video-asset.worker';

const JOB: WorkQueueJob = {
  eventId: '11111111-1111-4111-8111-111111111111',
  ownerId: 7,
  eventType: 'video_asset.requested',
  handlerVersion: 'video-asset-v1',
  payloadSchemaVersion: 1,
  payload: { postId: 42 },
};

class RecordingWorker implements BullMqWorkerClient {
  ready = false;
  closed = false;

  waitUntilReady(): Promise<unknown> {
    this.ready = true;
    return Promise.resolve(this);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
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

  it('passes one-based attempt context and marks only the last attempt final', async () => {
    const worker = new RecordingWorker();
    let processor: ((job: BullMqJob) => Promise<unknown>) | undefined;
    const handle = jest.fn().mockResolvedValue({ status: 'ready' });
    const runner = new BullMqVideoAssetWorker(
      'redis://127.0.0.1:6379',
      { handle },
      (_url, jobProcessor) => {
        processor = jobProcessor;
        return worker;
      },
    );
    await runner.onModuleInit();

    await processor?.({
      data: JOB,
      attemptsMade: 0,
      opts: { attempts: 8 },
    });
    await processor?.({
      data: JOB,
      attemptsMade: 7,
      opts: { attempts: 8 },
    });
    await runner.onModuleDestroy();

    expect(handle).toHaveBeenNthCalledWith(1, JOB, {
      attemptNumber: 1,
      maxAttempts: 8,
      isFinalAttempt: false,
    });
    expect(handle).toHaveBeenNthCalledWith(2, JOB, {
      attemptNumber: 8,
      maxAttempts: 8,
      isFinalAttempt: true,
    });
  });

  it('describes BullMQ processing as a consumer span without exposing payloads', async () => {
    let processor: ((job: BullMqJob) => Promise<unknown>) | undefined;
    const runJob = jest.fn(
      (_carrier: Record<string, unknown>, callback: () => Promise<unknown>) =>
        callback(),
    );
    const observability = {
      traces: { runJob },
      metrics: { workerJob: jest.fn() },
      logger: {
        info: jest.fn(),
        error: jest.fn(),
      },
    } as unknown as ObservabilityRuntime;
    const runner = new BullMqVideoAssetWorker(
      'redis://127.0.0.1:6379',
      { handle: () => Promise.resolve({ status: 'ready' }) },
      (_url, jobProcessor) => {
        processor = jobProcessor;
        return new RecordingWorker();
      },
      observability,
    );

    await runner.onModuleInit();
    await processor?.({ data: JOB });

    expect(runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        'x-studytube-job-id': JOB.eventId,
      }),
      expect.any(Function),
      {
        spanName: 'studytube-work process',
        attributes: {
          'messaging.system': 'redis',
          'messaging.destination.name': 'studytube-work',
          'messaging.operation.type': 'process',
          'messaging.message.id': JOB.eventId,
          'studytube.event.type': JOB.eventType,
        },
      },
    );
    expect(JSON.stringify(runJob.mock.calls)).not.toContain(
      JSON.stringify(JOB.payload),
    );
  });
});
