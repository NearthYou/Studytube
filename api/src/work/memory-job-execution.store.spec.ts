import type { JobExecutionAcquisition } from './job-execution.store';
import { MemoryJobExecutionStore } from './memory-job-execution.store';
import { WorkJobLeaseLostError } from './work.errors';

const KEY = {
  eventId: '11111111-1111-4111-8111-111111111111',
  handlerVersion: 'video-asset-v1',
};

describe('MemoryJobExecutionStore', () => {
  it('fences renewal and completion as soon as a claim expires', async () => {
    let now = 1_000;
    const store = new MemoryJobExecutionStore(() => now);
    const first = acquired(await store.acquire(KEY, 'stalled-worker', 90));

    now += 91;

    await expect(store.renew(KEY, first.leaseToken, 90)).resolves.toBe(false);
    await expect(
      store.complete(KEY, first.leaseToken, {
        outcome: 'succeeded',
        result: { stale: true },
      }),
    ).rejects.toBeInstanceOf(WorkJobLeaseLostError);

    const recovery = acquired(await store.acquire(KEY, 'recovery-worker', 90));
    await expect(
      store.complete(KEY, recovery.leaseToken, {
        outcome: 'succeeded',
        result: { recovered: true },
      }),
    ).resolves.toBeUndefined();
  });

  it('reacquires an expired crash claim and fences its stale completion', async () => {
    let now = 1_000;
    const store = new MemoryJobExecutionStore(() => now);
    const first = acquired(await store.acquire(KEY, 'crashed-worker', 90));

    now += 91;
    const second = acquired(await store.acquire(KEY, 'recovery-worker', 90));

    await expect(
      store.complete(KEY, first.leaseToken, {
        outcome: 'succeeded',
        result: { stale: true },
      }),
    ).rejects.toBeInstanceOf(WorkJobLeaseLostError);
    await expect(
      store.complete(KEY, second.leaseToken, {
        outcome: 'succeeded',
        result: { recovered: true },
      }),
    ).resolves.toBeUndefined();
    await expect(store.acquire(KEY, 'reader', 90)).resolves.toMatchObject({
      status: 'completed',
      record: { result: { recovered: true } },
    });
  });
});

function acquired(
  acquisition: JobExecutionAcquisition,
): Extract<JobExecutionAcquisition, { status: 'acquired' }> {
  expect(acquisition.status).toBe('acquired');
  return acquisition as Extract<
    JobExecutionAcquisition,
    { status: 'acquired' }
  >;
}
