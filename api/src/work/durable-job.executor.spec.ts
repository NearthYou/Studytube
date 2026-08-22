import { DurableJobExecutor } from './durable-job.executor';
import type { JobExecutionStore } from './job-execution.store';
import {
  WorkJobBusyError,
  WorkJobLeaseLostError,
  WorkJobTerminalError,
} from './work.errors';
import { MemoryJobExecutionStore } from './memory-job-execution.store';

const KEY = {
  eventId: '11111111-1111-4111-8111-111111111111',
  handlerVersion: 'video-asset-v1',
};

describe('DurableJobExecutor', () => {
  it('passes the opaque active lease to lease-fenced persistence', async () => {
    const store: JobExecutionStore = {
      acquire: () =>
        Promise.resolve({
          status: 'acquired',
          leaseToken: '22222222-2222-4222-8222-222222222222',
        }),
      renew: () => Promise.resolve(true),
      complete: () => Promise.resolve(),
      release: () => Promise.resolve(true),
    };
    const executor = new DurableJobExecutor(store, {
      leaseOwner: 'worker-a',
      leaseMs: 30_000,
    });

    await expect(
      executor.execute(KEY, (_signal, lease) =>
        Promise.resolve({ leaseToken: lease.leaseToken }),
      ),
    ).resolves.toEqual({
      leaseToken: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('allows one active callback and replays its completed result', async () => {
    const store = new MemoryJobExecutionStore();
    const executor = new DurableJobExecutor(store, {
      leaseOwner: 'worker-a',
      leaseMs: 30_000,
    });
    let finish: ((result: Record<string, unknown>) => void) | undefined;
    const task = jest.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          finish = resolve;
        }),
    );

    const active = executor.execute(KEY, task);
    await expect(
      executor.execute(KEY, () => Promise.resolve({ duplicate: true })),
    ).rejects.toBeInstanceOf(WorkJobBusyError);

    finish?.({ assetId: 9 });
    await expect(active).resolves.toEqual({ assetId: 9 });
    await expect(executor.execute(KEY, task)).resolves.toEqual({ assetId: 9 });

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('releases a transient failure immediately and preserves the original error', async () => {
    const store = new MemoryJobExecutionStore();
    const executor = new DurableJobExecutor(store, {
      leaseOwner: 'worker-a',
      leaseMs: 30_000,
    });
    const providerFailure = new Error('provider timeout');

    await expect(
      executor.execute(KEY, () => Promise.reject(providerFailure)),
    ).rejects.toBe(providerFailure);
    await expect(
      executor.execute(KEY, () => Promise.resolve({ retried: true })),
    ).resolves.toEqual({ retried: true });
  });

  it('keeps a long-running callback busy by renewing at one third of the lease', async () => {
    jest.useFakeTimers({ now: 1_000 });
    try {
      const store = new MemoryJobExecutionStore();
      const executor = new DurableJobExecutor(store, {
        leaseOwner: 'worker-a',
        leaseMs: 90,
      });
      let finish: ((result: Record<string, unknown>) => void) | undefined;
      const active = executor.execute(
        KEY,
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );

      await jest.advanceTimersByTimeAsync(300);
      await expect(
        executor.execute(KEY, () => Promise.resolve({ duplicate: true })),
      ).rejects.toBeInstanceOf(WorkJobBusyError);

      finish?.({ renewed: true });
      await expect(active).resolves.toEqual({ renewed: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['reports a lost lease', () => Promise.resolve(false)],
    [
      'fails with a store error',
      () => Promise.reject(new Error('heartbeat unavailable')),
    ],
  ])(
    'rejects completion after heartbeat renewal %s',
    async (_reason, renew) => {
      jest.useFakeTimers();
      try {
        const complete = jest.fn();
        const store: JobExecutionStore = {
          acquire: () =>
            Promise.resolve({
              status: 'acquired',
              leaseToken: '22222222-2222-4222-8222-222222222222',
            }),
          renew,
          complete,
          release: () => Promise.resolve(false),
        };
        const executor = new DurableJobExecutor(store, {
          leaseOwner: 'worker-a',
          leaseMs: 90,
        });
        let observedSignal: AbortSignal | undefined;
        const active = executor.execute(KEY, async (signal) => {
          observedSignal = signal;
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
          return { stale: true };
        });
        const rejected = expect(active).rejects.toBeInstanceOf(
          WorkJobLeaseLostError,
        );

        await jest.advanceTimersByTimeAsync(30);

        await rejected;
        expect(observedSignal?.aborted).toBe(true);
        expect(complete).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('atomically records a final transient attempt without persisting its raw error', async () => {
    const store = new MemoryJobExecutionStore();
    const executor = new DurableJobExecutor(store, {
      leaseOwner: 'worker-a',
      leaseMs: 30_000,
    });
    const secret =
      'Bearer final-attempt-secret-canary postgresql://worker:db-secret@db.internal/jobs https://api-user:url-secret@example.invalid/callback?token=query-secret';
    const task = jest.fn().mockRejectedValue(new Error(secret));

    await expect(
      executor.execute(KEY, task, {
        code: 'JOB_ATTEMPTS_EXHAUSTED',
        attemptsMade: 8,
      }),
    ).rejects.toMatchObject({
      code: 'JOB_ATTEMPTS_EXHAUSTED',
      message: 'JOB_ATTEMPTS_EXHAUSTED',
    });
    expect(store.findResult(KEY)).toMatchObject({
      outcome: 'terminal_failure',
      result: { code: 'JOB_ATTEMPTS_EXHAUSTED', attemptsMade: 8 },
    });
    expect(store.findDeadLetter(KEY)).toEqual({
      code: 'JOB_ATTEMPTS_EXHAUSTED',
      message: 'JOB_ATTEMPTS_EXHAUSTED',
      details: { attemptsMade: 8 },
    });
    const persisted = JSON.stringify({
      result: store.findResult(KEY),
      deadLetter: store.findDeadLetter(KEY),
    });
    expect(persisted).not.toContain('final-attempt-secret-canary');
    expect(persisted).not.toContain('db-secret');
    expect(persisted).not.toContain('url-secret');
    expect(persisted).not.toContain('query-secret');

    await expect(executor.execute(KEY, task)).rejects.toMatchObject({
      code: 'JOB_ATTEMPTS_EXHAUSTED',
    });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('persists and replays a terminal result with its dead letter as one completion', async () => {
    const store = new MemoryJobExecutionStore();
    const executor = new DurableJobExecutor(store, {
      leaseOwner: 'worker-a',
      leaseMs: 30_000,
    });
    const task = jest.fn(() =>
      Promise.reject(
        new WorkJobTerminalError('INVALID_PROVIDER_RESPONSE', {
          message: 'provider response did not match schema',
          details: { payloadSchemaVersion: 1 },
          result: { code: 'INVALID_PROVIDER_RESPONSE', responseVersion: 3 },
        }),
      ),
    );

    await expect(executor.execute(KEY, task)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
    });
    expect(store.findResult(KEY)).toMatchObject({
      outcome: 'terminal_failure',
      result: {
        code: 'INVALID_PROVIDER_RESPONSE',
        responseVersion: 3,
      },
    });
    expect(store.findDeadLetter(KEY)).toEqual({
      code: 'INVALID_PROVIDER_RESPONSE',
      message: 'provider response did not match schema',
      details: { payloadSchemaVersion: 1 },
    });

    await expect(executor.execute(KEY, task)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
      result: {
        code: 'INVALID_PROVIDER_RESPONSE',
        responseVersion: 3,
      },
    });
    expect(task).toHaveBeenCalledTimes(1);
  });
});
