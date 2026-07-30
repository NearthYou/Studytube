import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DurableJobExecutor } from '../src/work/durable-job.executor';
import type {
  JobExecutionCompletion,
  JobExecutionKey,
  JobExecutionStore,
} from '../src/work/job-execution.store';
import { PostgresWorkRepository } from '../src/work/postgres-work.repository';
import {
  WorkJobBusyError,
  WorkJobCompletionConflictError,
  WorkJobLeaseLostError,
} from '../src/work/work.errors';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@127.0.0.1:5432/app_dev';

describe('durable job execution (e2e)', () => {
  jest.setTimeout(30_000);

  it('allows one callback across two PostgreSQL clients and replays the committed result', async () => {
    const poolA = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const poolB = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const eventId = randomUUID();
    const key = jobKey(eventId);
    await insertEvent(poolA, eventId);

    try {
      const executorA = new DurableJobExecutor(
        new PostgresWorkRepository(poolA),
        { leaseOwner: 'postgres-worker-a', leaseMs: 30_000 },
      );
      const executorB = new DurableJobExecutor(
        new PostgresWorkRepository(poolB),
        { leaseOwner: 'postgres-worker-b', leaseMs: 30_000 },
      );
      let finish: ((result: Record<string, unknown>) => void) | undefined;
      let started: (() => void) | undefined;
      const callbackStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const task = jest.fn(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            finish = resolve;
            started?.();
          }),
      );

      const first = executorA.execute(key, task);
      const second = executorB.execute(key, task);
      const observed = [observe(first), observe(second)] as const;
      await callbackStarted;
      const whileActive = await Promise.race(observed);
      expect(whileActive).toMatchObject({ status: 'rejected' });
      expect(
        whileActive.status === 'rejected' ? whileActive.reason : undefined,
      ).toBeInstanceOf(WorkJobBusyError);
      finish?.({ canonical: 'winner' });
      const raced = await Promise.all(observed);

      expect(raced.filter((result) => result.status === 'fulfilled')).toEqual([
        expect.objectContaining({
          value: { canonical: 'winner' },
        }),
      ]);
      const rejected = raced.find((result) => result.status === 'rejected');
      expect(
        rejected && rejected.status === 'rejected'
          ? rejected.reason
          : undefined,
      ).toBeInstanceOf(WorkJobBusyError);
      await expect(
        executorB.execute(key, () =>
          Promise.reject(new Error('completed callback must not run')),
        ),
      ).resolves.toEqual({ canonical: 'winner' });
      expect(task).toHaveBeenCalledTimes(1);

      const persisted = await poolA.query<{
        result: Record<string, unknown>;
        claims: number;
      }>(
        `
          SELECT result,
                 (
                   SELECT count(*)::integer
                   FROM work_job_claims
                   WHERE event_id = $1 AND handler_version = $2
                 ) AS claims
          FROM work_job_results
          WHERE event_id = $1 AND handler_version = $2
        `,
        [key.eventId, key.handlerVersion],
      );
      expect(persisted.rows[0]).toEqual({
        result: { canonical: 'winner' },
        claims: 0,
      });
    } finally {
      await cleanup(poolA, eventId);
      await poolA.end();
      await poolB.end();
    }
  });

  it('fences an expired claim before reacquisition and rejects its stale token', async () => {
    const poolA = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const poolB = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const repositoryA = new PostgresWorkRepository(poolA);
    const repositoryB = new PostgresWorkRepository(poolB);
    const eventId = randomUUID();
    const key = jobKey(eventId);
    await insertEvent(poolA, eventId);

    try {
      const first = await repositoryA.acquire(key, 'crashed-worker', 25);
      expect(first.status).toBe('acquired');
      await poolB.query('SELECT pg_sleep(0.04)');
      if (first.status !== 'acquired') {
        throw new Error('expected initial acquisition');
      }

      await expect(
        repositoryA.renew(key, first.leaseToken, 30_000),
      ).resolves.toBe(false);
      await expect(
        repositoryA.complete(key, first.leaseToken, {
          outcome: 'succeeded',
          result: { staleBeforeReacquisition: true },
        }),
      ).rejects.toBeInstanceOf(WorkJobLeaseLostError);
      await expect(readBookkeeping(poolA, key)).resolves.toEqual({
        claims: 1,
        results: 0,
        deadLetters: 0,
      });

      const second = await repositoryB.acquire(key, 'recovery-worker', 30_000);
      expect(second.status).toBe('acquired');
      if (second.status !== 'acquired') {
        throw new Error('expected recovery acquisition');
      }

      await expect(
        repositoryA.complete(key, first.leaseToken, {
          outcome: 'succeeded',
          result: { stale: true },
        }),
      ).rejects.toBeInstanceOf(WorkJobLeaseLostError);
      await repositoryB.complete(key, second.leaseToken, {
        outcome: 'succeeded',
        result: { recovered: true },
      });
      await expect(
        repositoryA.acquire(key, 'reader', 30_000),
      ).resolves.toMatchObject({
        status: 'completed',
        record: { result: { recovered: true } },
      });
    } finally {
      await cleanup(poolA, eventId);
      await poolA.end();
      await poolB.end();
    }
  });

  it('renews a live PostgreSQL lease while the callback is still running', async () => {
    const poolA = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const poolB = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const repositoryA = new PostgresWorkRepository(poolA);
    const repositoryB = new PostgresWorkRepository(poolB);
    const eventId = randomUUID();
    const key = jobKey(eventId);
    await insertEvent(poolA, eventId);

    try {
      const executor = new DurableJobExecutor(repositoryA, {
        leaseOwner: 'heartbeat-worker',
        leaseMs: 120,
      });
      let finish: ((result: Record<string, unknown>) => void) | undefined;
      let started: (() => void) | undefined;
      const callbackStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const active = executor.execute(
        key,
        (signal) =>
          new Promise<Record<string, unknown>>((resolve, reject) => {
            finish = resolve;
            started?.();
            signal.addEventListener(
              'abort',
              () => {
                const reason = signal.reason as unknown;
                reject(
                  reason instanceof Error
                    ? reason
                    : new Error('job execution aborted'),
                );
              },
              { once: true },
            );
          }),
      );
      const observed = observe(active);

      await callbackStarted;
      await poolB.query('SELECT pg_sleep(0.35)');
      await expect(
        repositoryB.acquire(key, 'competing-worker', 30_000),
      ).resolves.toEqual({ status: 'busy' });
      const heartbeat = await poolA.query<{ renewed: boolean }>(
        `
          SELECT renewed_at > claimed_at AS renewed
          FROM work_job_claims
          WHERE event_id = $1 AND handler_version = $2
        `,
        [key.eventId, key.handlerVersion],
      );
      expect(heartbeat.rows[0]?.renewed).toBe(true);

      finish?.({ heartbeat: 'kept-lease' });
      await expect(observed).resolves.toEqual({
        status: 'fulfilled',
        value: { heartbeat: 'kept-lease' },
      });
    } finally {
      await cleanup(poolA, eventId);
      await poolA.end();
      await poolB.end();
    }
  });

  it('releases a transient PostgreSQL claim so another worker can retry', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const repository = new PostgresWorkRepository(pool);
    const eventId = randomUUID();
    const key = jobKey(eventId);
    await insertEvent(pool, eventId);

    try {
      const executor = new DurableJobExecutor(repository, {
        leaseOwner: 'transient-worker',
        leaseMs: 30_000,
      });
      const transient = new Error('provider temporarily unavailable');

      await expect(
        executor.execute(key, () => Promise.reject(transient)),
      ).rejects.toBe(transient);
      await expect(readBookkeeping(pool, key)).resolves.toEqual({
        claims: 0,
        results: 0,
        deadLetters: 0,
      });

      const retry = new DurableJobExecutor(repository, {
        leaseOwner: 'retry-worker',
        leaseMs: 30_000,
      });
      await expect(
        retry.execute(key, () => Promise.resolve({ retried: true })),
      ).resolves.toEqual({ retried: true });
    } finally {
      await cleanup(pool, eventId);
      await pool.end();
    }
  });

  it('atomically persists a redacted final-attempt failure in PostgreSQL', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const repository = new PostgresWorkRepository(pool);
    const eventId = randomUUID();
    const key = jobKey(eventId);
    await insertEvent(pool, eventId);

    try {
      const executor = new DurableJobExecutor(repository, {
        leaseOwner: 'final-attempt-worker',
        leaseMs: 30_000,
      });
      const rawFailure =
        'Bearer pg-secret-canary postgresql://worker:pg-password@db.internal/jobs https://api-user:pg-url-secret@example.invalid/callback?token=pg-query-secret';

      await expect(
        executor.execute(key, () => Promise.reject(new Error(rawFailure)), {
          code: 'JOB_ATTEMPTS_EXHAUSTED',
          attemptsMade: 8,
        }),
      ).rejects.toMatchObject({
        code: 'JOB_ATTEMPTS_EXHAUSTED',
        message: 'JOB_ATTEMPTS_EXHAUSTED',
      });
      await expect(readBookkeeping(pool, key)).resolves.toEqual({
        claims: 0,
        results: 1,
        deadLetters: 1,
      });
      const persisted = await pool.query<{
        result: Record<string, unknown>;
        failureCode: string;
        failureMessage: string;
        failure: Record<string, unknown>;
      }>(
        `
          SELECT
            result.result,
            dead_letter.failure_code AS "failureCode",
            dead_letter.failure_message AS "failureMessage",
            dead_letter.failure
          FROM work_job_results AS result
          JOIN work_dead_letters AS dead_letter
            ON dead_letter.event_id = result.event_id
           AND dead_letter.handler_version = result.handler_version
          WHERE result.event_id = $1 AND result.handler_version = $2
        `,
        [key.eventId, key.handlerVersion],
      );
      expect(persisted.rows[0]).toEqual({
        result: { code: 'JOB_ATTEMPTS_EXHAUSTED', attemptsMade: 8 },
        failureCode: 'JOB_ATTEMPTS_EXHAUSTED',
        failureMessage: 'JOB_ATTEMPTS_EXHAUSTED',
        failure: { attemptsMade: 8 },
      });
      const serialized = JSON.stringify(persisted.rows[0]);
      expect(serialized).not.toContain('pg-secret-canary');
      expect(serialized).not.toContain('pg-password');
      expect(serialized).not.toContain('pg-url-secret');
      expect(serialized).not.toContain('pg-query-secret');
    } finally {
      await cleanup(pool, eventId);
      await pool.end();
    }
  });

  it('rolls terminal completion back as a unit, then persists and replays it', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const repository = new PostgresWorkRepository(pool);
    const eventId = randomUUID();
    const key = jobKey(eventId);
    await insertEvent(pool, eventId);

    try {
      const acquisition = await repository.acquire(
        key,
        'terminal-worker',
        30_000,
      );
      expect(acquisition.status).toBe('acquired');
      if (acquisition.status !== 'acquired') {
        throw new Error('expected terminal claim');
      }

      await expect(
        repository.complete(key, acquisition.leaseToken, {
          outcome: 'terminal_failure',
          result: { code: 'INVALID_PROVIDER_RESPONSE' },
          deadLetter: {
            code: null as unknown as string,
            message: 'invalid provider response',
          },
        }),
      ).rejects.toMatchObject({ code: '23502' });
      await expect(readBookkeeping(pool, key)).resolves.toEqual({
        claims: 1,
        results: 0,
        deadLetters: 0,
      });

      await repository.complete(key, acquisition.leaseToken, {
        outcome: 'terminal_failure',
        result: { code: 'INVALID_PROVIDER_RESPONSE', responseVersion: 2 },
        deadLetter: {
          code: 'INVALID_PROVIDER_RESPONSE',
          message: 'invalid provider response',
          details: { responseVersion: 2 },
        },
      });
      await expect(readBookkeeping(pool, key)).resolves.toEqual({
        claims: 0,
        results: 1,
        deadLetters: 1,
      });
      const executor = new DurableJobExecutor(repository, {
        leaseOwner: 'terminal-replay',
        leaseMs: 30_000,
      });
      const callback = jest.fn();
      await expect(executor.execute(key, callback)).rejects.toMatchObject({
        code: 'INVALID_PROVIDER_RESPONSE',
        result: {
          code: 'INVALID_PROVIDER_RESPONSE',
          responseVersion: 2,
        },
      });
      expect(callback).not.toHaveBeenCalled();
    } finally {
      await cleanup(pool, eventId);
      await pool.end();
    }
  });

  it('completes a terminal result when its dead letter already exists and keeps handlers distinct', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const repository = new PostgresWorkRepository(pool);
    const eventId = randomUUID();
    const key = jobKey(eventId);
    await insertEvent(pool, eventId);

    try {
      await insertDeadLetter(pool, key, 'RECOVERED_TERMINAL_RESULT');
      const acquisition = await repository.acquire(
        key,
        'terminal-recovery-worker',
        30_000,
      );
      expect(acquisition.status).toBe('acquired');
      if (acquisition.status !== 'acquired') {
        throw new Error('expected terminal recovery claim');
      }

      await repository.complete(key, acquisition.leaseToken, {
        outcome: 'terminal_failure',
        result: { code: 'RECOVERED_TERMINAL_RESULT' },
        deadLetter: {
          code: 'RECOVERED_TERMINAL_RESULT',
          message: 'RECOVERED_TERMINAL_RESULT',
        },
      });
      await expect(readBookkeeping(pool, key)).resolves.toEqual({
        claims: 0,
        results: 1,
        deadLetters: 1,
      });
      await insertDeadLetter(
        pool,
        { ...key, handlerVersion: 'provider-handler-v2' },
        'SECOND_HANDLER_FAILURE',
      );
      const deadLetters = await pool.query<{ count: number }>(
        `
          SELECT count(*)::integer AS count
          FROM work_dead_letters
          WHERE event_id = $1
        `,
        [eventId],
      );
      expect(deadLetters.rows[0]?.count).toBe(2);
    } finally {
      await cleanup(pool, eventId);
      await pool.end();
    }
  });

  it('rejects a mismatched pre-existing dead letter and releases the claim', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const repository = new PostgresWorkRepository(pool);
    const eventId = randomUUID();
    const key = jobKey(eventId);
    await insertEvent(pool, eventId);

    try {
      await insertDeadLetter(pool, key, 'LEGACY_PARTIAL_FAILURE');
      const executor = new DurableJobExecutor(repository, {
        leaseOwner: 'terminal-conflict-worker',
        leaseMs: 30_000,
      });

      await expect(
        executor.execute(
          key,
          () => Promise.reject(new Error('new provider failure')),
          { code: 'NEW_TERMINAL_FAILURE', attemptsMade: 8 },
        ),
      ).rejects.toBeInstanceOf(WorkJobCompletionConflictError);
      await expect(readBookkeeping(pool, key)).resolves.toEqual({
        claims: 0,
        results: 0,
        deadLetters: 1,
      });
      const existing = await pool.query<{
        failureCode: string;
        failureMessage: string;
      }>(
        `
          SELECT
            failure_code AS "failureCode",
            failure_message AS "failureMessage"
          FROM work_dead_letters
          WHERE event_id = $1 AND handler_version = $2
        `,
        [key.eventId, key.handlerVersion],
      );
      expect(existing.rows[0]).toEqual({
        failureCode: 'LEGACY_PARTIAL_FAILURE',
        failureMessage: 'LEGACY_PARTIAL_FAILURE',
      });
    } finally {
      await cleanup(pool, eventId);
      await pool.end();
    }
  });

  it('requeries the committed result after the completion response is lost', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const repository = new PostgresWorkRepository(pool);
    const eventId = randomUUID();
    const key = jobKey(eventId);
    await insertEvent(pool, eventId);

    try {
      const responseLost = new Error('connection lost after COMMIT');
      const store = new CommitResponseLossStore(repository, responseLost);
      const executor = new DurableJobExecutor(store, {
        leaseOwner: 'response-loss-worker',
        leaseMs: 30_000,
      });
      const task = jest.fn().mockResolvedValue({ persisted: true });

      await expect(executor.execute(key, task)).rejects.toBe(responseLost);
      await expect(executor.execute(key, task)).resolves.toEqual({
        persisted: true,
      });
      expect(task).toHaveBeenCalledTimes(1);
      await expect(readBookkeeping(pool, key)).resolves.toEqual({
        claims: 0,
        results: 1,
        deadLetters: 0,
      });
    } finally {
      await cleanup(pool, eventId);
      await pool.end();
    }
  });
});

class CommitResponseLossStore implements JobExecutionStore {
  private loseResponse = true;

  constructor(
    private readonly delegate: JobExecutionStore,
    private readonly failure: Error,
  ) {}

  acquire(key: JobExecutionKey, leaseOwner: string, leaseMs: number) {
    return this.delegate.acquire(key, leaseOwner, leaseMs);
  }

  async complete(
    key: JobExecutionKey,
    leaseToken: string,
    completion: JobExecutionCompletion,
  ): Promise<void> {
    await this.delegate.complete(key, leaseToken, completion);
    if (this.loseResponse) {
      this.loseResponse = false;
      throw this.failure;
    }
  }

  renew(key: JobExecutionKey, leaseToken: string, leaseMs: number) {
    return this.delegate.renew(key, leaseToken, leaseMs);
  }

  release(key: JobExecutionKey, leaseToken: string) {
    return this.delegate.release(key, leaseToken);
  }
}

function observe<T>(
  promise: Promise<T>,
): Promise<
  { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }
> {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
}

function jobKey(eventId: string): JobExecutionKey {
  return { eventId, handlerVersion: 'provider-handler-v1' };
}

async function insertEvent(pool: Pool, eventId: string): Promise<void> {
  await pool.query(
    `
      INSERT INTO work_outbox_events (
        id,
        event_type,
        aggregate_type,
        aggregate_id,
        aggregate_version,
        payload_schema_version,
        payload
      )
      VALUES ($1, 'provider.requested', 'test', $2, 1, 1, '{}'::jsonb)
    `,
    [eventId, eventId],
  );
}

async function insertDeadLetter(
  pool: Pool,
  key: JobExecutionKey,
  code: string,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO work_dead_letters (
        id,
        event_id,
        handler_version,
        failure_code,
        failure_message,
        failure
      )
      VALUES ($1, $2, $3, $4, $4, '{}'::jsonb)
    `,
    [randomUUID(), key.eventId, key.handlerVersion, code],
  );
}

async function readBookkeeping(
  pool: Pool,
  key: JobExecutionKey,
): Promise<{ claims: number; results: number; deadLetters: number }> {
  const result = await pool.query<{
    claims: number;
    results: number;
    deadLetters: number;
  }>(
    `
      SELECT
        (
          SELECT count(*)::integer
          FROM work_job_claims
          WHERE event_id = $1 AND handler_version = $2
        ) AS claims,
        (
          SELECT count(*)::integer
          FROM work_job_results
          WHERE event_id = $1 AND handler_version = $2
        ) AS results,
        (
          SELECT count(*)::integer
          FROM work_dead_letters
          WHERE event_id = $1 AND handler_version = $2
        ) AS "deadLetters"
    `,
    [key.eventId, key.handlerVersion],
  );
  return result.rows[0];
}

async function cleanup(pool: Pool, eventId: string): Promise<void> {
  await pool.query('DELETE FROM work_dead_letters WHERE event_id = $1', [
    eventId,
  ]);
  await pool.query('DELETE FROM work_job_results WHERE event_id = $1', [
    eventId,
  ]);
  await pool.query('DELETE FROM work_job_claims WHERE event_id = $1', [
    eventId,
  ]);
  await pool.query('DELETE FROM work_outbox_events WHERE id = $1', [eventId]);
}
