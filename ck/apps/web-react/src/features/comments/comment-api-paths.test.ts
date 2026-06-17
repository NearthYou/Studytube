import { buildCommentListPath } from "./comment-api-paths.ts";

function assertEqual(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, received ${actual}`);
  }
}

assertEqual(buildCommentListPath("7"), "/seat-reviews/7/comments");
assertEqual(buildCommentListPath("7", "latest"), "/seat-reviews/7/comments?sort=latest");
assertEqual(buildCommentListPath("7", "oldest"), "/seat-reviews/7/comments?sort=oldest");

console.log("comment-api-paths tests passed.");
