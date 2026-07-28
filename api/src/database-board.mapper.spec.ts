import {
  iso,
  normalizeComment,
  normalizeFeedback,
  normalizePreferences,
  normalizeTagNames,
  publicUser,
  vectorLiteral,
} from './database-board.mapper';

describe('database board mapper', () => {
  it('maps database user rows to public users with safe preferences', () => {
    const createdAt = new Date('2026-06-13T00:00:00.000Z');

    expect(
      publicUser({
        id: 1,
        name: 'Ada',
        email: 'ada@example.com',
        passwordHash: 'hidden',
        preferences: {
          interests: ['React', 42, 'AI'],
          pace: '20 minutes',
          goal: 'Practice daily',
        },
        createdAt,
      }),
    ).toEqual({
      id: 1,
      name: 'Ada',
      email: 'ada@example.com',
      preferences: {
        interests: ['React', 'AI'],
        pace: '20 minutes',
        goal: 'Practice daily',
      },
      createdAt: '2026-06-13T00:00:00.000Z',
    });
  });

  it('preserves an unset profile when stored preferences are invalid', () => {
    expect(normalizePreferences(null)).toEqual({
      interests: [],
      pace: '',
      goal: '',
    });
    expect(normalizePreferences({ interests: 'React' })).toEqual({
      interests: [],
      pace: '',
      goal: '',
    });
  });

  it('normalizes date fields on nested rows', () => {
    expect(
      normalizeComment({
        id: 1,
        postId: 2,
        authorId: 3,
        authorName: 'Ada',
        body: 'Helpful',
        createdAt: new Date('2026-06-13T01:02:03.000Z'),
      }),
    ).toMatchObject({ createdAt: '2026-06-13T01:02:03.000Z' });

    expect(
      normalizeFeedback({
        id: 1,
        playlistId: 2,
        authorId: 3,
        rating: 5,
        body: 'Great',
        createdAt: new Date('2026-06-13T01:02:03.000Z'),
      }),
    ).toMatchObject({ createdAt: '2026-06-13T01:02:03.000Z' });
  });

  it('keeps tag and vector formatting deterministic for SQL writes', () => {
    expect(normalizeTagNames([' React ', 'react', '', 'AI'])).toEqual([
      'react',
      'ai',
    ]);
    expect(vectorLiteral('React')).toMatch(
      /^\[(?:-?\d\.\d{5},){63}-?\d\.\d{5}\]$/,
    );
    expect(iso('already-iso')).toBe('already-iso');
  });
});
