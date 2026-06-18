import { getSeatFilterScopeReviews, matchesReviewBoardFilter } from "./review-board-filters.ts";
import type { ReviewBoardFilter } from "./review-board-filters.ts";
import type { PublicSeatReview } from "./types.ts";

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function makeReview(input: {
  id: string;
  tags: NonNullable<PublicSeatReview["tags"]>;
  content?: string;
}): PublicSeatReview {
  return {
    id: input.id,
    author: { id: "1", nickname: "tester" },
    theater: { id: "theater-1", name: "Test Theater" },
    musical: { id: "musical-1", title: "Test Musical" },
    performance: { id: "performance-1", seasonLabel: "2026" },
    seat: { floor: "1F", section: "A", row: "1", number: "1" },
    ratings: {
      view: 4,
      sound: 4,
      comfort: 4,
      expression: 4,
      stageVisibility: 4,
    },
    content: input.content ?? "clear view",
    tags: input.tags,
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  };
}

const reviews = [
  makeReview({ id: "1", tags: [{ id: "2", name: "첫관람추천", type: "viewing_purpose" }] }),
  makeReview({ id: "2", tags: [{ id: "3", name: "시야좋음", type: "seat_feature" }] }),
];

const tagFilter: ReviewBoardFilter = {
  id: "2",
  label: "첫관람추천",
  mode: "tag",
};

assertEqual(matchesReviewBoardFilter(reviews[0], tagFilter), true);
assertEqual(matchesReviewBoardFilter(reviews[1], tagFilter), false);

const tagSearchedReviews = getSeatFilterScopeReviews(reviews, {
  searchText: "첫관람",
  selectedFilter: null,
});

assertEqual(tagSearchedReviews.length, 1);
assertEqual(tagSearchedReviews[0].id, "1");

console.log("review-board-tag-filters tests passed.");
