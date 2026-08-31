import { PostgresAccountErasureRepository } from './postgres-account-erasure.repository';

const COMMAND = {
  userId: 71,
  sessionId: '33333333-3333-4333-8333-333333333333',
  reauthCutoff: new Date('2026-08-31T11:55:00.000Z'),
  erasedAt: new Date('2026-08-31T12:00:00.000Z'),
};

describe('PostgresAccountErasureRepository', () => {
  it('deletes the user graph and commits only after reauthentication', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ id: 71 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: COMMAND.sessionId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 71 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const release = jest.fn();
    const repository = new PostgresAccountErasureRepository({
      connect: () => Promise.resolve({ query, release }),
    } as never);

    await expect(repository.erase(COMMAND)).resolves.toEqual({
      status: 'deleted',
    });

    const statements = query.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain('FROM users');
    expect(statements[1]).toContain('FOR UPDATE');
    expect(statements[2]).toContain('google_reauthenticated_at >= $3');
    expect(statements[2]).toContain('session.id = $2');
    expect(statements).toContain(
      'DELETE FROM users WHERE id = $1 RETURNING id',
    );
    expect(statements.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back without deletion when recent reauthentication is missing', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ id: 71 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const repository = new PostgresAccountErasureRepository({
      connect: () => Promise.resolve({ query, release: jest.fn() }),
    } as never);

    await expect(repository.erase(COMMAND)).resolves.toEqual({
      status: 'reauth_required',
    });
    expect(query.mock.calls.map(([sql]) => String(sql).trim())).toEqual([
      'BEGIN',
      expect.stringContaining('FROM users'),
      expect.stringContaining('FROM sessions AS session'),
      'ROLLBACK',
    ]);
  });
});
