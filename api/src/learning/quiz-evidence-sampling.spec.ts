import { evenlySampleQuizEvidence } from './quiz-evidence-sampling';

describe('quiz evidence sampling', () => {
  it('samples five passages across the whole video instead of the opening', () => {
    const rows = [90, 10, 70, 0, 50, 30, 80, 20, 60, 40].map(
      (startSeconds) => ({
        resourceId: `caption-${startSeconds}`,
        content: `caption at ${startSeconds}`,
        sourceUrl: 'https://www.youtube.com/watch?v=quizsource1',
        startSeconds,
        endSeconds: startSeconds + 5,
      }),
    );

    expect(
      evenlySampleQuizEvidence(rows, 5).map(
        (evidence) => evidence.startSeconds,
      ),
    ).toEqual([0, 20, 50, 70, 90]);
  });

  it('refuses to fabricate five passages from incomplete evidence', () => {
    expect(
      evenlySampleQuizEvidence(
        [0, 30, 60, 90].map((startSeconds) => ({
          resourceId: `caption-${startSeconds}`,
          content: `caption at ${startSeconds}`,
          sourceUrl: 'https://www.youtube.com/watch?v=quizsource1',
          startSeconds,
          endSeconds: startSeconds + 5,
        })),
        5,
      ),
    ).toEqual([]);
  });
});
