import {
  Argon2QueueOverflowError,
  Argon2WorkLimiter,
} from './argon2-work-limiter';
import { ARGON2_MEMORY_PER_JOB_MIB } from './auth.constants';

describe('Argon2WorkLimiter', () => {
  it('runs no more than the memory-budgeted Argon2 concurrency', async () => {
    const limiter = new Argon2WorkLimiter({
      concurrency: 2,
      maxQueueSize: 4,
      memoryBudgetMiB: 128,
    });
    let active = 0;
    let peakActive = 0;
    const releases: Array<() => void> = [];

    const jobs = Array.from({ length: 4 }, (_, index) =>
      limiter.run(
        () =>
          new Promise<number>((resolve) => {
            active += 1;
            peakActive = Math.max(peakActive, active);
            releases.push(() => {
              active -= 1;
              resolve(index);
            });
          }),
      ),
    );

    await waitFor(() => releases.length === 2);
    expect(peakActive).toBe(2);
    releases.shift()?.();
    releases.shift()?.();
    await waitFor(() => releases.length === 2);
    releases.shift()?.();
    releases.shift()?.();

    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3]);
    expect(peakActive).toBe(2);
  });

  it('queues only the configured number of jobs and rejects overflow with retry metadata', async () => {
    const limiter = new Argon2WorkLimiter({
      concurrency: 1,
      maxQueueSize: 1,
      memoryBudgetMiB: 64,
      retryAfterSeconds: 3,
    });
    let releaseActive: (() => void) | undefined;
    const active = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          releaseActive = resolve;
        }),
    );
    const queued = limiter.run(() => 'queued');

    await expect(limiter.run(() => 'overflow')).rejects.toMatchObject({
      name: 'Argon2QueueOverflowError',
      code: 'AUTH_ARGON2_QUEUE_FULL',
      retryAfterSeconds: 3,
    } satisfies Partial<Argon2QueueOverflowError>);

    releaseActive?.();
    await expect(active).resolves.toBeUndefined();
    await expect(queued).resolves.toBe('queued');
  });

  it('rejects startup policy whose concurrency exceeds the 64 MiB per-job budget', () => {
    expect(
      () =>
        new Argon2WorkLimiter({
          concurrency: 3,
          memoryBudgetMiB: 128,
        }),
    ).toThrow(/memory budget/i);
    expect(
      () =>
        new Argon2WorkLimiter({
          concurrency: 1,
          memoryBudgetMiB: 63,
        }),
    ).toThrow(/memory budget/i);
  });

  it('uses a bounded default policy', () => {
    const limiter = new Argon2WorkLimiter();

    expect(limiter.policy).toEqual({
      concurrency: 2,
      maxQueueSize: 16,
      memoryBudgetMiB: 192,
      memoryPerJobMiB: 64,
      retryAfterSeconds: 1,
    });
    expect(limiter.policy.concurrency).toBeLessThan(
      Math.floor(limiter.policy.memoryBudgetMiB / ARGON2_MEMORY_PER_JOB_MIB),
    );
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for limiter state');
}
