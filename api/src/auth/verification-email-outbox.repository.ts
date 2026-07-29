import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export type ClaimedVerificationEmail = Readonly<{
  id: string;
  pendingRegistrationId: string;
  recipient: string;
  idempotencyKey: string;
  sender: string;
  publicOrigin: string;
  templateVersion: string;
  locale: string;
  subject: string;
  payloadHash: Buffer;
  keyVersion: 1;
  attempt: number;
  leaseToken: string;
  leaseExpiresAt: Date;
}>;

export type ClaimVerificationEmailCommand = {
  now: Date;
  leaseMs: number;
  maxAttempts: number;
};

export type AcknowledgeVerificationEmailCommand = {
  id: string;
  leaseToken: string;
  providerMessageId: string;
  sentAt: Date;
};

export type ReleaseVerificationEmailCommand = {
  id: string;
  leaseToken: string;
  now: Date;
  errorCode: string;
  availableAt?: Date;
  failedAt?: Date;
};

export interface VerificationEmailOutboxRepository {
  claimNext(
    command: ClaimVerificationEmailCommand,
  ): Promise<ClaimedVerificationEmail | null>;
  acknowledge(
    command: AcknowledgeVerificationEmailCommand,
  ): Promise<'acknowledged' | 'lease_lost'>;
  release(
    command: ReleaseVerificationEmailCommand,
  ): Promise<'retry_scheduled' | 'dead_lettered' | 'lease_lost'>;
}

type ClaimRow = Omit<
  ClaimedVerificationEmail,
  'keyVersion' | 'leaseExpiresAt'
> & {
  keyVersion: number;
  leaseExpiresAt: Date | string;
};

export class PostgresVerificationEmailOutboxRepository implements VerificationEmailOutboxRepository {
  private readonly uuid: () => string;

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    options: { uuid?: () => string } = {},
  ) {
    this.uuid = options.uuid ?? randomUUID;
  }

  async claimNext(
    command: ClaimVerificationEmailCommand,
  ): Promise<ClaimedVerificationEmail | null> {
    positiveInteger(command.leaseMs, 'leaseMs');
    positiveInteger(command.maxAttempts, 'maxAttempts');
    const leaseToken = this.uuid();
    const leaseExpiresAt = new Date(command.now.getTime() + command.leaseMs);
    const result = await this.pool.query<ClaimRow>(
      `
        WITH terminalized AS (
          UPDATE verification_email_outbox AS outbox
          SET failed_at = $1,
              last_error_code = CASE
                WHEN pending.verification_expires_at <= $1
                  THEN 'verification_expired'
                WHEN pending.attempt_count >= pending.max_attempts
                  THEN 'verification_attempts_exhausted'
                WHEN outbox.attempts >= $4
                  THEN 'delivery_attempts_exhausted'
                ELSE 'verification_consumed'
              END,
              lease_token = NULL,
              lease_expires_at = NULL
          FROM pending_registrations AS pending
          WHERE pending.id = outbox.pending_registration_id
            AND outbox.sent_at IS NULL
            AND outbox.failed_at IS NULL
            AND (outbox.lease_token IS NULL OR outbox.lease_expires_at <= $1)
            AND (
              pending.verification_expires_at <= $1
              OR pending.attempt_count >= pending.max_attempts
              OR pending.verified_at IS NOT NULL
              OR pending.completed_at IS NOT NULL
              OR outbox.attempts >= $4
            )
          RETURNING outbox.id
        ), candidate AS (
          SELECT outbox.id
          FROM verification_email_outbox AS outbox
          JOIN pending_registrations AS pending
            ON pending.id = outbox.pending_registration_id
          WHERE outbox.sent_at IS NULL
            AND outbox.failed_at IS NULL
            AND outbox.available_at <= $1
            AND (outbox.lease_token IS NULL OR outbox.lease_expires_at <= $1)
            AND outbox.attempts < $4
            AND pending.verified_at IS NULL
            AND pending.completed_at IS NULL
            AND pending.verification_expires_at > $1
            AND pending.attempt_count < pending.max_attempts
          ORDER BY outbox.available_at, outbox.id
          FOR UPDATE OF outbox SKIP LOCKED
          LIMIT 1
        ), claimed AS (
          UPDATE verification_email_outbox AS outbox
          SET lease_token = $2,
              lease_expires_at = $3,
              attempts = outbox.attempts + 1
          FROM candidate
          WHERE outbox.id = candidate.id
          RETURNING outbox.id,
                    outbox.pending_registration_id AS "pendingRegistrationId",
                    outbox.recipient,
                    outbox.idempotency_key AS "idempotencyKey",
                    outbox.sender,
                    outbox.public_origin AS "publicOrigin",
                    outbox.template_version AS "templateVersion",
                    outbox.locale,
                    outbox.subject,
                    outbox.payload_hash AS "payloadHash",
                    outbox.attempts AS attempt,
                    outbox.lease_token AS "leaseToken",
                    outbox.lease_expires_at AS "leaseExpiresAt"
        )
        SELECT claimed.*, pending.key_version AS "keyVersion"
        FROM claimed
        JOIN pending_registrations AS pending
          ON pending.id = claimed."pendingRegistrationId"
      `,
      [command.now, leaseToken, leaseExpiresAt, command.maxAttempts],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    if (
      row.keyVersion !== 1 ||
      !Buffer.isBuffer(row.payloadHash) ||
      row.payloadHash.length !== 32 ||
      !Number.isSafeInteger(row.attempt) ||
      row.attempt < 1 ||
      row.leaseToken !== leaseToken
    ) {
      throw new Error('Invalid verification email outbox claim');
    }
    return Object.freeze({
      ...row,
      keyVersion: 1,
      leaseExpiresAt: new Date(row.leaseExpiresAt),
    });
  }

  async acknowledge(
    command: AcknowledgeVerificationEmailCommand,
  ): Promise<'acknowledged' | 'lease_lost'> {
    if (
      command.providerMessageId.length === 0 ||
      command.providerMessageId.length > 255 ||
      /[\r\n\p{Cc}]/u.test(command.providerMessageId)
    ) {
      throw new RangeError('Provider message ID is invalid');
    }
    const result = await this.pool.query<{ id: string }>(
      `
        UPDATE verification_email_outbox
        SET provider_message_id = $4,
            sent_at = $3,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error_code = NULL
        WHERE id = $1
          AND lease_token = $2
          AND lease_expires_at > $3
          AND sent_at IS NULL
          AND failed_at IS NULL
        RETURNING id
      `,
      [
        command.id,
        command.leaseToken,
        command.sentAt,
        command.providerMessageId,
      ],
    );
    return result.rows[0] ? 'acknowledged' : 'lease_lost';
  }

  async release(
    command: ReleaseVerificationEmailCommand,
  ): Promise<'retry_scheduled' | 'dead_lettered' | 'lease_lost'> {
    if (!/^[a-z0-9_]{1,64}$/u.test(command.errorCode)) {
      throw new RangeError('Verification email error code is invalid');
    }
    if (Boolean(command.availableAt) === Boolean(command.failedAt)) {
      throw new RangeError('Release must choose retry or dead letter');
    }

    const terminal = command.failedAt !== undefined;
    const nextTime = terminal ? command.failedAt : command.availableAt;
    const assignment = terminal ? 'failed_at = $5' : 'available_at = $5';
    const result = await this.pool.query<{ id: string }>(
      `
        UPDATE verification_email_outbox
        SET ${assignment},
            last_error_code = $4,
            lease_token = NULL,
            lease_expires_at = NULL
        WHERE id = $1
          AND lease_token = $2
          AND lease_expires_at > $3
          AND sent_at IS NULL
          AND failed_at IS NULL
        RETURNING id
      `,
      [
        command.id,
        command.leaseToken,
        command.now,
        command.errorCode,
        nextTime,
      ],
    );
    if (!result.rows[0]) {
      return 'lease_lost';
    }
    return terminal ? 'dead_lettered' : 'retry_scheduled';
  }
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
