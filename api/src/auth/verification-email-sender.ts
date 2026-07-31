import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, parse, resolve, sep } from 'node:path';
import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { RenderedVerificationEmail } from './verification-email';

export type VerificationEmailMessage = RenderedVerificationEmail & {
  idempotencyKey: string;
};

export interface VerificationEmailSender {
  send(
    message: VerificationEmailMessage,
  ): Promise<{ providerMessageId: string }>;
}

export const VERIFICATION_EMAIL_SENDER = Symbol('VERIFICATION_EMAIL_SENDER');

export class VerificationEmailDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`Verification email delivery failed: ${code}`);
    this.name = 'VerificationEmailDeliveryError';
  }
}

export class SesV2VerificationEmailSender implements VerificationEmailSender {
  constructor(
    private readonly client: Pick<SESv2Client, 'send'>,
    private readonly sendTimeoutMs: number,
    private readonly configurationSetName?: string,
  ) {
    if (!Number.isSafeInteger(sendTimeoutMs) || sendTimeoutMs <= 0) {
      throw new RangeError('SES send timeout must be a positive integer');
    }
  }

  async send(
    message: VerificationEmailMessage,
  ): Promise<{ providerMessageId: string }> {
    // SES v2 has no client idempotency token for SendEmail. This tag only
    // correlates duplicate-capable at-least-once attempts in SES telemetry.
    const correlationTag = createHash('sha256')
      .update(message.idempotencyKey, 'utf8')
      .digest('hex');
    try {
      const response = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: message.sender,
          Destination: { ToAddresses: [message.recipient] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: {
                Text: { Data: message.text, Charset: 'UTF-8' },
                Html: { Data: message.html, Charset: 'UTF-8' },
              },
            },
          },
          EmailTags: [
            { Name: 'studytube_delivery_key', Value: correlationTag },
          ],
          ...(this.configurationSetName
            ? { ConfigurationSetName: this.configurationSetName }
            : {}),
        }),
        { abortSignal: AbortSignal.timeout(this.sendTimeoutMs) },
      );
      const providerMessageId = response.MessageId?.trim();
      if (!providerMessageId) {
        throw new VerificationEmailDeliveryError(
          'ses_missing_message_id',
          true,
        );
      }
      return { providerMessageId };
    } catch (error) {
      if (error instanceof VerificationEmailDeliveryError) {
        throw error;
      }
      throw classifySesFailure(error);
    }
  }
}

export class CaptureVerificationEmailSender
  implements VerificationEmailSender, OnModuleInit, OnModuleDestroy
{
  private static readonly DEFAULT_RETENTION_MS = 15 * 60 * 1000;
  private static readonly MAX_CLEANUP_INTERVAL_MS = 60 * 1000;
  private static readonly MANAGED_FILE_PATTERN = /^[0-9a-f]{64}\.json$/u;
  private readonly directory: string;
  private readonly retentionMs: number;
  private readonly clock: () => Date;
  private readonly deletionTimers = new Set<NodeJS.Timeout>();
  private cleanupTimer?: NodeJS.Timeout;
  private cleanupInFlight?: Promise<void>;
  private initialization?: Promise<void>;
  private initialized = false;
  private stopping = false;

  constructor(
    directory: string,
    options: { retentionMs?: number; clock?: () => Date } = {},
  ) {
    if (!directory.trim()) {
      throw new RangeError('Capture directory is required');
    }
    this.directory = resolve(directory);
    this.retentionMs =
      options.retentionMs ??
      CaptureVerificationEmailSender.DEFAULT_RETENTION_MS;
    if (!Number.isSafeInteger(this.retentionMs) || this.retentionMs <= 0) {
      throw new RangeError('Capture retention must be a positive integer');
    }
    this.clock = options.clock ?? (() => new Date());
  }

  async onModuleInit(): Promise<void> {
    await this.ensureInitialized();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    for (const timer of this.deletionTimers) {
      clearTimeout(timer);
    }
    this.deletionTimers.clear();
    await this.initialization;
    await this.cleanupInFlight;
    if (!this.initialized) {
      return;
    }
    await this.cleanupManagedCaptures(false);
    this.initialized = false;
  }

  async send(
    message: VerificationEmailMessage,
  ): Promise<{ providerMessageId: string }> {
    await this.ensureInitialized();
    await this.cleanupExpiredCaptures();
    const keyHash = createHash('sha256')
      .update(message.idempotencyKey, 'utf8')
      .digest('hex');
    const providerMessageId = `capture-${keyHash.slice(0, 32)}`;
    const path = join(this.directory, `${keyHash}.json`);
    const document = `${JSON.stringify(
      {
        providerMessageId,
        verificationUrl: message.verificationUrl,
      },
      null,
      2,
    )}\n`;
    try {
      await writeFile(path, document, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw new VerificationEmailDeliveryError('capture_write_failed', true);
      }
      const existingMetadata = await lstat(path).catch(() => undefined);
      if (!existingMetadata?.isFile() || existingMetadata.isSymbolicLink()) {
        throw new VerificationEmailDeliveryError('capture_file_unsafe', false);
      }
      const existing = await readFile(path, 'utf8').catch(() => undefined);
      if (!existing || existing !== document) {
        throw new VerificationEmailDeliveryError(
          'capture_payload_conflict',
          false,
        );
      }
    }
    await this.hardenFile(path);
    await this.scheduleDeletion(path);
    return { providerMessageId };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.initialization) {
      this.stopping = false;
      const initialization = this.cleanupExpiredCaptures().then(() => {
        this.initialized = true;
        this.schedulePeriodicCleanup();
      });
      this.initialization = initialization;
    }
    const initialization = this.initialization;
    try {
      await initialization;
    } finally {
      if (this.initialization === initialization) {
        this.initialization = undefined;
      }
    }
  }

  private async cleanupExpiredCaptures(): Promise<void> {
    await this.prepareDirectory();
    await this.pruneExpiredCaptures();
  }

  private async prepareDirectory(): Promise<void> {
    try {
      await this.assertSafeDirectoryChain(false);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.assertSafeDirectoryChain(true);
      if (process.platform !== 'win32') {
        await chmod(this.directory, 0o700);
      }
    } catch (error) {
      if (error instanceof VerificationEmailDeliveryError) {
        throw error;
      }
      throw new VerificationEmailDeliveryError(
        'capture_directory_unsafe',
        false,
      );
    }
  }

  private async pruneExpiredCaptures(): Promise<void> {
    await this.cleanupManagedCaptures(true);
  }

  private async cleanupManagedCaptures(expiredOnly: boolean): Promise<void> {
    const now = expiredOnly ? this.now() : undefined;
    try {
      const directoryMetadata = await lstatIfExists(this.directory);
      if (!directoryMetadata) {
        return;
      }
      await this.assertSafeDirectoryChain(true);
      const names = await readdir(this.directory);
      await Promise.all(
        names
          .filter((name) =>
            CaptureVerificationEmailSender.MANAGED_FILE_PATTERN.test(name),
          )
          .map(async (name) => {
            const path = join(this.directory, name);
            const metadata = await lstat(path).catch((error) => {
              if (hasErrorCode(error, 'ENOENT')) {
                return undefined;
              }
              throw error;
            });
            if (!metadata) {
              return;
            }
            if (metadata.isSymbolicLink()) {
              await this.deleteManagedCapture(path);
              return;
            }
            if (!metadata.isFile()) {
              throw new VerificationEmailDeliveryError(
                'capture_file_unsafe',
                false,
              );
            }
            if (
              !expiredOnly ||
              (now !== undefined && now - metadata.mtimeMs >= this.retentionMs)
            ) {
              await this.deleteManagedCapture(path);
            }
          }),
      );
    } catch (error) {
      if (error instanceof VerificationEmailDeliveryError) {
        throw error;
      }
      throw new VerificationEmailDeliveryError('capture_cleanup_failed', true);
    }
  }

  private async hardenFile(path: string): Promise<void> {
    try {
      await this.assertSafeDirectoryChain(true);
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new VerificationEmailDeliveryError('capture_file_unsafe', false);
      }
      if (process.platform !== 'win32') {
        await chmod(path, 0o600);
      }
    } catch (error) {
      if (error instanceof VerificationEmailDeliveryError) {
        throw error;
      }
      throw new VerificationEmailDeliveryError('capture_write_failed', true);
    }
  }

  private async scheduleDeletion(path: string): Promise<void> {
    await this.assertSafeDirectoryChain(true);
    const metadata = await lstat(path).catch(() => undefined);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      throw new VerificationEmailDeliveryError('capture_file_unsafe', false);
    }
    const remainingMs = Math.max(
      0,
      this.retentionMs - Math.max(0, this.now() - metadata.mtimeMs),
    );
    const timer = setTimeout(() => {
      this.deletionTimers.delete(timer);
      void this.deleteManagedCapture(path).catch((error) => {
        this.reportCleanupFailure(error);
      });
    }, remainingMs);
    this.deletionTimers.add(timer);
    timer.unref?.();
  }

  private schedulePeriodicCleanup(): void {
    if (this.stopping || this.cleanupTimer) {
      return;
    }
    const intervalMs = Math.min(
      this.retentionMs,
      CaptureVerificationEmailSender.MAX_CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = undefined;
      if (this.stopping) {
        return;
      }
      const cleanup = this.cleanupExpiredCaptures().catch((error) => {
        this.reportCleanupFailure(error);
      });
      this.cleanupInFlight = cleanup;
      void cleanup.finally(() => {
        if (this.cleanupInFlight === cleanup) {
          this.cleanupInFlight = undefined;
        }
        this.schedulePeriodicCleanup();
      });
    }, intervalMs);
    this.cleanupTimer.unref?.();
  }

  private async deleteManagedCapture(path: string): Promise<void> {
    try {
      await this.assertSafeDirectoryChain(true);
      const metadata = await lstatIfExists(path);
      if (!metadata) {
        return;
      }
      if (!metadata.isFile() && !metadata.isSymbolicLink()) {
        throw new VerificationEmailDeliveryError('capture_file_unsafe', false);
      }
      await unlink(path);
    } catch (error) {
      if (error instanceof VerificationEmailDeliveryError) {
        throw error;
      }
      throw new VerificationEmailDeliveryError('capture_cleanup_failed', true);
    }
  }

  private async assertSafeDirectoryChain(
    requireComplete: boolean,
  ): Promise<void> {
    const root = parse(this.directory).root;
    const components = this.directory
      .slice(root.length)
      .split(sep)
      .filter(Boolean);
    let current = root;
    for (const component of components) {
      current = join(current, component);
      const metadata = await lstatIfExists(current);
      if (!metadata) {
        if (requireComplete) {
          throw new VerificationEmailDeliveryError(
            'capture_directory_unsafe',
            false,
          );
        }
        return;
      }
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new VerificationEmailDeliveryError(
          'capture_directory_unsafe',
          false,
        );
      }
    }
  }

  private reportCleanupFailure(error: unknown): void {
    const errorCode =
      error instanceof VerificationEmailDeliveryError
        ? error.code
        : 'capture_cleanup_failed';
    process.emitWarning(
      `Verification email capture cleanup failed: ${errorCode}`,
      { code: 'STUDYTUBE_CAPTURE_CLEANUP_FAILED' },
    );
  }

  private now(): number {
    const milliseconds = this.clock().getTime();
    if (!Number.isFinite(milliseconds)) {
      throw new RangeError('Capture clock returned an invalid date');
    }
    return milliseconds;
  }
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

function classifySesFailure(error: unknown): VerificationEmailDeliveryError {
  const name = errorName(error);
  if (name === 'AccessDeniedException') {
    return new VerificationEmailDeliveryError('ses_access_denied', false);
  }
  if (
    name === 'ThrottlingException' ||
    name === 'TooManyRequestsException' ||
    name === 'LimitExceededException' ||
    name === 'RequestTimeout' ||
    name === 'TimeoutError' ||
    name === 'AbortError'
  ) {
    return new VerificationEmailDeliveryError(
      name === 'ThrottlingException' ||
        name === 'TooManyRequestsException' ||
        name === 'LimitExceededException'
        ? 'ses_throttled'
        : 'ses_timeout',
      true,
    );
  }
  if (
    name === 'MessageRejected' ||
    name === 'MailFromDomainNotVerifiedException' ||
    name === 'SendingPausedException' ||
    name === 'AccountSuspendedException'
  ) {
    return new VerificationEmailDeliveryError('ses_rejected', false);
  }
  const status = metadataStatus(error);
  return new VerificationEmailDeliveryError(
    status !== undefined && status >= 500 ? 'ses_unavailable' : 'ses_unknown',
    status === undefined || status >= 500,
  );
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return undefined;
  }
  return typeof error.name === 'string' ? error.name : undefined;
}

function metadataStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) {
    return undefined;
  }
  const metadata = error.$metadata;
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('httpStatusCode' in metadata)
  ) {
    return undefined;
  }
  return typeof metadata.httpStatusCode === 'number'
    ? metadata.httpStatusCode
    : undefined;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
