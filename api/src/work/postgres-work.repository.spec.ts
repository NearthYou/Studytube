import type { Pool } from 'pg';
import { WorkLeaseLostError, WorkReplayConflictError } from './work.repository';
import { PostgresWorkRepository } from './postgres-work.repository';

type RepositoryContract = {
  appendOutboxEvent(event: {
    id: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    payloadSchemaVersion: number;
    payload: object;
  }): Promise<void>;
  claimOutboxBatch(
    limit: number,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<Array<{ id: string; leaseToken: string; payload: object }>>;
  ackOutboxEvent(id: string, leaseToken: string): Promise<void>;
  retryOutboxEvent(
    id: string,
    leaseToken: string,
    handlerVersion: string,
    failure: {
      code: string;
      message: string;
      retryDelayMs: number;
      details?: object;
    },
  ): Promise<'retry_scheduled' | 'dead_lettered'>;
  findJobResult(
    eventId: string,
    handlerVersion: string,
  ): Promise<{
    id: string;
    eventId: string;
    handlerVersion: string;
    outcome: 'succeeded' | 'terminal_failure';
    result: object;
  } | null>;
  recordJobResult(result: {
    id: string;
    eventId: string;
    handlerVersion: string;
    outcome: 'succeeded' | 'terminal_failure';
    result: object;
  }): Promise<boolean>;
  recordDeadLetter(input: {
    id: string;
    eventId: string;
    handlerVersion: string;
    code: string;
    message: string;
    details?: object;
  }): Promise<boolean>;
  replayDeadLetter(command: {
    deadLetterId: string;
    actorId: number | null;
    reason: string;
  }): Promise<{ auditId: string; eventId: string }>;
};

describe('PostgresWorkRepository', () => {
  it('appends a schema-versioned event without altering its payload', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresWorkRepository({ query } as unknown as Pool);

    await (repository as unknown as RepositoryContract).appendOutboxEvent({
      id: '11111111-1111-4111-8111-111111111111',
      eventType: 'video_asset.requested',
      aggregateType: 'post',
      aggregateId: '42',
      aggregateVersion: 1,
      payloadSchemaVersion: 1,
      payload: { postId: 42, videoUrl: 'https://youtu.be/example' },
    });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO work_outbox_events');
    expect(values).toEqual([
      '11111111-1111-4111-8111-111111111111',
      'video_asset.requested',
      'post',
      '42',
      1,
      1,
      { postId: 42, videoUrl: 'https://youtu.be/example' },
      {
        'x-studytube-job-id': '11111111-1111-4111-8111-111111111111',
      },
      null,
      null,
      8,
    ]);
  });

  it('claims eligible work with a database lock and an opaque lease token', async () => {
    const query = jest.fn().mockImplementation((sql: string) => {
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toContain('lease_expires_at');
      return {
        rows: [
          {
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
          },
        ],
      };
    });
    const repository = new PostgresWorkRepository({ query } as unknown as Pool);

    const claimed = await (
      repository as unknown as RepositoryContract
    ).claimOutboxBatch(10, 'relay-a', 30_000);

    expect(claimed).toEqual([
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        leaseToken: '22222222-2222-4222-8222-222222222222',
        payload: { postId: 42 },
      }),
    ]);
  });

  it('rejects acknowledgement after ownership of the lease changed', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresWorkRepository({ query } as unknown as Pool);

    await expect(
      (repository as unknown as RepositoryContract).ackOutboxEvent(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toEqual(new WorkLeaseLostError());
  });

  it('atomically moves an exhausted event to the dead letter table', async () => {
    const query = jest.fn().mockImplementation((sql: string) => {
      expect(sql).toContain('INSERT INTO work_dead_letters');
      expect(sql).toContain('attempt_count >= max_attempts');
      return { rows: [{ outcome: 'dead_lettered' }] };
    });
    const repository = new PostgresWorkRepository({ query } as unknown as Pool);

    await expect(
      (repository as unknown as RepositoryContract).retryOutboxEvent(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'video-asset-v1',
        {
          code: 'CAPTION_PROVIDER_TIMEOUT',
          message: 'caption provider timed out',
          retryDelayMs: 5_000,
        },
      ),
    ).resolves.toBe('dead_lettered');
  });

  it('records a handler result once for duplicate delivery', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'result-id' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresWorkRepository({ query } as unknown as Pool);
    const result = {
      id: '33333333-3333-4333-8333-333333333333',
      eventId: '11111111-1111-4111-8111-111111111111',
      handlerVersion: 'video-asset-v1',
      outcome: 'succeeded' as const,
      result: { assetId: 7 },
    };

    await expect(
      (repository as unknown as RepositoryContract).recordJobResult(result),
    ).resolves.toBe(true);
    await expect(
      (repository as unknown as RepositoryContract).recordJobResult(result),
    ).resolves.toBe(false);
  });

  it('loads the persisted result before repeating a handler side effect', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          eventId: '11111111-1111-4111-8111-111111111111',
          handlerVersion: 'video-asset-v1',
          outcome: 'succeeded',
          result: { assetId: 7 },
        },
      ],
    });
    const repository = new PostgresWorkRepository({ query } as unknown as Pool);

    await expect(
      (repository as unknown as RepositoryContract).findJobResult(
        '11111111-1111-4111-8111-111111111111',
        'video-asset-v1',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: 'succeeded',
        result: { assetId: 7 },
      }),
    );
  });

  it('records one dead letter for an exhausted worker event', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'dead-letter-id' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresWorkRepository({ query } as unknown as Pool);
    const input = {
      id: '44444444-4444-4444-8444-444444444444',
      eventId: '11111111-1111-4111-8111-111111111111',
      handlerVersion: 'video-asset-v1',
      code: 'CAPTION_PROVIDER_TIMEOUT',
      message: 'caption provider timed out',
      details: { attemptsMade: 8 },
    };

    await expect(
      (repository as unknown as RepositoryContract).recordDeadLetter(input),
    ).resolves.toBe(true);
    await expect(
      (repository as unknown as RepositoryContract).recordDeadLetter(input),
    ).resolves.toBe(false);

    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain('INSERT INTO work_dead_letters');
    expect(sql).toContain('ON CONFLICT (event_id) DO NOTHING');
  });

  it('rejects replay when another actor already replayed the dead letter', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresWorkRepository({ query } as unknown as Pool);

    await expect(
      (repository as unknown as RepositoryContract).replayDeadLetter({
        deadLetterId: '44444444-4444-4444-8444-444444444444',
        actorId: 9,
        reason: 'provider recovered',
      }),
    ).rejects.toEqual(new WorkReplayConflictError());
  });
});
