import type { Pool, QueryResult } from 'pg';
import { PostgresWorkRepository } from './postgres-work.repository';
import { WorkJobCompletionConflictError } from './work.errors';

const KEY = {
  eventId: '11111111-1111-4111-8111-111111111111',
  handlerVersion: 'video-asset-v1',
};

describe('Postgres job execution store', () => {
  it('serializes acquisition in a short transaction and returns an opaque claim token', async () => {
    const client = transactionClient([
      rows([]),
      rows([{ leaseToken: '22222222-2222-4222-8222-222222222222' }]),
    ]);
    const repository = new PostgresWorkRepository(
      poolWithClient(client) as unknown as Pool,
    );

    await expect(repository.acquire(KEY, 'worker-a', 30_000)).resolves.toEqual({
      status: 'acquired',
      leaseToken: '22222222-2222-4222-8222-222222222222',
    });

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toEqual([
      'BEGIN',
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('FROM work_job_results'),
      expect.stringContaining('INSERT INTO work_job_claims'),
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back the result and claim deletion when terminal dead-letter persistence fails', async () => {
    const failure = new Error('dead-letter insert failed');
    const client = {
      query: jest.fn((sql: string) => {
        if (sql.includes('DELETE FROM work_job_claims')) {
          return Promise.resolve(rows([{ eventId: KEY.eventId }]));
        }
        if (sql.includes('INSERT INTO work_dead_letters')) {
          return Promise.reject(failure);
        }
        return Promise.resolve(rows([]));
      }),
      release: jest.fn(),
    };
    const repository = new PostgresWorkRepository(
      poolWithClient(client) as unknown as Pool,
    );

    await expect(
      repository.complete(KEY, '22222222-2222-4222-8222-222222222222', {
        outcome: 'terminal_failure',
        result: { code: 'INVALID_PROVIDER_RESPONSE' },
        deadLetter: {
          code: 'INVALID_PROVIDER_RESPONSE',
          message: 'invalid provider response',
        },
      }),
    ).rejects.toBe(failure);

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back terminal completion when an existing dead letter disagrees', async () => {
    const client = {
      query: jest.fn((sql: string) => {
        if (sql.includes('DELETE FROM work_job_claims')) {
          return Promise.resolve(rows([{ eventId: KEY.eventId }]));
        }
        if (sql.includes('INSERT INTO work_dead_letters')) {
          return Promise.resolve(rows([]));
        }
        return Promise.resolve(rows([]));
      }),
      release: jest.fn(),
    };
    const repository = new PostgresWorkRepository(
      poolWithClient(client) as unknown as Pool,
    );

    await expect(
      repository.complete(KEY, '22222222-2222-4222-8222-222222222222', {
        outcome: 'terminal_failure',
        result: { code: 'NEW_TERMINAL_FAILURE' },
        deadLetter: {
          code: 'NEW_TERMINAL_FAILURE',
          message: 'new terminal failure',
        },
      }),
    ).rejects.toBeInstanceOf(WorkJobCompletionConflictError);

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    const deadLetterInsert = statements.find((sql) =>
      sql.includes('INSERT INTO work_dead_letters'),
    );
    expect(deadLetterInsert).toContain(
      'ON CONFLICT (event_id, handler_version) DO UPDATE',
    );
    expect(deadLetterInsert).toContain(
      'work_dead_letters.failure_code = EXCLUDED.failure_code',
    );
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

function poolWithClient(client: { query: jest.Mock; release: jest.Mock }): {
  connect: jest.Mock;
} {
  return { connect: jest.fn().mockResolvedValue(client) };
}

function transactionClient(results: QueryResult[]): {
  query: jest.Mock;
  release: jest.Mock;
} {
  const queue = [...results];
  return {
    query: jest.fn((sql: string) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
        return Promise.resolve(rows([]));
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return Promise.resolve(rows([]));
      }
      return Promise.resolve(queue.shift() ?? rows([]));
    }),
    release: jest.fn(),
  };
}

function rows<T extends Record<string, unknown>>(value: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: value.length,
    oid: 0,
    fields: [],
    rows: value,
  };
}
