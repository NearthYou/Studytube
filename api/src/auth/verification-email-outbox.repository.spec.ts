import { PostgresVerificationEmailOutboxRepository } from './verification-email-outbox.repository';

const NOW = new Date('2026-07-29T00:00:00.000Z');
const LEASE_TOKEN = '22222222-2222-4222-8222-222222222222';
const OUTBOX_ID = '11111111-1111-4111-8111-111111111111';
const PENDING_ID = '33333333-3333-4333-8333-333333333333';

describe('PostgresVerificationEmailOutboxRepository', () => {
  it('claims one live unconsumed email with SKIP LOCKED and a fresh lease', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: OUTBOX_ID,
          pendingRegistrationId: PENDING_ID,
          recipient: 'ada@example.com',
          idempotencyKey: `email-verification/${PENDING_ID}`,
          sender: 'no-reply@studytube.example',
          publicOrigin: 'https://studytube.example',
          templateVersion: 'v1',
          locale: 'ko',
          subject: 'StudyTube 이메일을 인증해 주세요',
          payloadHash: Buffer.alloc(32, 7),
          keyVersion: 1,
          attempt: 1,
          leaseToken: LEASE_TOKEN,
          leaseExpiresAt: new Date('2026-07-29T00:00:30.000Z'),
        },
      ],
      rowCount: 1,
    });
    const repository = new PostgresVerificationEmailOutboxRepository(
      { query } as never,
      { uuid: () => LEASE_TOKEN },
    );

    await expect(
      repository.claimNext({ now: NOW, leaseMs: 30_000, maxAttempts: 5 }),
    ).resolves.toMatchObject({
      id: OUTBOX_ID,
      pendingRegistrationId: PENDING_ID,
      keyVersion: 1,
      attempt: 1,
      leaseToken: LEASE_TOKEN,
    });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FOR UPDATE OF outbox SKIP LOCKED');
    expect(sql).toContain('pending.verified_at IS NULL');
    expect(sql).toContain('pending.verification_expires_at > $1');
    expect(sql).toContain('pending.attempt_count < pending.max_attempts');
    expect(sql).toContain('outbox.attempts < $4');
    expect(
      sql.split(
        '(outbox.lease_token IS NULL OR outbox.lease_expires_at <= $1)',
      ),
    ).toHaveLength(3);
    expect(sql).toContain('SET lease_token = $2');
    expect(sql).toContain('attempts = outbox.attempts + 1');
    expect(sql).toContain("THEN 'verification_expired'");
    expect(sql).toContain("THEN 'verification_attempts_exhausted'");
    expect(values).toEqual([
      NOW,
      LEASE_TOKEN,
      new Date('2026-07-29T00:00:30.000Z'),
      5,
    ]);
  });

  it('acknowledges only the exact live lease token', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: OUTBOX_ID }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const repository = new PostgresVerificationEmailOutboxRepository({
      query,
    } as never);
    const command = {
      id: OUTBOX_ID,
      leaseToken: LEASE_TOKEN,
      providerMessageId: 'ses-message-1',
      sentAt: NOW,
    };

    await expect(repository.acknowledge(command)).resolves.toBe('acknowledged');
    await expect(repository.acknowledge(command)).resolves.toBe('lease_lost');

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('lease_token = $2');
    expect(sql).toContain('lease_expires_at > $3');
    expect(sql).toContain('lease_token = NULL');
    expect(values).toEqual([OUTBOX_ID, LEASE_TOKEN, NOW, 'ses-message-1']);
  });

  it('schedules retry or marks dead letter without accepting secret error data', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: OUTBOX_ID }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: OUTBOX_ID }], rowCount: 1 });
    const repository = new PostgresVerificationEmailOutboxRepository({
      query,
    } as never);
    const retryAt = new Date('2026-07-29T00:00:05.000Z');

    await expect(
      repository.release({
        id: OUTBOX_ID,
        leaseToken: LEASE_TOKEN,
        now: NOW,
        errorCode: 'ses_throttled',
        availableAt: retryAt,
      }),
    ).resolves.toBe('retry_scheduled');
    await expect(
      repository.release({
        id: OUTBOX_ID,
        leaseToken: LEASE_TOKEN,
        now: NOW,
        errorCode: 'ses_rejected',
        failedAt: NOW,
      }),
    ).resolves.toBe('dead_lettered');
    await expect(
      repository.release({
        id: OUTBOX_ID,
        leaseToken: LEASE_TOKEN,
        now: NOW,
        errorCode: 'raw token: secret',
        availableAt: retryAt,
      }),
    ).rejects.toThrow(/error code/i);

    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    const retrySql = calls[0][0];
    const deadLetterSql = calls[1][0];
    expect(retrySql).toContain('available_at = $5');
    expect(retrySql).toContain('lease_expires_at > $3');
    expect(retrySql).toContain('lease_token = NULL');
    expect(deadLetterSql).toContain('failed_at = $5');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
