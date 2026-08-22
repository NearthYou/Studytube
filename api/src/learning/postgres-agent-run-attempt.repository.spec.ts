import type { Pool, PoolClient } from 'pg';
import { LearningValidationError } from './learning.errors';
import type { AgentRun } from './learning.types';
import { PostgresAgentRunAttemptRepository } from './postgres-agent-run-attempt.repository';

describe('PostgresAgentRunAttemptRepository', () => {
  it('rejects an invalid worker lease before opening a transaction', async () => {
    const connect = jest.fn();
    const repository = new PostgresAgentRunAttemptRepository(
      { connect } as unknown as Pool,
      {
        requireOwnerRun: jest.fn(),
        recordTransition: jest.fn(),
      },
    );

    await expect(
      repository.claimRunAttempt(' ', 30_000),
    ).rejects.toBeInstanceOf(LearningValidationError);
    expect(connect).not.toHaveBeenCalled();
  });

  it('claims one locked candidate and commits the lease transition atomically', async () => {
    const run = { id: 'run-1' } as AgentRun;
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            runId: 'run-1',
            ownerId: 42,
            attemptId: 'attempt-1',
            attemptNumber: 2,
            runState: 'queued',
            runVersion: 3,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const release = jest.fn();
    const client = { query, release } as unknown as PoolClient;
    const requireOwnerRun = jest.fn().mockResolvedValue(run);
    const recordTransition = jest.fn().mockResolvedValue(undefined);
    const repository = new PostgresAgentRunAttemptRepository(
      {
        connect: jest.fn().mockResolvedValue(client),
      } as unknown as Pool,
      { requireOwnerRun, recordTransition },
    );

    const claimed = await repository.claimRunAttempt('worker-1', 30_000);

    expect(claimed).toMatchObject({
      run,
      attemptId: 'attempt-1',
      attemptNumber: 2,
    });
    expect(typeof claimed?.leaseToken).toBe('string');
    const beginCall = query.mock.calls[0] as [string];
    const [candidateSql] = query.mock.calls[1] as [string];
    const [, leaseValues] = query.mock.calls[2] as [string, unknown[]];
    const commitCall = query.mock.calls.at(-1) as [string];
    expect(beginCall).toEqual(['BEGIN']);
    expect(candidateSql).toContain('FOR UPDATE OF r, a SKIP LOCKED');
    expect(leaseValues).toEqual([
      'attempt-1',
      'worker-1',
      claimed?.leaseToken,
      30_000,
    ]);
    expect(recordTransition).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        runId: 'run-1',
        attemptId: 'attempt-1',
        fromState: 'queued',
        toState: 'running',
        version: 4,
        reasonCode: 'worker_claimed',
      }),
    );
    expect(requireOwnerRun).toHaveBeenCalledWith(client, 42, 'run-1');
    expect(commitCall).toEqual(['COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns lease_lost without mutating usage when the lease cannot be locked', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const release = jest.fn();
    const repository = new PostgresAgentRunAttemptRepository(
      {
        connect: jest.fn().mockResolvedValue({ query, release }),
      } as unknown as Pool,
      {
        requireOwnerRun: jest.fn(),
        recordTransition: jest.fn(),
      },
    );

    await expect(
      repository.reserveRunUsage({
        runId: 'run-1',
        attemptId: 'attempt-1',
        leaseToken: 'lease-1',
        expectedVersion: 2,
        usage: {
          toolCalls: 1,
          tokens: 10,
          estimatedCostUsd: 0.001,
        },
      }),
    ).resolves.toEqual({ status: 'lease_lost' });

    expect(query).toHaveBeenCalledTimes(3);
    const [lockSql] = query.mock.calls[1] as [string];
    const commitCall = query.mock.calls.at(-1) as [string];
    expect(lockSql).toContain('FOR UPDATE OF r, a');
    expect(commitCall).toEqual(['COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('treats an existing owner-scoped tool audit record as an idempotent success', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });
    const repository = new PostgresAgentRunAttemptRepository(
      { query } as unknown as Pool,
      {
        requireOwnerRun: jest.fn(),
        recordTransition: jest.fn(),
      },
    );

    await expect(
      repository.recordAgentToolCall({
        ownerId: 42,
        runId: 'run-1',
        attemptId: 'attempt-1',
        requestId: 'request-1',
        toolName: 'search_course_sources',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
        durationMs: 25,
        outcome: 'succeeded',
        source: 'agent-run-processor',
        input: { query: 'postgres lease' },
        output: null,
      }),
    ).resolves.toBe(true);

    expect(query).toHaveBeenCalledTimes(2);
    const [insertSql] = query.mock.calls[0] as [string];
    const [lookupSql, lookupValues] = query.mock.calls[1] as [
      string,
      unknown[],
    ];
    expect(insertSql).toContain('ON CONFLICT (run_id, request_id) DO NOTHING');
    expect(lookupSql).toContain('run.owner_id = $3');
    expect(lookupValues).toEqual(['run-1', 'request-1', 42]);
  });

  it('revalidates the active lease and context snapshot in one transaction', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ authorized: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const release = jest.fn();
    const repository = new PostgresAgentRunAttemptRepository(
      {
        connect: jest.fn().mockResolvedValue({ query, release }),
      } as unknown as Pool,
      {
        requireOwnerRun: jest.fn(),
        recordTransition: jest.fn(),
      },
    );

    await expect(
      repository.authorizeAgentMcpCall({
        ownerId: 42,
        runId: '11111111-1111-4111-8111-111111111111',
        attemptId: '22222222-2222-4222-8222-222222222222',
        leaseToken: '33333333-3333-4333-8333-333333333333',
        contextSnapshotId: '11111111-1111-4111-8111-111111111111',
        capability: 'learning:evidence:search',
      }),
    ).resolves.toBe(true);

    const [sql, values] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('run.owner_id = $1');
    expect(sql).toContain("run.state = 'running'");
    expect(sql).toContain("attempt.state = 'running'");
    expect(sql).toContain('attempt.lease_token = $4::uuid');
    expect(sql).toContain('attempt.lease_expires_at > statement_timestamp()');
    expect(sql).toContain('learning_retrieval_context_snapshots');
    expect(sql).toContain('snapshot.agent_run_id = $5::uuid');
    expect(values).toEqual([
      42,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(query.mock.calls[0]).toEqual(['BEGIN']);
    expect(query.mock.calls[2]).toEqual(['COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
