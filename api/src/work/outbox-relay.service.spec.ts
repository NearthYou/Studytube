import type { WorkRepository } from './work.repository';
import { WorkLeaseLostError } from './work.repository';
import type {
  ClaimedOutboxEvent,
  JobResult,
  ReplayResult,
  RetryResult,
} from './work.types';
import { OutboxRelayService } from './outbox-relay.service';
import type {
  WorkQueueJob,
  WorkQueueOptions,
  WorkQueuePublisher,
} from './work.queue';

const EVENT: ClaimedOutboxEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  eventType: 'video_asset.requested',
  aggregateType: 'post',
  aggregateId: '42',
  aggregateVersion: 1,
  payloadSchemaVersion: 1,
  payload: { postId: 42 },
  occurredAt: new Date('2026-07-29T00:00:00.000Z'),
  attemptCount: 1,
  maxAttempts: 8,
  leaseToken: '22222222-2222-4222-8222-222222222222',
};

class MemoryWorkRepository implements WorkRepository {
  acked = false;
  retryResult: RetryResult | null = null;
  failNextAck = false;

  appendOutboxEvent(): Promise<void> {
    return Promise.resolve();
  }

  claimOutboxBatch(): Promise<ClaimedOutboxEvent[]> {
    return Promise.resolve(this.acked || this.retryResult ? [] : [EVENT]);
  }

  ackOutboxEvent(): Promise<void> {
    if (this.failNextAck) {
      this.failNextAck = false;
      return Promise.reject(new WorkLeaseLostError());
    }
    this.acked = true;
    return Promise.resolve();
  }

  retryOutboxEvent(): Promise<RetryResult> {
    this.retryResult = 'retry_scheduled';
    return Promise.resolve(this.retryResult);
  }

  findJobResult(): Promise<JobResult | null> {
    return Promise.resolve(null);
  }

  recordJobResult(): Promise<boolean> {
    return Promise.resolve(true);
  }

  recordDeadLetter(): Promise<boolean> {
    return Promise.resolve(true);
  }

  replayDeadLetter(): Promise<ReplayResult> {
    throw new Error('not used');
  }
}

class MemoryQueue implements WorkQueuePublisher {
  readonly jobs = new Map<
    string,
    { name: string; data: WorkQueueJob; options: WorkQueueOptions }
  >();
  failure: Error | null = null;
  pending = false;
  closed = false;

  add(
    name: string,
    data: WorkQueueJob,
    options: WorkQueueOptions,
  ): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (this.pending) {
      return new Promise<void>(() => undefined);
    }
    if (!this.jobs.has(options.jobId)) {
      this.jobs.set(options.jobId, { name, data, options });
    }
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

type RelayContract = { publishOnce(): Promise<number> };
type RelayLifecycle = {
  onModuleInit(): void;
  onModuleDestroy(): Promise<void>;
};

describe('OutboxRelayService', () => {
  it('publishes one deterministic retained job and acknowledges its event', async () => {
    const repository = new MemoryWorkRepository();
    const queue = new MemoryQueue();
    const relay = new OutboxRelayService(repository, queue);

    await expect(
      (relay as unknown as RelayContract).publishOnce(),
    ).resolves.toBe(1);

    expect(repository.acked).toBe(true);
    expect([...queue.jobs.values()]).toEqual([
      {
        name: 'video_asset.requested',
        data: {
          eventId: EVENT.id,
          eventType: EVENT.eventType,
          handlerVersion: 'video-asset-v1',
          payloadSchemaVersion: 1,
          payload: { postId: 42 },
          telemetry: {
            'x-studytube-job-id': EVENT.id,
          },
        },
        options: {
          jobId: `${EVENT.id}-video-asset-v1`,
          attempts: 8,
          backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
          removeOnComplete: false,
          removeOnFail: false,
        },
      },
    ]);
  });

  it('converges on the same job when publish succeeds before acknowledgement', async () => {
    const repository = new MemoryWorkRepository();
    repository.failNextAck = true;
    const queue = new MemoryQueue();
    const relay = new OutboxRelayService(repository, queue);

    await expect(
      (relay as unknown as RelayContract).publishOnce(),
    ).rejects.toBeInstanceOf(WorkLeaseLostError);
    await expect(
      (relay as unknown as RelayContract).publishOnce(),
    ).resolves.toBe(1);

    expect(queue.jobs.size).toBe(1);
    expect(repository.acked).toBe(true);
  });

  it('releases database work for retry when Valkey is unavailable', async () => {
    const repository = new MemoryWorkRepository();
    const queue = new MemoryQueue();
    queue.failure = new Error('connect ECONNREFUSED');
    const relay = new OutboxRelayService(repository, queue);

    await expect(
      (relay as unknown as RelayContract).publishOnce(),
    ).resolves.toBe(0);

    expect(repository.acked).toBe(false);
    expect(repository.retryResult).toBe('retry_scheduled');
  });

  it('times out a stalled queue publish before its database lease expires', async () => {
    jest.useFakeTimers();
    try {
      const repository = new MemoryWorkRepository();
      const queue = new MemoryQueue();
      queue.pending = true;
      const relay = new OutboxRelayService(repository, queue, {
        pollIntervalMs: 10,
        publishTimeoutMs: 25,
      });

      const publishing = (relay as unknown as RelayContract).publishOnce();
      await jest.advanceTimersByTimeAsync(25);

      await expect(publishing).resolves.toBe(0);
      expect(repository.acked).toBe(false);
      expect(repository.retryResult).toBe('retry_scheduled');
    } finally {
      jest.useRealTimers();
    }
  });

  it('polls on startup and closes the queue after in-flight work on shutdown', async () => {
    jest.useFakeTimers();
    const repository = new MemoryWorkRepository();
    const queue = new MemoryQueue();
    const relay = new OutboxRelayService(repository, queue, {
      pollIntervalMs: 10,
    });
    const lifecycle = relay as unknown as RelayLifecycle;

    lifecycle.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);

    expect(repository.acked).toBe(true);
    await lifecycle.onModuleDestroy();
    expect(queue.closed).toBe(true);
    jest.useRealTimers();
  });
});
