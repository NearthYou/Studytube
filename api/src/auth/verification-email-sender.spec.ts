import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CaptureVerificationEmailSender,
  SesV2VerificationEmailSender,
  VerificationEmailDeliveryError,
} from './verification-email-sender';
import { renderVerificationEmail } from './verification-email';

const TOKEN =
  'v1.11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

type CapturedSesCommand = { input: Record<string, unknown> };
type CapturedSesSend = (
  command: CapturedSesCommand,
  options: { abortSignal: AbortSignal },
) => Promise<{ MessageId?: string }>;

function message() {
  return {
    idempotencyKey: 'email-verification/11111111-1111-4111-8111-111111111111',
    ...renderVerificationEmail({
      pendingRegistrationId: '11111111-1111-4111-8111-111111111111',
      verificationToken: TOKEN,
      recipient: 'ada@example.com',
      sender: 'no-reply@studytube.example',
      publicOrigin: 'https://studytube.example',
      templateVersion: 'v1',
      locale: 'ko',
      subject: 'StudyTube 이메일을 인증해 주세요',
    }),
  };
}

describe('verification email senders', () => {
  it('sends an SES v2 simple email with a stable nonsecret correlation tag', async () => {
    const send = jest
      .fn<ReturnType<CapturedSesSend>, Parameters<CapturedSesSend>>()
      .mockResolvedValue({ MessageId: 'ses-message-1' });
    const sender = new SesV2VerificationEmailSender(
      { send } as never,
      5_000,
      'studytube-transactional',
    );

    await expect(sender.send(message())).resolves.toEqual({
      providerMessageId: 'ses-message-1',
    });

    const [command, options] = send.mock.calls[0] as [
      { input: Record<string, unknown> },
      { abortSignal: AbortSignal },
    ];
    expect(command.input).toMatchObject({
      FromEmailAddress: 'no-reply@studytube.example',
      Destination: { ToAddresses: ['ada@example.com'] },
      Content: {
        Simple: {
          Subject: { Data: 'StudyTube 이메일을 인증해 주세요' },
          Body: {
            Text: {
              Data: expect.stringContaining(
                '/signup/verify#verification=',
              ) as unknown,
            },
            Html: {
              Data: expect.stringContaining(
                '/signup/verify#verification=',
              ) as unknown,
            },
          },
        },
      },
      EmailTags: [
        {
          Name: 'studytube_delivery_key',
          Value: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown,
        },
      ],
      ConfigurationSetName: 'studytube-transactional',
    });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(command.input)).not.toContain(
      message().idempotencyKey,
    );
  });

  it('does not treat the SES correlation tag as provider idempotency', async () => {
    const send = jest
      .fn<ReturnType<CapturedSesSend>, Parameters<CapturedSesSend>>()
      .mockResolvedValueOnce({ MessageId: 'ses-message-1' })
      .mockResolvedValueOnce({ MessageId: 'ses-message-2' });
    const sender = new SesV2VerificationEmailSender({ send } as never, 5_000);

    await sender.send(message());
    await sender.send(message());

    expect(send).toHaveBeenCalledTimes(2);
    const firstTag = send.mock.calls[0][0].input.EmailTags;
    const secondTag = send.mock.calls[1][0].input.EmailTags;
    expect(secondTag).toEqual(firstTag);
  });

  it('maps SES failures to bounded nonsecret retry decisions', async () => {
    const retrying = new SesV2VerificationEmailSender(
      {
        send: jest.fn().mockRejectedValue(
          Object.assign(new Error('raw provider response token-canary'), {
            name: 'ThrottlingException',
          }),
        ),
      } as never,
      5_000,
    );
    const rejected = new SesV2VerificationEmailSender(
      {
        send: jest.fn().mockRejectedValue(
          Object.assign(new Error('raw rejection token-canary'), {
            name: 'MessageRejected',
          }),
        ),
      } as never,
      5_000,
    );
    const quotaLimited = new SesV2VerificationEmailSender(
      {
        send: jest.fn().mockRejectedValue(
          Object.assign(new Error('raw quota response token-canary'), {
            name: 'LimitExceededException',
          }),
        ),
      } as never,
      5_000,
    );

    await expect(retrying.send(message())).rejects.toMatchObject({
      code: 'ses_throttled',
      retryable: true,
      message: 'Verification email delivery failed: ses_throttled',
    });
    await expect(rejected.send(message())).rejects.toMatchObject({
      code: 'ses_rejected',
      retryable: false,
      message: 'Verification email delivery failed: ses_rejected',
    });
    await expect(quotaLimited.send(message())).rejects.toMatchObject({
      code: 'ses_throttled',
      retryable: true,
      message: 'Verification email delivery failed: ses_throttled',
    });
  });

  it('captures one immutable verification URL without duplicating PII or secrets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studytube-email-'));
    try {
      const sender = new CaptureVerificationEmailSender(directory);
      const rendered = message();
      const first = await sender.send(rendered);
      const second = await sender.send(rendered);

      expect(second).toEqual(first);
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      const body = await readFile(join(directory, files[0]), 'utf8');
      expect(JSON.parse(body)).toEqual({
        providerMessageId: first.providerMessageId,
        verificationUrl: rendered.verificationUrl,
      });
      expect(occurrences(body, TOKEN)).toBe(1);
      expect(body).not.toContain(rendered.recipient);
      expect(body).not.toContain(rendered.sender);
      expect(body).not.toContain(rendered.subject);
      expect(body).not.toContain(rendered.idempotencyKey);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('prunes expired managed captures before writing a new one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studytube-email-'));
    const staleName = `${'0'.repeat(64)}.json`;
    const stalePath = join(directory, staleName);
    try {
      await writeFile(stalePath, 'expired-placeholder', { mode: 0o600 });
      await utimes(stalePath, new Date(0), new Date(0));
      const sender = new CaptureVerificationEmailSender(directory, {
        clock: () => new Date('2026-07-29T12:00:00.000Z'),
        retentionMs: 60_000,
      });

      await sender.send(message());

      expect(await readdir(directory)).not.toContain(staleName);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('prunes expired managed captures on startup without another send', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studytube-email-'));
    const staleName = `${'0'.repeat(64)}.json`;
    const stalePath = join(directory, staleName);
    const sender = new CaptureVerificationEmailSender(directory, {
      clock: () => new Date('2026-07-29T12:00:00.000Z'),
      retentionMs: 60_000,
    });
    try {
      await writeFile(stalePath, 'expired-placeholder', { mode: 0o600 });
      await utimes(stalePath, new Date(0), new Date(0));

      await sender.onModuleInit();

      expect(await readdir(directory)).toEqual([]);
    } finally {
      await sender.onModuleDestroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('periodically prunes expired managed captures created after startup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studytube-email-'));
    const staleName = `${'1'.repeat(64)}.json`;
    const stalePath = join(directory, staleName);
    const sender = new CaptureVerificationEmailSender(directory, {
      retentionMs: 20,
    });
    try {
      await sender.onModuleInit();
      await writeFile(stalePath, 'expired-placeholder', { mode: 0o600 });
      await utimes(stalePath, new Date(0), new Date(0));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await readdir(directory)).toEqual([]);
    } finally {
      await sender.onModuleDestroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('removes a live capture after its bounded retention window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studytube-email-'));
    try {
      const sender = new CaptureVerificationEmailSender(directory, {
        retentionMs: 20,
      });
      await sender.send(message());

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('removes live managed captures during clean shutdown', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studytube-email-'));
    const sender = new CaptureVerificationEmailSender(directory, {
      retentionMs: 60_000,
    });
    try {
      await sender.send(message());

      await sender.onModuleDestroy();

      expect(await readdir(directory)).toEqual([]);
    } finally {
      await sender.onModuleDestroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when the capture directory is a symbolic link', async () => {
    const base = await mkdtemp(join(tmpdir(), 'studytube-email-'));
    const target = join(base, 'target');
    const linkedDirectory = join(base, 'linked');
    try {
      await mkdir(target);
      await symlink(
        target,
        linkedDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const sender = new CaptureVerificationEmailSender(linkedDirectory);

      await expect(sender.send(message())).rejects.toMatchObject({
        code: 'capture_directory_unsafe',
        retryable: false,
      });
      expect(await readdir(target)).toEqual([]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('fails closed when a parent directory is a symbolic link', async () => {
    const base = await mkdtemp(join(tmpdir(), 'studytube-email-'));
    const targetParent = join(base, 'target-parent');
    const linkedParent = join(base, 'linked-parent');
    const redirectedDirectory = join(linkedParent, 'captures');
    try {
      await mkdir(targetParent);
      await symlink(
        targetParent,
        linkedParent,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const sender = new CaptureVerificationEmailSender(redirectedDirectory);

      await expect(sender.send(message())).rejects.toMatchObject({
        code: 'capture_directory_unsafe',
        retryable: false,
      });
      expect(await readdir(targetParent)).toEqual([]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('sanitizes an unusable capture directory error', async () => {
    const base = await mkdtemp(join(tmpdir(), 'studytube-email-'));
    const unusableDirectory = join(base, 'not-a-directory');
    try {
      await writeFile(unusableDirectory, 'placeholder');
      const sender = new CaptureVerificationEmailSender(unusableDirectory);

      let failure: unknown;
      try {
        await sender.send(message());
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        code: 'capture_directory_unsafe',
        retryable: false,
      });
      expect(JSON.stringify(failure)).not.toContain(unusableDirectory);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('does not expose a provider cause through its public error', () => {
    const error = new VerificationEmailDeliveryError('ses_unavailable', true);
    expect(JSON.stringify(error)).not.toContain('token-canary');
  });
});

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
