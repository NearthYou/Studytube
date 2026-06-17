import {
  buildSeatReviewRagDocument,
  buildSeatReviewRagMetadata,
} from './rag-document.builder';

describe('RAG document builder', () => {
  const review = {
    id: 11n,
    seatFloor: '2F',
    seatSection: 'A',
    seatRow: '7',
    seatNumber: '15',
    viewRating: 4,
    soundRating: 5,
    comfortRating: 3,
    expressionRating: 4,
    stageVisibilityRating: 5,
    content: 'Great sound, slight side angle.',
    theater: { id: 1n, name: 'Sejong Theater' },
    musical: { id: 2n, title: 'Hamlet' },
    performance: { id: 3n, seasonLabel: '2026 Seoul' },
    seatReviewTags: [{ tag: { id: 4n, name: 'view', type: 'experience' } }],
  };

  it('builds metadata that can be used for quality evaluation', () => {
    expect(buildSeatReviewRagMetadata(review as never)).toEqual({
      documentVersion: 'seat-review-v2',
      reviewId: '11',
      theaterId: '1',
      theaterName: 'Sejong Theater',
      musicalId: '2',
      musicalTitle: 'Hamlet',
      performanceId: '3',
      seasonLabel: '2026 Seoul',
      seat: {
        floor: '2F',
        section: 'A',
        row: '7',
        number: '15',
      },
      ratings: {
        view: 4,
        sound: 5,
        comfort: 3,
        expression: 4,
        stageVisibility: 5,
      },
      tags: ['view'],
    });
  });

  it('keeps important searchable fields in the document text', () => {
    expect(buildSeatReviewRagDocument(review as never)).toContain(
      'Sejong Theater',
    );
    expect(buildSeatReviewRagDocument(review as never)).toContain('Hamlet');
    expect(buildSeatReviewRagDocument(review as never)).toContain('2F A 7');
  });
});
