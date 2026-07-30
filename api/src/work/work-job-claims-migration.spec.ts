import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('work job claims migration', () => {
  it('adds a lease-fenced claim per event and handler without destructive rollback', async () => {
    const path = join(
      process.cwd(),
      'migrations',
      '1753660811000_work-job-claims.cjs',
    );

    expect(existsSync(path)).toBe(true);
    const migration = await readFile(path, 'utf8');

    expect(migration).toContain('CREATE TABLE work_job_claims');
    expect(migration).toContain('event_id UUID NOT NULL');
    expect(migration).toContain('handler_version TEXT NOT NULL');
    expect(migration).toContain('lease_owner TEXT NOT NULL');
    expect(migration).toContain('lease_token UUID NOT NULL');
    expect(migration).toContain('lease_expires_at TIMESTAMPTZ NOT NULL');
    expect(migration).toContain('PRIMARY KEY (event_id, handler_version)');
    expect(migration).toContain('work_job_claims_lease_expiry_idx');
    expect(migration).toContain('work job claims rollback refused');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/iu);
  });
});
