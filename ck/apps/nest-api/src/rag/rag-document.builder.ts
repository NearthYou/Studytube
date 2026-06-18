import { Prisma } from '@prisma/client';

export const ragSeatReviewInclude = {
  theater: true,
  musical: true,
  performance: true,
  seatReviewTags: {
    include: {
      tag: true,
    },
  },
} satisfies Prisma.SeatReviewInclude;

export type RagSeatReview = Prisma.SeatReviewGetPayload<{
  include: typeof ragSeatReviewInclude;
}>;

export function buildSeatReviewRagDocument(review: RagSeatReview) {
  const tags =
    review.seatReviewTags.map(({ tag }) => tag.name).join(', ') || '없음';
  const section = review.seatSection ?? '구역 정보 없음';
  const season = review.performance?.seasonLabel ?? '시즌 정보 없음';

  return [
    `후기 ID: ${review.id.toString()}`,
    `극장: ${review.theater.name}`,
    `작품: ${review.musical.title}`,
    `시즌: ${season}`,
    `좌석: ${review.seatFloor} ${section} ${review.seatRow}열 ${review.seatNumber}번`,
    `시야 평점: ${review.viewRating}/5`,
    `음향 평점: ${review.soundRating}/5`,
    `좌석 편안함 평점: ${review.comfortRating}/5`,
    `배우 표정 체감 평점: ${review.expressionRating}/5`,
    `무대 전체 체감 평점: ${review.stageVisibilityRating}/5`,
    `태그: ${tags}`,
    `후기 본문: ${review.content}`,
  ].join('\n');
}

export function buildSeatReviewRagMetadata(review: RagSeatReview) {
  return {
    documentVersion: 'seat-review-v2',
    reviewId: review.id.toString(),
    theaterId: review.theater.id.toString(),
    theaterName: review.theater.name,
    musicalId: review.musical.id.toString(),
    musicalTitle: review.musical.title,
    performanceId: review.performance?.id.toString() ?? null,
    seasonLabel: review.performance?.seasonLabel ?? null,
    seat: {
      floor: review.seatFloor,
      section: review.seatSection,
      row: review.seatRow,
      number: review.seatNumber,
    },
    ratings: {
      view: review.viewRating,
      sound: review.soundRating,
      comfort: review.comfortRating,
      expression: review.expressionRating,
      stageVisibility: review.stageVisibilityRating,
    },
    tags: review.seatReviewTags.map(({ tag }) => tag.name),
  };
}
