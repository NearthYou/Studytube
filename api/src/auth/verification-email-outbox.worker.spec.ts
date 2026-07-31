import { createHash } from 'node:crypto';
import { reconstructVerificationToken } from './auth-token';
import type {
  ClaimedVerificationEmail,
  ReleaseVerificationEmailCommand,
  VerificationEmailOutboxRepository,
} from './verification-email-outbox.repository';
import { VerificationEmailOutboxWorker } from './verification-email-outbox.worker';
import {
  SesV2VerificationEmailSender,
  VerificationEmailDeliveryError,
} from './verification-email-sender';
import type { VerificationEmailSender } from './verification-email-sender';
import { renderVerificationEmail } from './verification-email';

const NOW = new Date('2026-07-29T00:00:00.000Z');
const PEPPER = 'verification-email-worker-pepper';
const PENDING_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM = claim();

describe('VerificationEmailOutboxWorker', () => {
  it('reconstructs the fragment link, verifies the payload, sends, and acks the exact lease', async () => {
    const repository = repositoryWith(CLAIM);
    const sent: Array<{ idempotencyKey: string; text: string }> = [];
    const sender: VerificationEmailSender = {
      send: (message) => {
        sent.push({
          idempotencyKey: message.idempotencyKey,
          text: message.text,
        });
        return Promise.resolve({ providerMessageId: 'ses-message-1' });
      },
    };
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const worker = workerWith(repository, sender, logs);

    await expect(worker.deliverOnce()).resolves.toBe('sent');

    expect(sent).toHaveLength(1);
    expect(sent[0]?.idempotencyKey).toBe(CLAIM.idempotencyKey);
    expect(sent[0]?.text).toContain('/signup/verify#verification=v1.');
    expect(repository.acknowledge).toHaveBeenCalledWith({
      id: CLAIM.id,
      leaseToken: CLAIM.leaseToken,
      providerMessageId: 'ses-message-1',
      sentAt: NOW,
    });
    expect(logs).toEqual([
      {
        event: 'verification_email_sent',
        fields: {
          outbox_id: CLAIM.id,
          attempt: 1,
          provider_message_id: 'ses-message-1',
          delivery_semantics: 'at_least_once',
        },
      },
    ]);
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(
      reconstructVerificationToken(PENDING_ID, 'v1', PEPPER),
    );
    expect(serializedLogs).not.toContain(CLAIM.recipient);
  });

  it('dead-letters a payload mismatch without calling the provider', async () => {
    const repository = repositoryWith({
      ...CLAIM,
      payloadHash: Buffer.alloc(32, 99),
    });
    const send = jest.fn<
      ReturnType<VerificationEmailSender['send']>,
      Parameters<VerificationEmailSender['send']>
    >();
    const sender: VerificationEmailSender = { send };
    const worker = workerWith(repository, sender);

    await expect(worker.deliverOnce()).resolves.toBe('dead_lettered');

    expect(send).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledWith({
      id: CLAIM.id,
      leaseToken: CLAIM.leaseToken,
      now: NOW,
      errorCode: 'payload_mismatch',
      failedAt: NOW,
    });
  });

  it('uses bounded exponential backoff and dead-letters the final attempt', async () => {
    const repository = repositoryWith({ ...CLAIM, attempt: 2 });
    const sender: VerificationEmailSender = {
      send: jest
        .fn()
        .mockRejectedValue(
          new VerificationEmailDeliveryError('ses_throttled', true),
        ),
    };
    const worker = workerWith(repository, sender);

    await expect(worker.deliverOnce()).resolves.toBe('retry_scheduled');
    expect(repository.release).toHaveBeenCalledWith({
      id: CLAIM.id,
      leaseToken: CLAIM.leaseToken,
      now: NOW,
      errorCode: 'ses_throttled',
      availableAt: new Date('2026-07-29T00:00:02.000Z'),
    });

    repository.claimNext.mockResolvedValueOnce({ ...CLAIM, attempt: 5 });
    await expect(worker.deliverOnce()).resolves.toBe('dead_lettered');
    const releaseCalls = repository.release.mock.calls as unknown as Array<
      [ReleaseVerificationEmailCommand]
    >;
    const terminal = releaseCalls[1][0];
    expect(terminal).toMatchObject({
      errorCode: 'ses_throttled',
      failedAt: NOW,
    });
    expect(terminal.availableAt).toBeUndefined();
  });

  it('dead-letters SES access denial without persisting provider details', async () => {
    const providerDetail =
      'credential-canary https://provider.invalid/signup/verify#verification=url-canary';
    const repository = repositoryWith(CLAIM);
    const sender = new SesV2VerificationEmailSender(
      {
        send: jest.fn().mockRejectedValue(
          Object.assign(new Error(providerDetail), {
            name: 'AccessDeniedException',
            $metadata: { httpStatusCode: 403 },
          }),
        ),
      } as never,
      5_000,
    );
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const worker = workerWith(repository, sender, logs);

    await expect(worker.deliverOnce()).resolves.toBe('dead_lettered');

    expect(repository.release).toHaveBeenCalledWith({
      id: CLAIM.id,
      leaseToken: CLAIM.leaseToken,
      now: NOW,
      errorCode: 'ses_access_denied',
      failedAt: NOW,
    });
    expect(logs).toEqual([
      {
        event: 'verification_email_delivery_failed',
        fields: {
          outbox_id: CLAIM.id,
          attempt: 1,
          error_code: 'ses_access_denied',
          outcome: 'dead_lettered',
          delivery_semantics: 'at_least_once',
          duplicate_delivery_possible: false,
        },
      },
    ]);
    const persisted = JSON.stringify({
      release: repository.release.mock.calls,
      logs,
    });
    expect(persisted).not.toContain('credential-canary');
    expect(persisted).not.toContain('url-canary');
  });

  it('marks an ambiguous provider timeout as a duplicate-capable retry', async () => {
    const repository = repositoryWith(CLAIM);
    const sender: VerificationEmailSender = {
      send: jest
        .fn()
        .mockRejectedValue(
          new VerificationEmailDeliveryError('ses_timeout', true),
        ),
    };
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const worker = workerWith(repository, sender, logs);

    await expect(worker.deliverOnce()).resolves.toBe('retry_scheduled');

    expect(logs).toEqual([
      {
        event: 'verification_email_delivery_failed',
        fields: {
          outbox_id: CLAIM.id,
          attempt: 1,
          error_code: 'ses_timeout',
          outcome: 'retry_scheduled',
          delivery_semantics: 'at_least_once',
          duplicate_delivery_possible: true,
        },
      },
    ]);
  });

  it('times out a hanging provider and ignores its late success', async () => {
    jest.useFakeTimers();
    try {
      let finishSend:
        | ((value: { providerMessageId: string }) => void)
        | undefined;
      const repository = repositoryWith(CLAIM);
      const sender: VerificationEmailSender = {
        send: () =>
          new Promise((resolve) => {
            finishSend = resolve;
          }),
      };
      const logs: Array<{ event: string; fields: Record<string, unknown> }> =
        [];
      const worker = workerWith(repository, sender, logs, {
        sendTimeoutMs: 25,
      });

      const delivery = worker.deliverOnce();
      await jest.advanceTimersByTimeAsync(25);

      await expect(delivery).resolves.toBe('retry_scheduled');
      expect(repository.release).toHaveBeenCalledWith({
        id: CLAIM.id,
        leaseToken: CLAIM.leaseToken,
        now: NOW,
        errorCode: 'delivery_timeout',
        availableAt: new Date('2026-07-29T00:00:01.000Z'),
      });
      expect(logs[0]?.fields).toMatchObject({
        error_code: 'delivery_timeout',
        duplicate_delivery_possible: true,
      });

      finishSend?.({ providerMessageId: 'late-provider-message' });
      await Promise.resolve();
      expect(repository.acknowledge).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports duplicate risk when SES accepted the message but the lease ack is lost', async () => {
    const repository = repositoryWith(CLAIM);
    repository.acknowledge.mockResolvedValueOnce('lease_lost');
    const sender: VerificationEmailSender = {
      send: jest.fn().mockResolvedValue({ providerMessageId: 'ses-message-1' }),
    };
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const worker = workerWith(repository, sender, logs);

    await expect(worker.deliverOnce()).resolves.toBe('lease_lost');

    expect(logs).toEqual([
      {
        event: 'verification_email_ack_lease_lost',
        fields: {
          outbox_id: CLAIM.id,
          attempt: 1,
          provider_message_id: 'ses-message-1',
          delivery_semantics: 'at_least_once',
          duplicate_delivery_possible: true,
        },
      },
    ]);
  });

  it('stops claiming and awaits the in-flight provider call on shutdown', async () => {
    jest.useFakeTimers();
    let finishSend:
      | ((value: { providerMessageId: string }) => void)
      | undefined;
    const repository = repositoryWith(CLAIM);
    const sender: VerificationEmailSender = {
      send: () =>
        new Promise((resolve) => {
          finishSend = resolve;
        }),
    };
    const worker = workerWith(repository, sender, [], { pollIntervalMs: 10 });

    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    const shutdown = worker.onModuleDestroy();
    let stopped = false;
    void shutdown.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishSend?.({ providerMessageId: 'ses-message-1' });
    await shutdown;
    await jest.advanceTimersByTimeAsync(100);
    expect(repository.claimNext).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

function claim(): ClaimedVerificationEmail {
  const verificationToken = reconstructVerificationToken(
    PENDING_ID,
    'v1',
    PEPPER,
  );
  const input = {
    pendingRegistrationId: PENDING_ID,
    verificationToken,
    recipient: 'ada@example.com',
    sender: 'no-reply@studytube.example',
    publicOrigin: 'https://studytube.example',
    templateVersion: 'v1',
    locale: 'ko',
    subject: 'StudyTube 이메일을 인증해 주세요',
  };
  const rendered = renderVerificationEmail(input);
  return {
    id: '22222222-2222-4222-8222-222222222222',
    pendingRegistrationId: PENDING_ID,
    recipient: input.recipient,
    idempotencyKey: `email-verification/${PENDING_ID}`,
    sender: input.sender,
    publicOrigin: input.publicOrigin,
    templateVersion: input.templateVersion,
    locale: input.locale,
    subject: input.subject,
    payloadHash: createHash('sha256')
      .update(rendered.canonicalPayload, 'utf8')
      .digest(),
    keyVersion: 1,
    attempt: 1,
    leaseToken: '33333333-3333-4333-8333-333333333333',
    leaseExpiresAt: new Date('2026-07-29T00:00:30.000Z'),
  };
}

function repositoryWith(claimed: ClaimedVerificationEmail) {
  return {
    claimNext: jest.fn().mockResolvedValue(claimed),
    acknowledge: jest.fn().mockResolvedValue('acknowledged'),
    release: jest
      .fn()
      .mockImplementation((command: ReleaseVerificationEmailCommand) =>
        Promise.resolve(command.failedAt ? 'dead_lettered' : 'retry_scheduled'),
      ),
  } satisfies jest.Mocked<VerificationEmailOutboxRepository>;
}

function workerWith(
  repository: ReturnType<typeof repositoryWith>,
  sender: VerificationEmailSender,
  logs: Array<{ event: string; fields: Record<string, unknown> }> = [],
  overrides: Partial<
    ConstructorParameters<typeof VerificationEmailOutboxWorker>[2]
  > = {},
) {
  return new VerificationEmailOutboxWorker(repository, sender, {
    verificationPepper: PEPPER,
    clock: () => NOW,
    random: () => 0.5,
    pollIntervalMs: 1_000,
    leaseMs: 30_000,
    maxAttempts: 5,
    retryBaseMs: 1_000,
    retryMaxMs: 60_000,
    log: (event, fields) => logs.push({ event, fields }),
    ...overrides,
  });
}
