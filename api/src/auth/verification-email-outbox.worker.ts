import { timingSafeEqual } from 'node:crypto';
import { reconstructVerificationToken } from './auth-token';
import type {
  ClaimedVerificationEmail,
  VerificationEmailOutboxRepository,
} from './verification-email-outbox.repository';
import {
  VerificationEmailDeliveryError,
  type VerificationEmailSender,
} from './verification-email-sender';
import { renderVerificationEmail } from './verification-email';

const AMBIGUOUS_DELIVERY_ERROR_CODES = new Set([
  'delivery_timeout',
  'delivery_unknown',
  'ses_missing_message_id',
  'ses_timeout',
  'ses_unavailable',
  'ses_unknown',
]);

export type VerificationEmailWorkerOptions = {
  verificationPepper: Buffer | string;
  clock: () => Date;
  random?: () => number;
  pollIntervalMs: number;
  leaseMs: number;
  sendTimeoutMs?: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
  onError?: (error: unknown) => void;
};

export type VerificationEmailDeliveryOutcome =
  | 'idle'
  | 'sent'
  | 'retry_scheduled'
  | 'dead_lettered'
  | 'lease_lost';

export class VerificationEmailOutboxWorker {
  private stopped = true;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly repository: VerificationEmailOutboxRepository,
    private readonly sender: VerificationEmailSender,
    private readonly options: VerificationEmailWorkerOptions,
  ) {
    this.random = options.random ?? Math.random;
  }

  onModuleInit(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  async deliverOnce(): Promise<VerificationEmailDeliveryOutcome> {
    const claim = await this.repository.claimNext({
      now: this.options.clock(),
      leaseMs: this.options.leaseMs,
      maxAttempts: this.options.maxAttempts,
    });
    if (!claim) {
      return 'idle';
    }

    let message: ReturnType<typeof renderVerificationEmail>;
    try {
      const verificationToken = reconstructVerificationToken(
        claim.pendingRegistrationId,
        databaseKeyVersion(claim.keyVersion),
        this.options.verificationPepper,
      );
      message = renderVerificationEmail({
        pendingRegistrationId: claim.pendingRegistrationId,
        verificationToken,
        recipient: claim.recipient,
        sender: claim.sender,
        publicOrigin: claim.publicOrigin,
        templateVersion: claim.templateVersion,
        locale: claim.locale,
        subject: claim.subject,
      });
      if (
        claim.payloadHash.length !== message.payloadHash.length ||
        !timingSafeEqual(claim.payloadHash, message.payloadHash)
      ) {
        return this.fail(claim, 'payload_mismatch', false);
      }
    } catch {
      return this.fail(claim, 'payload_reconstruction_failed', false);
    }

    try {
      const result = await withTimeout(
        this.sender.send({ ...message, idempotencyKey: claim.idempotencyKey }),
        this.options.sendTimeoutMs ?? 10_000,
      );
      const sentAt = this.options.clock();
      const outcome = await this.repository.acknowledge({
        id: claim.id,
        leaseToken: claim.leaseToken,
        providerMessageId: result.providerMessageId,
        sentAt,
      });
      if (outcome !== 'acknowledged') {
        this.log('verification_email_ack_lease_lost', {
          outbox_id: claim.id,
          attempt: claim.attempt,
          provider_message_id: result.providerMessageId,
          delivery_semantics: 'at_least_once',
          duplicate_delivery_possible: true,
        });
        return 'lease_lost';
      }
      this.log('verification_email_sent', {
        outbox_id: claim.id,
        attempt: claim.attempt,
        provider_message_id: result.providerMessageId,
        delivery_semantics: 'at_least_once',
      });
      return 'sent';
    } catch (error) {
      const deliveryError =
        error instanceof VerificationEmailDeliveryError
          ? error
          : new VerificationEmailDeliveryError('delivery_unknown', true);
      return this.fail(claim, deliveryError.code, deliveryError.retryable);
    }
  }

  private async fail(
    claim: ClaimedVerificationEmail,
    errorCode: string,
    retryable: boolean,
  ): Promise<'retry_scheduled' | 'dead_lettered' | 'lease_lost'> {
    const now = this.options.clock();
    const terminal = !retryable || claim.attempt >= this.options.maxAttempts;
    const outcome = await this.repository.release({
      id: claim.id,
      leaseToken: claim.leaseToken,
      now,
      errorCode,
      ...(terminal
        ? { failedAt: now }
        : {
            availableAt: new Date(
              now.getTime() + this.retryDelay(claim.attempt),
            ),
          }),
    });
    this.log('verification_email_delivery_failed', {
      outbox_id: claim.id,
      attempt: claim.attempt,
      error_code: errorCode,
      outcome,
      delivery_semantics: 'at_least_once',
      duplicate_delivery_possible:
        ambiguousDeliveryCouldHaveSucceeded(errorCode),
    });
    return outcome;
  }

  private retryDelay(attempt: number): number {
    const exponential = Math.min(
      this.options.retryMaxMs,
      this.options.retryBaseMs * 2 ** Math.max(0, attempt - 1),
    );
    return Math.min(
      this.options.retryMaxMs,
      Math.max(1, Math.round(exponential * (0.5 + this.random()))),
    );
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.runCycle();
      void this.inFlight;
    }, delayMs);
    this.timer.unref?.();
  }

  private async runCycle(): Promise<void> {
    try {
      await this.deliverOnce();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.inFlight = undefined;
      this.schedule(this.options.pollIntervalMs);
    }
  }

  private log(event: string, fields: Record<string, unknown>): void {
    this.options.log?.(event, fields);
  }
}

function databaseKeyVersion(keyVersion: 1): 'v1' {
  if (keyVersion !== 1) {
    throw new RangeError('Unsupported verification key version');
  }
  return 'v1';
}

function ambiguousDeliveryCouldHaveSucceeded(errorCode: string): boolean {
  return AMBIGUOUS_DELIVERY_ERROR_CODES.has(errorCode);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(new VerificationEmailDeliveryError('delivery_timeout', true)),
      timeoutMs,
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
