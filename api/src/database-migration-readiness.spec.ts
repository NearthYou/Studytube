import {
  assertLearningCutoverAuthority,
  assertRequiredMigrationsApplied,
  resolveDatabaseUrl,
} from './database-migration-readiness';

describe('database migration readiness', () => {
  it('accepts the complete required migration set', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ name: '100_baseline' }, { name: '200_contract' }],
    });

    await expect(
      assertRequiredMigrationsApplied({ query }, [
        '100_baseline',
        '200_contract',
      ]),
    ).resolves.toBeUndefined();
  });

  it('fails closed with every pending migration named', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ name: '100_baseline' }],
    });

    await expect(
      assertRequiredMigrationsApplied({ query }, [
        '100_baseline',
        '200_contract',
        '300_index',
      ]),
    ).rejects.toThrow('200_contract, 300_index');
  });

  it('refuses a production database URL fallback', () => {
    expect(() =>
      resolveDatabaseUrl({ NODE_ENV: 'production' }, undefined),
    ).toThrow('DATABASE_URL must be explicitly configured in production');
  });

  it('keeps the disposable local development default', () => {
    expect(resolveDatabaseUrl({ NODE_ENV: 'test' }, undefined)).toBe(
      'postgresql://app:app@localhost:5432/app_dev',
    );
  });

  it('refuses legacy startup after permanent learning activation', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ writerRelease: 'release-a' }],
    });

    await expect(
      assertLearningCutoverAuthority(
        { query },
        { mode: 'legacy', writerRelease: 'release-a' },
      ),
    ).rejects.toThrow('legacy rollback is disabled');
  });

  it('requires the activated writer release for course startup', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ writerRelease: 'release-a' }],
    });

    await expect(
      assertLearningCutoverAuthority(
        { query },
        { mode: 'course', writerRelease: 'release-b' },
      ),
    ).rejects.toThrow('release-a');
    await expect(
      assertLearningCutoverAuthority(
        { query },
        { mode: 'course', writerRelease: 'release-a' },
      ),
    ).resolves.toBeUndefined();
  });

  it('keeps legacy startup available before activation', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    await expect(
      assertLearningCutoverAuthority(
        { query },
        { mode: 'legacy', writerRelease: 'release-a' },
      ),
    ).resolves.toBeUndefined();
  });
});
