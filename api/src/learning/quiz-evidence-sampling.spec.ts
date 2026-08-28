import { buildQuizEvidencePassages } from './quiz-evidence-sampling';

describe('quiz evidence sampling', () => {
  it('refuses to fabricate five passages from incomplete evidence', () => {
    expect(
      buildQuizEvidencePassages(
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

  it('builds five contiguous passages that retain context across the whole video', () => {
    const rows = Array.from({ length: 12 }, (_, index) => {
      const startSeconds = index * 10;
      return {
        resourceId: `caption-${startSeconds}`,
        content: `caption ${index}`,
        sourceUrl: 'https://www.youtube.com/watch?v=quizsource1',
        startSeconds,
        endSeconds: startSeconds + 5,
      };
    });

    const passages = buildQuizEvidencePassages(rows, 5);

    expect(
      passages.map(({ startSeconds, endSeconds }) => [
        startSeconds,
        endSeconds,
      ]),
    ).toEqual([
      [0, 15],
      [20, 35],
      [40, 65],
      [70, 85],
      [90, 115],
    ]);
    expect(passages[0]?.content).toBe('caption 0 caption 1');
    expect(passages[4]?.content).toBe('caption 9 caption 10 caption 11');
  });
});
