import type { Pool } from 'pg';
import { ProviderBudgetUnavailableError } from './provider-budget.repository';
import {
  PostgresProviderBudgetRepository,
  providerWorkKey,
} from './postgres-provider-budget.repository';

const command = {
  userId: 7,
  provider: 'youtube' as const,
  canonicalVideoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  requestedAudioSeconds: 600,
};

describe('PostgresProviderBudgetRepository', () => {
  it('keeps one opening repair distinct from the original provider work', () => {
    expect(providerWorkKey(command)).toBe('youtube:dQw4w9WgXcQ:0-600');
    expect(providerWorkKey(command)).not.toBe(
      providerWorkKey({
        ...command,
        processingPurpose: 'initial-gap-repair-v1',
      }),
    );
    expect(
      providerWorkKey({
        ...command,
        processingPurpose: 'initial-gap-repair-v1',
      }),
    ).toContain('initial-gap-repair-v1');
  });

  it('rejects a kill switch before opening a transaction', async () => {
    const connect = jest.fn();
    const repository = new PostgresProviderBudgetRepository(
      { connect } as unknown as Pool,
      policy({ enabled: false }),
    );

    await expect(repository.reserve(command)).rejects.toEqual(
      new ProviderBudgetUnavailableError('DISABLED'),
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns an existing user subscription without inserting another work item', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            reservationId: '41',
            workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
            admission: 'joined',
            reservedAudioSeconds: 600,
            subscriptionCreated: false,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const release = jest.fn();
    const repository = new PostgresProviderBudgetRepository(
      {
        connect: jest.fn().mockResolvedValue({ query, release }),
      } as unknown as Pool,
      policy(),
    );

    await expect(repository.reserve(command)).resolves.toEqual({
      reservationId: '41',
      workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
      admission: 'joined',
      reservedAudioSeconds: 600,
      subscriptionCreated: false,
    });
    expect(sqlAt(query, 0)).toBe('BEGIN');
    expect(sqlAt(query, 1)).toContain('pg_advisory_xact_lock');
    expect(sqlAt(query, 2)).toContain('provider_subscription_reservations');
    expect(sqlAt(query, 2)).toContain(
      "work.state IN ('reserved', 'committed')",
    );
    expect(sqlAt(query, 2)).toContain('FOR UPDATE OF work');
    expect(sqlAt(query, -1)).toBe('COMMIT');
    expect(
      sqlCalls(query).some((sql) =>
        sql.includes('INSERT INTO work_outbox_events'),
      ),
    ).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('locks the work row before releasing a subscription', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
            workReservationId: '31',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ reservationId: '41' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresProviderBudgetRepository(
      {
        connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }),
      } as unknown as Pool,
      policy(),
    );

    await expect(repository.releaseSubscription(7, '41')).resolves.toBe(true);
    expect(sqlAt(query, 1)).toContain('FOR UPDATE OF work');
    expect(sqlAt(query, 2)).toContain(
      'UPDATE provider_subscription_reservations',
    );
    expect(sqlAt(query, 3)).toContain('UPDATE provider_work_reservations');
  });

  it('rolls back without inserting durable work when a daily cap is exhausted', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            globalAudioSeconds: 3_500,
            globalCostMicrounits: 0,
            userAudioSeconds: 0,
            globalConcurrentWorks: 0,
            userConcurrentWorks: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const release = jest.fn();
    const repository = new PostgresProviderBudgetRepository(
      {
        connect: jest.fn().mockResolvedValue({ query, release }),
      } as unknown as Pool,
      policy({ maxGlobalDailyAudioSeconds: 3_600 }),
    );

    await expect(repository.reserve(command)).rejects.toMatchObject({
      code: 'PROVIDER_BUDGET_UNAVAILABLE',
      reason: 'DAILY_CAP',
    });
    expect(sqlAt(query, -1)).toBe('ROLLBACK');
    expect(sqlAt(query, 3)).toContain('FOR UPDATE');
    expect(sqlAt(query, 4)).toContain(
      "state = 'committed' AND actual_cost_microunits = 0 THEN 0",
    );
    expect(sqlAt(query, 4)).toContain(
      'JOIN provider_work_reservations AS work',
    );
    expect(
      sqlCalls(query).some((sql) =>
        sql.includes('INSERT INTO work_outbox_events'),
      ),
    ).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects before durable work when the estimated daily cost cap is exhausted', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            globalAudioSeconds: 0,
            globalCostMicrounits: 3_500,
            userAudioSeconds: 0,
            globalConcurrentWorks: 0,
            userConcurrentWorks: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresProviderBudgetRepository(
      {
        connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }),
      } as unknown as Pool,
      policy({ maxGlobalDailyCostMicrounits: 3_600 }),
    );

    await expect(repository.reserve(command)).rejects.toMatchObject({
      reason: 'DAILY_CAP',
    });
    expect(
      sqlCalls(query).some((sql) =>
        sql.includes('INSERT INTO work_outbox_events'),
      ),
    ).toBe(false);
  });

  it('rejects before durable work when the monthly one-dollar cap is exhausted', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            globalAudioSeconds: 0,
            globalCostMicrounits: 0,
            globalMonthlyCostMicrounits: 990_000,
            userAudioSeconds: 0,
            globalConcurrentWorks: 0,
            userConcurrentWorks: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresProviderBudgetRepository(
      {
        connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }),
      } as unknown as Pool,
      {
        ...policy(),
        microsPerAudioSecond: 50,
        maxGlobalDailyCostMicrounits: 100_000,
        maxGlobalMonthlyCostMicrounits: 1_000_000,
      },
    );

    await expect(repository.reserve(command)).rejects.toMatchObject({
      reason: 'MONTHLY_CAP',
    });
    expect(
      sqlCalls(query).some((sql) =>
        sql.includes("date_trunc('month', $2::date)"),
      ),
    ).toBe(true);
  });
});

function policy(
  overrides: Partial<
    ConstructorParameters<typeof PostgresProviderBudgetRepository>[1]
  > = {},
) {
  return {
    enabled: true,
    maxGlobalDailyAudioSeconds: 28_800,
    maxUserDailyAudioSeconds: 7_200,
    maxConcurrentWorks: 4,
    maxConcurrentWorksPerUser: 1,
    microsPerAudioSecond: 1,
    maxGlobalDailyCostMicrounits: 28_800,
    maxGlobalMonthlyCostMicrounits: 1_000_000,
    ...overrides,
  };
}

function sqlAt(query: { mock: { calls: unknown[][] } }, index: number): string {
  const call = index < 0 ? query.mock.calls.at(index) : query.mock.calls[index];
  return typeof call?.[0] === 'string' ? call[0] : '';
}

function sqlCalls(query: { mock: { calls: unknown[][] } }): string[] {
  return query.mock.calls.map((call) =>
    typeof call[0] === 'string' ? call[0] : '',
  );
}
