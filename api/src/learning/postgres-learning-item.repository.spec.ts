import type { Pool, PoolClient } from 'pg';
import { PostgresLearningItemRepository } from './postgres-learning-item.repository';

describe('PostgresLearningItemRepository', () => {
  it('returns one owner library item while keeping Course occurrences distinct', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            videoSourceId: '11',
            provider: 'youtube',
            canonicalVideoId: 'dQw4w9WgXcQ',
            canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            learningItemId: '21',
            userId: 42,
            sourcePostId: null,
            studyContextId: '31',
            contextKind: 'course_occurrence',
            courseStepId: '101',
            courseStepProvenanceId: '101',
            learningItemProvenance: { origin: 'post' },
            studyContextProvenance: {
              origin: 'course_step',
              sourcePostMissing: true,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const release = jest.fn();
    const client = { query, release } as unknown as PoolClient;
    const repository = new PostgresLearningItemRepository({
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as Pool);

    await expect(
      repository.ensureContext({
        userId: 42,
        provider: 'youtube',
        canonicalVideoId: 'dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        courseStepId: '101',
        sourcePostId: null,
        provenance: { origin: 'course_step', sourcePostMissing: true },
      }),
    ).resolves.toMatchObject({
      learningItem: { id: '21', userId: 42, videoSourceId: '11' },
      studyContext: {
        id: '31',
        kind: 'course_occurrence',
        courseStepId: '101',
        courseStepProvenanceId: '101',
      },
    });

    expect(sqlAt(query, 0)).toBe('BEGIN');
    expect(sqlAt(query, 1)).toContain('pg_advisory_xact_lock');
    expect(sqlAt(query, 2)).toContain('ON CONFLICT (user_id, course_step_id)');
    expect(sqlAt(query, -1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back when an owner-scoped context cannot be created', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(
        Object.assign(new Error('owner mismatch'), { code: '23503' }),
      )
      .mockResolvedValueOnce({ rows: [] });
    const release = jest.fn();
    const repository = new PostgresLearningItemRepository({
      connect: jest.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool);

    await expect(
      repository.ensureContext({
        userId: 7,
        provider: 'youtube',
        canonicalVideoId: 'abcdefghijk',
        canonicalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
        courseStepId: null,
        sourcePostId: null,
        provenance: { origin: 'direct' },
      }),
    ).rejects.toMatchObject({ code: '23503' });

    expect(sqlAt(query, -1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

function sqlAt(query: { mock: { calls: unknown[][] } }, index: number): string {
  const call = index < 0 ? query.mock.calls.at(index) : query.mock.calls[index];
  return typeof call?.[0] === 'string' ? call[0] : '';
}
