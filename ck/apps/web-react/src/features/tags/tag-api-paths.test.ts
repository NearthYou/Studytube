import { buildTagSeatReviewsPath } from "./tag-api-paths.ts";

function assertEqual(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, received ${actual}`);
  }
}

assertEqual(buildTagSeatReviewsPath("2"), "/tags/2/seat-reviews");
assertEqual(buildTagSeatReviewsPath("2", { page: 2 }), "/tags/2/seat-reviews?page=2");
assertEqual(buildTagSeatReviewsPath("2", { limit: 10 }), "/tags/2/seat-reviews?limit=10");
assertEqual(
  buildTagSeatReviewsPath("2", { page: 2, limit: 10 }),
  "/tags/2/seat-reviews?page=2&limit=10",
);

console.log("tag-api-paths tests passed.");
