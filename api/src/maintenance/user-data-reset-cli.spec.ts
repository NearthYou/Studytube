import {
  executeUserDataReset,
  explicitTruncateSql,
  parseResetOptions,
  validateResetMaintenanceMarker,
  validateVerifiedResetBackupProof,
  type VerifiedResetBackupProof,
} from '../../scripts/user-data-reset';
import type { UserDataResetPlan } from './user-data-reset.plan';

const MANIFEST_SHA = 'a'.repeat(64);
const PRESERVED_SHA = 'b'.repeat(64);
const PLAN_SHA = 'c'.repeat(64);

describe('user data reset CLI', () => {
  it('defaults to a read-only plan and refuses incomplete execute flags', () => {
    expect(parseResetOptions([])).toEqual({ mode: 'plan' });
    expect(() => parseResetOptions(['--execute'])).toThrow(
      'RESET_RUN_ID_REQUIRED',
    );
    expect(() =>
      parseResetOptions(['--execute', '--run-id', 'reset-20260831T120000Z']),
    ).toThrow('RESET_MANIFEST_REQUIRED');
    expect(() =>
      parseResetOptions([
        '--execute',
        '--run-id',
        'reset-20260831T120000Z',
        '--manifest-sha256',
        MANIFEST_SHA,
      ]),
    ).toThrow('RESET_PLAN_REQUIRED');
  });

  it('parses an exact run and manifest identity for execute mode', () => {
    expect(
      parseResetOptions([
        '--execute',
        '--run-id',
        'reset-20260831T120000Z',
        '--manifest-sha256',
        MANIFEST_SHA,
        '--plan-sha256',
        PLAN_SHA,
      ]),
    ).toEqual({
      mode: 'execute',
      runId: 'reset-20260831T120000Z',
      manifestSha256: MANIFEST_SHA,
      planSha256: PLAN_SHA,
    });
  });

  it('binds the maintenance marker to the same approved plan', () => {
    expect(() =>
      validateResetMaintenanceMarker(
        `run_id=reset-20260831T120000Z\nmanifest_sha256=${MANIFEST_SHA}\nplan_sha256=${PLAN_SHA}\n`,
        {
          runId: 'reset-20260831T120000Z',
          manifestSha256: MANIFEST_SHA,
          planSha256: PLAN_SHA,
        },
      ),
    ).not.toThrow();
    expect(() =>
      validateResetMaintenanceMarker(
        `run_id=reset-20260831T120000Z\nmanifest_sha256=${MANIFEST_SHA}\nplan_sha256=${'e'.repeat(64)}\n`,
        {
          runId: 'reset-20260831T120000Z',
          manifestSha256: MANIFEST_SHA,
          planSha256: PLAN_SHA,
        },
      ),
    ).toThrow('RESET_MAINTENANCE_MARKER_INVALID');
  });

  it('accepts only a restore-verified proof with exactly seven days of retention', () => {
    expect(
      validateVerifiedResetBackupProof(proof(), {
        runId: 'reset-20260831T120000Z',
        databaseName: 'app',
        manifestSha256: MANIFEST_SHA,
        planSha256: PLAN_SHA,
      }),
    ).toEqual(proof());

    expect(() =>
      validateVerifiedResetBackupProof(
        { ...proof(), restoreVerified: false },
        {
          runId: 'reset-20260831T120000Z',
          databaseName: 'app',
          manifestSha256: MANIFEST_SHA,
          planSha256: PLAN_SHA,
        },
      ),
    ).toThrow('RESET_BACKUP_NOT_VERIFIED');
    expect(() =>
      validateVerifiedResetBackupProof(
        { ...proof(), deleteAfter: '2026-09-08T12:00:00.000Z' },
        {
          runId: 'reset-20260831T120000Z',
          databaseName: 'app',
          manifestSha256: MANIFEST_SHA,
          planSha256: PLAN_SHA,
        },
      ),
    ).toThrow('RESET_BACKUP_RETENTION_INVALID');
    expect(() =>
      validateVerifiedResetBackupProof(
        { ...proof(), planSha256: 'e'.repeat(64) },
        {
          runId: 'reset-20260831T120000Z',
          databaseName: 'app',
          manifestSha256: MANIFEST_SHA,
          planSha256: PLAN_SHA,
        },
      ),
    ).toThrow('RESET_BACKUP_PROOF_INVALID');
  });

  it('builds one explicit truncate without CASCADE or preserved tables', () => {
    const sql = explicitTruncateSql();

    expect(sql).toMatch(/^TRUNCATE /u);
    expect(sql).toContain('"users"');
    expect(sql).toContain('"work_outbox_events"');
    expect(sql).toContain('RESTART IDENTITY');
    expect(sql).not.toContain('CASCADE');
    expect(sql).not.toContain('"pgmigrations"');
    expect(sql).not.toContain('"stt_provider_approvals"');
  });

  it('commits only when reset rows are zero and preserved rows are unchanged', async () => {
    const queries: string[] = [];
    const client = {
      query(sql: string) {
        queries.push(sql.trim());
        return Promise.resolve({ rows: [] });
      },
    };
    const plans = [plan(6), plan(0)];

    await expect(
      executeUserDataReset({
        client: client as never,
        proof: proof(),
        buildPlan: () => Promise.resolve(plans.shift()!),
      }),
    ).resolves.toEqual({
      status: 'reset',
      totalResetRowsBefore: 6,
      totalResetRowsAfter: 0,
      manifestSha256: MANIFEST_SHA,
      planSha256Before: PLAN_SHA,
      preservedFingerprintSha256: PRESERVED_SHA,
    });

    expect(queries[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(queries.some((sql) => sql.startsWith('TRUNCATE '))).toBe(true);
    expect(queries.at(-1)).toBe('COMMIT');
  });

  it('rolls back when a reset or preserved-data postcondition differs', async () => {
    const queries: string[] = [];
    const client = {
      query(sql: string) {
        queries.push(sql.trim());
        return Promise.resolve({ rows: [] });
      },
    };
    const plans = [
      plan(6),
      { ...plan(0), preservedFingerprintSha256: 'c'.repeat(64) },
    ];

    await expect(
      executeUserDataReset({
        client: client as never,
        proof: proof(),
        buildPlan: () => Promise.resolve(plans.shift()!),
      }),
    ).rejects.toThrow('RESET_POSTCONDITION_FAILED');
    expect(queries.at(-1)).toBe('ROLLBACK');
  });
});

function proof(): VerifiedResetBackupProof {
  return {
    schemaVersion: 'studytube.user-data-reset-backup.v1',
    runId: 'reset-20260831T120000Z',
    databaseName: 'app',
    manifestSha256: MANIFEST_SHA,
    planSha256: PLAN_SHA,
    dumpSha256: 'd'.repeat(64),
    s3Bucket: 'studytube-private-backup',
    s3ObjectKey: 'user-reset/reset-20260831T120000Z/database.dump',
    createdAt: '2026-08-31T12:00:00.000Z',
    deleteAfter: '2026-09-07T12:00:00.000Z',
    restoreVerified: true,
  };
}

function plan(totalResetRows: number): UserDataResetPlan {
  return {
    databaseName: 'app',
    migrationNames: ['1753660823000_google-account-deletion'],
    resetTables: [{ name: 'users', rows: totalResetRows }],
    preservedTables: [{ name: 'pgmigrations', rows: 24 }],
    manifestSha256: MANIFEST_SHA,
    planSha256: PLAN_SHA,
    preservedFingerprintSha256: PRESERVED_SHA,
    totalResetRows,
  };
}
