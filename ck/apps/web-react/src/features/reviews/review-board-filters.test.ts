import {
  canOpenTheaterReviewPage,
  getReviewBoardTheaterFilters,
  getReviewBoardDisplayReviews,
  getSeatFilterScopeReviews,
  getSortedUniqueSeatValues,
  matchesReviewBoardFilter,
} from "./review-board-filters.ts";
import type { ReviewBoardFilter } from "./review-board-filters.ts";
import type { PublicSeatReview } from "./types.ts";

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function makeReview(input: {
  id: string;
  theaterId: string;
  theaterName: string;
  performanceId: string;
  floor: string;
  section?: string | null;
  content?: string;
}): PublicSeatReview {
  return {
    id: input.id,
    author: { id: "1", nickname: "tester" },
    theater: { id: input.theaterId, name: input.theaterName },
    musical: { id: "1", title: "지킬 앤 하이드" },
    performance: { id: input.performanceId, seasonLabel: "2024-2025" },
    seat: { floor: input.floor, section: input.section, row: "1", number: "1" },
    ratings: {
      view: 4,
      sound: 4,
      comfort: 4,
      expression: 4,
      stageVisibility: 4,
    },
    content: input.content ?? "좋은 시야",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  };
}

const reviews = [
  makeReview({
    id: "1",
    theaterId: "blue",
    theaterName: "블루스퀘어 신한카드홀",
    performanceId: "p1",
    floor: "2층",
    section: "C",
  }),
  makeReview({
    id: "2",
    theaterId: "blue",
    theaterName: "블루스퀘어 신한카드홀",
    performanceId: "p1",
    floor: "1층",
    section: "A",
  }),
  makeReview({
    id: "3",
    theaterId: "charlotte",
    theaterName: "샤롯데씨어터",
    performanceId: "p2",
    floor: "3층",
    section: "D",
  }),
];

const blueSquareFilter: ReviewBoardFilter = {
  id: "blue",
  label: "블루스퀘어 신한카드홀",
  mode: "theater",
  aliases: ["블루스퀘어 신한카드홀"],
};

assertEqual(canOpenTheaterReviewPage(blueSquareFilter), true);
const emptyReviewTheaterFilters = getReviewBoardTheaterFilters({
  reviews: [],
  theaters: [{ id: "theater-empty", name: "Empty Theater" }],
  query: "empty",
});

assertEqual(emptyReviewTheaterFilters.length, 1);
assertEqual(emptyReviewTheaterFilters[0].id, "theater-empty");
assertEqual(canOpenTheaterReviewPage(emptyReviewTheaterFilters[0]), true);

assertEqual(
  canOpenTheaterReviewPage({
    id: "seat-map:세종문화회관 대극장",
    label: "세종문화회관 대극장",
    mode: "theater",
  }),
  false,
);
assertEqual(
  canOpenTheaterReviewPage({
    id: "p1",
    label: "지킬 앤 하이드",
    mode: "work",
  }),
  false,
);

assertEqual(matchesReviewBoardFilter(reviews[0], blueSquareFilter), true);
assertEqual(matchesReviewBoardFilter(reviews[2], blueSquareFilter), false);

const scopedReviews = getSeatFilterScopeReviews(reviews, {
  searchText: "",
  selectedFilter: blueSquareFilter,
});

assertDeepEqual(
  getSortedUniqueSeatValues(scopedReviews, (review) => review.seat.floor),
  ["1층", "2층"],
);
assertDeepEqual(
  getSortedUniqueSeatValues(scopedReviews, (review) => review.seat.section),
  ["A", "C"],
);

const searchedReviews = getSeatFilterScopeReviews(reviews, {
  searchText: "시야",
  selectedFilter: null,
});

assertEqual(searchedReviews.length, 3);

const filteredBoardReviews = [scopedReviews[0]];

assertDeepEqual(
  getReviewBoardDisplayReviews({
    viewMode: "board",
    visibleReviews: filteredBoardReviews,
    seatMapReviews: scopedReviews,
  }),
  filteredBoardReviews,
);

assertDeepEqual(
  getReviewBoardDisplayReviews({
    viewMode: "seatMap",
    visibleReviews: filteredBoardReviews,
    seatMapReviews: scopedReviews,
  }),
  scopedReviews,
);

console.log("review-board-filters tests passed.");
