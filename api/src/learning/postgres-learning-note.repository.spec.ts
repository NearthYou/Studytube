import type { Pool } from 'pg';
import { PostgresLearningNoteRepository } from './postgres-learning-note.repository';

describe('PostgresLearningNoteRepository', () => {
  it('scopes note creation to a context owned by the actor', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '51',
          userId: 7,
          studyContextId: '13',
          positionSeconds: 12.5,
          body: '핵심 메모',
          createdAt: new Date('2026-08-22T00:00:00.000Z'),
          updatedAt: new Date('2026-08-22T00:00:00.000Z'),
        },
      ],
    });
    const repository = new PostgresLearningNoteRepository({
      query,
    } as unknown as Pool);

    await expect(
      repository.create({
        userId: 7,
        studyContextId: '13',
        positionSeconds: 12.5,
        body: '핵심 메모',
      }),
    ).resolves.toMatchObject({ id: '51', userId: 7, body: '핵심 메모' });
    expect(sqlAt(query, 0)).toContain('context.user_id = $1');
  });

  it('cannot update a note owned by another user', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresLearningNoteRepository({
      query,
    } as unknown as Pool);

    await expect(
      repository.update({
        userId: 8,
        studyContextId: '13',
        noteId: '51',
        body: '침범',
      }),
    ).resolves.toBeNull();
    expect(sqlAt(query, 0)).toContain('user_id = $1');
    expect(sqlAt(query, 0)).toContain('study_context_id = $2');
  });
});

function sqlAt(query: { mock: { calls: unknown[][] } }, index: number): string {
  const value = query.mock.calls[index]?.[0];
  return typeof value === 'string' ? value : '';
}
