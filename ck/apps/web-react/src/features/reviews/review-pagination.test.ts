import { loadAllSeatReviewPages } from "./review-pagination.ts";
import type { PublicSeatReview, SeatReviewListResponse } from "./types.ts";

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

function makeReview(id: number): PublicSeatReview {
  return {
    id: String(id),
    author: { id: "1", nickname: "tester" },
    theater: { id: "1", name: "블루스퀘어 신한카드홀" },
    musical: { id: "1", title: "지킬 앤 하이드" },
    performance: { id: "1", seasonLabel: "2024-2025" },
    seat: { floor: "1층", section: "B", row: String(id), number: "1" },
    ratings: {
      view: 4,
      sound: 4,
      comfort: 4,
      expression: 4,
      stageVisibility: 4,
    },
    content: `review ${id}`,
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  };
}

const requestedPages: number[] = [];

const reviews = await loadAllSeatReviewPages(async ({ page, limit }) => {
  requestedPages.push(page ?? 0);

  const total = 120;
  const currentPage = page ?? 1;
  const currentLimit = limit ?? 50;
  const start = (currentPage - 1) * currentLimit;
  const end = Math.min(start + currentLimit, total);

  return {
    items: Array.from({ length: end - start }, (_, index) => makeReview(start + index + 1)),
    total,
    page: currentPage,
    limit: currentLimit,
    hasNext: end < total,
  } satisfies SeatReviewListResponse;
});

assertEqual(reviews.length, 120);
assertDeepEqual(requestedPages, [1, 2, 3]);

console.log("review-pagination tests passed.");
