import { Pool } from 'pg';
import { PostgresWorkRepository } from '../src/work/postgres-work.repository';

async function main(): Promise<void> {
  if (process.env.ALLOW_WORK_REPLAY !== 'true') {
    throw new Error('Set ALLOW_WORK_REPLAY=true to replay a dead letter');
  }

  const [deadLetterId, reason, actorValue] = process.argv.slice(2);
  if (!deadLetterId || !isUuid(deadLetterId)) {
    throw new Error('A valid dead-letter UUID is required');
  }
  if (!reason?.trim() || reason.trim().length > 500) {
    throw new Error('A replay reason between 1 and 500 characters is required');
  }
  const actorId = actorValue === undefined ? null : Number(actorValue);
  if (actorId !== null && (!Number.isInteger(actorId) || actorId <= 0)) {
    throw new Error('Actor ID must be a positive integer when provided');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const replay = await new PostgresWorkRepository(pool).replayDeadLetter({
      deadLetterId,
      actorId,
      reason: reason.trim(),
    });
    process.stdout.write(`${JSON.stringify(replay)}\n`);
  } finally {
    await pool.end();
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Replay failed';
  process.stderr.write(`${message.replace(/\s+/g, ' ').slice(0, 500)}\n`);
  process.exitCode = 1;
});
