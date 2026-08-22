import { timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  LearningError,
  LearningIdempotencyConflictError,
  LearningNotFoundError,
  LearningPersistenceUnavailableError,
  LearningValidationError,
  LearningVersionConflictError,
} from './learning.errors';

export type SqlClient = Pick<PoolClient, 'query'>;

export async function mutate<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new LearningPersistenceUnavailableError({ cause: error });
  }
  let open = false;
  try {
    await client.query('BEGIN');
    open = true;
    const result = await work(client);
    await client.query('COMMIT');
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query('ROLLBACK').catch(() => undefined);
    throw translatePostgresError(error);
  } finally {
    client.release();
  }
}

export async function assertOrAdoptLegacyHash(
  client: SqlClient,
  table:
    | 'learning_progress_events'
    | 'quiz_attempts'
    | 'adaptive_quiz_loops'
    | 'adaptive_quiz_attempts',
  id: string,
  existing: Buffer,
  incoming: Buffer,
): Promise<void> {
  const legacyZeroHash = Buffer.alloc(32);
  if (
    existing.length !== legacyZeroHash.length ||
    !timingSafeEqual(existing, legacyZeroHash)
  ) {
    assertSameHash(existing, incoming);
    return;
  }
  if (incoming.length !== 32) {
    throw new LearningIdempotencyConflictError();
  }
  const adopted = await client.query<{ payloadHash: Buffer }>(
    `
      UPDATE ${table}
      SET payload_hash = $2
      WHERE id = $1 AND payload_hash = $3
      RETURNING payload_hash AS "payloadHash"
    `,
    [id, incoming, legacyZeroHash],
  );
  if (adopted.rows[0]) return;
  const raced = await client.query<{ payloadHash: Buffer }>(
    `SELECT payload_hash AS "payloadHash" FROM ${table} WHERE id = $1`,
    [id],
  );
  if (!raced.rows[0]) throw new LearningPersistenceUnavailableError();
  assertSameHash(raced.rows[0].payloadHash, incoming);
}

export function assertSameHash(existing: Buffer, incoming: Buffer): void {
  if (
    existing.length !== incoming.length ||
    !timingSafeEqual(existing, incoming)
  ) {
    throw new LearningIdempotencyConflictError();
  }
}

export function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

export function translatePostgresError(error: unknown): unknown {
  if (error instanceof LearningError) return error;
  const code = postgresField(error, 'code');
  const constraint = postgresField(error, 'constraint');
  if (code === '23514' && constraint === 'quizzes_exactly_five_questions') {
    return new LearningValidationError(
      'questions',
      'Exactly 5 quiz questions are required',
    );
  }
  if (code === '23503' || code === '22P02') {
    return new LearningNotFoundError();
  }
  if (code === '40001' || code === '40P01') {
    return new LearningVersionConflictError(0);
  }
  if (
    code?.startsWith('08') ||
    code === '57P01' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND'
  ) {
    return new LearningPersistenceUnavailableError({ cause: error });
  }
  return error;
}

function postgresField(error: unknown, field: string): string | undefined {
  if (!error || typeof error !== 'object' || !(field in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}
