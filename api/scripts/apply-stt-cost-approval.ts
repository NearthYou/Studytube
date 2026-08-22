import { Pool } from 'pg';

const PINNED_MODEL = 'gpt-4o-mini-transcribe-2025-12-15';

async function main() {
  if (process.env.STT_PROVIDER_ENABLED !== 'true') {
    process.stdout.write('stt_cost_approval=disabled\n');
    return;
  }

  const databaseUrl = required('DATABASE_URL');
  const model = required('STT_COST_APPROVAL_MODEL');
  const expiresAt = required('STT_COST_APPROVAL_EXPIRES_AT');
  const maxSpendMicrounits = usdToMicrounits(
    required('STT_COST_APPROVAL_MAX_USD'),
  );
  if (model !== PINNED_MODEL) throw new Error('STT_APPROVAL_MODEL_INVALID');
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new Error('STT_APPROVAL_EXPIRY_INVALID');
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('stt-cost-approval', 0))",
    );
    const existing = await client.query<{ id: string }>(
      `SELECT id::text AS id
       FROM stt_provider_approvals
       WHERE model_snapshot = $1
         AND max_spend_microunits = $2
         AND expires_at = $3::timestamptz
         AND revoked_at IS NULL
         AND expires_at > statement_timestamp()
       LIMIT 1`,
      [model, maxSpendMicrounits, expiresAt],
    );
    if (!existing.rows[0]) {
      await client.query(
        `UPDATE stt_provider_approvals
         SET revoked_at = statement_timestamp()
         WHERE model_snapshot = $1
           AND revoked_at IS NULL`,
        [model],
      );
      await client.query(
        `INSERT INTO stt_provider_approvals (
           model_snapshot, max_spend_microunits, approved_at, expires_at
         ) VALUES ($1, $2, statement_timestamp(), $3::timestamptz)`,
        [model, maxSpendMicrounits, expiresAt],
      );
    }
    await client.query('COMMIT');
    process.stdout.write(
      `stt_cost_approval=${existing.rows[0] ? 'unchanged' : 'applied'}\n`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function usdToMicrounits(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('STT_APPROVAL_MAX_INVALID');
  }
  const microunits = Math.round(Number(value) * 1_000_000);
  if (!Number.isSafeInteger(microunits) || microunits <= 0) {
    throw new Error('STT_APPROVAL_MAX_INVALID');
  }
  return microunits;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  process.stderr.write(`stt_cost_approval_failed=${message}\n`);
  process.exitCode = 1;
});
