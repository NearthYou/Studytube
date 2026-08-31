import { lstat, readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { RESET_APPLICATION_TABLES } from '../src/maintenance/user-data-reset.manifest';
import {
  buildUserDataResetPlan,
  type UserDataResetPlan,
} from '../src/maintenance/user-data-reset.plan';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RUN_ID_PATTERN = /^reset-\d{8}T\d{6}Z$/u;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type ResetOptions =
  | { mode: 'plan' }
  | {
      mode: 'execute';
      runId: string;
      manifestSha256: string;
      planSha256: string;
    };

export type VerifiedResetBackupProof = {
  schemaVersion: 'studytube.user-data-reset-backup.v1';
  runId: string;
  databaseName: string;
  manifestSha256: string;
  planSha256: string;
  dumpSha256: string;
  s3Bucket: string;
  s3ObjectKey: string;
  createdAt: string;
  deleteAfter: string;
  restoreVerified: boolean;
};

type ResetSqlClient = Pick<PoolClient, 'query'>;
type PlanBuilder = (client: ResetSqlClient) => Promise<UserDataResetPlan>;

export function parseResetOptions(argv: readonly string[]): ResetOptions {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--plan')) {
    return { mode: 'plan' };
  }
  if (argv[0] !== '--execute') throw new Error('RESET_MODE_INVALID');
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !value || !name.startsWith('--')) {
      throw new Error('RESET_ARGUMENT_INVALID');
    }
    if (values.has(name)) throw new Error('RESET_ARGUMENT_DUPLICATE');
    values.set(name, value);
  }
  const runId = values.get('--run-id');
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error('RESET_RUN_ID_REQUIRED');
  }
  const manifestSha256 = values.get('--manifest-sha256');
  if (!manifestSha256 || !SHA256_PATTERN.test(manifestSha256)) {
    throw new Error('RESET_MANIFEST_REQUIRED');
  }
  const planSha256 = values.get('--plan-sha256');
  if (!planSha256 || !SHA256_PATTERN.test(planSha256)) {
    throw new Error('RESET_PLAN_REQUIRED');
  }
  if (values.size !== 3) throw new Error('RESET_ARGUMENT_INVALID');
  return { mode: 'execute', runId, manifestSha256, planSha256 };
}

export function validateVerifiedResetBackupProof(
  value: unknown,
  expected: {
    runId: string;
    databaseName: string;
    manifestSha256: string;
    planSha256: string;
  },
): VerifiedResetBackupProof {
  if (!isRecord(value)) throw new Error('RESET_BACKUP_PROOF_INVALID');
  if (value.restoreVerified !== true) {
    throw new Error('RESET_BACKUP_NOT_VERIFIED');
  }
  const proof = value as VerifiedResetBackupProof;
  if (
    proof.schemaVersion !== 'studytube.user-data-reset-backup.v1' ||
    proof.runId !== expected.runId ||
    proof.databaseName !== expected.databaseName ||
    proof.manifestSha256 !== expected.manifestSha256 ||
    proof.planSha256 !== expected.planSha256 ||
    !SHA256_PATTERN.test(proof.planSha256) ||
    !SHA256_PATTERN.test(proof.dumpSha256) ||
    !validS3Name(proof.s3Bucket) ||
    !validS3Key(proof.s3ObjectKey)
  ) {
    throw new Error('RESET_BACKUP_PROOF_INVALID');
  }
  const createdAt = Date.parse(proof.createdAt);
  const deleteAfter = Date.parse(proof.deleteAfter);
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(deleteAfter) ||
    deleteAfter - createdAt !== RETENTION_MS
  ) {
    throw new Error('RESET_BACKUP_RETENTION_INVALID');
  }
  return proof;
}

export function explicitTruncateSql() {
  const tables = RESET_APPLICATION_TABLES.map((table) => `"${table}"`);
  return `TRUNCATE ${tables.join(', ')} RESTART IDENTITY`;
}

export function validateResetMaintenanceMarker(
  contents: string,
  expected: Extract<ResetOptions, { mode: 'execute' }>,
) {
  const required =
    `run_id=${expected.runId}\n` +
    `manifest_sha256=${expected.manifestSha256}\n` +
    `plan_sha256=${expected.planSha256}\n`;
  if (contents !== required) {
    throw new Error('RESET_MAINTENANCE_MARKER_INVALID');
  }
}

export async function executeUserDataReset(input: {
  client: ResetSqlClient;
  proof: VerifiedResetBackupProof;
  buildPlan?: PlanBuilder;
}) {
  const planBuilder = input.buildPlan ?? buildUserDataResetPlan;
  let transactionOpen = false;
  try {
    await input.client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    transactionOpen = true;
    await input.client.query("SET LOCAL lock_timeout = '5s'");
    await input.client.query("SET LOCAL statement_timeout = '120s'");
    const before = await planBuilder(input.client);
    validateVerifiedResetBackupProof(input.proof, {
      runId: input.proof.runId,
      databaseName: before.databaseName,
      manifestSha256: before.manifestSha256,
      planSha256: before.planSha256,
    });
    await input.client.query(explicitTruncateSql());
    const after = await planBuilder(input.client);
    if (
      after.totalResetRows !== 0 ||
      after.manifestSha256 !== before.manifestSha256 ||
      after.preservedFingerprintSha256 !== before.preservedFingerprintSha256
    ) {
      throw new Error('RESET_POSTCONDITION_FAILED');
    }
    await input.client.query('COMMIT');
    transactionOpen = false;
    return {
      status: 'reset' as const,
      totalResetRowsBefore: before.totalResetRows,
      totalResetRowsAfter: after.totalResetRows,
      manifestSha256: after.manifestSha256,
      planSha256Before: before.planSha256,
      preservedFingerprintSha256: after.preservedFingerprintSha256,
    };
  } catch (error) {
    if (transactionOpen) await input.client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const options = parseResetOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    if (options.mode === 'plan') {
      console.log(JSON.stringify(await buildUserDataResetPlan(pool), null, 2));
      return;
    }
    if (process.env.AUTH_MODE !== 'google_only') {
      throw new Error('RESET_GOOGLE_ONLY_REQUIRED');
    }
    const markerPath =
      process.env.USER_DATA_RESET_MAINTENANCE_MARKER?.trim() ||
      '/run/studytube/user-data-reset-active';
    const markerStat = await lstat(markerPath).catch(() => undefined);
    if (!markerStat?.isFile() || markerStat.isSymbolicLink()) {
      throw new Error('RESET_MAINTENANCE_MARKER_REQUIRED');
    }
    validateResetMaintenanceMarker(await readFile(markerPath, 'utf8'), options);
    const approval = `RESET:${options.runId}:${options.manifestSha256}:${options.planSha256}`;
    if (process.env.USER_DATA_RESET_APPROVAL !== approval) {
      throw new Error('RESET_APPROVAL_REQUIRED');
    }
    const proofPath = process.env.USER_DATA_RESET_BACKUP_PROOF?.trim();
    if (!proofPath) throw new Error('RESET_BACKUP_PROOF_REQUIRED');
    const proofStat = await lstat(proofPath).catch(() => undefined);
    if (!proofStat?.isFile() || proofStat.isSymbolicLink()) {
      throw new Error('RESET_BACKUP_PROOF_INVALID');
    }
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as unknown;
    const client = await pool.connect();
    try {
      const currentPlan = await buildUserDataResetPlan(client);
      const verifiedProof = validateVerifiedResetBackupProof(proof, {
        runId: options.runId,
        databaseName: currentPlan.databaseName,
        manifestSha256: options.manifestSha256,
        planSha256: options.planSha256,
      });
      console.log(
        JSON.stringify(
          await executeUserDataReset({ client, proof: verifiedProof }),
          null,
          2,
        ),
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function validS3Name(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value)
  );
}

function validS3Key(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/\p{Cc}/u.test(value) &&
    !value.startsWith('/')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'RESET_FAILED';
    console.error(message);
    process.exitCode = 1;
  });
}
