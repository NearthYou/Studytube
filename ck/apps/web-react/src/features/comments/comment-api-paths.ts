export type CommentSort = "oldest" | "latest";

export function buildCommentListPath(reviewId: string, sort?: CommentSort) {
  const basePath = `/seat-reviews/${reviewId}/comments`;

  return sort ? `${basePath}?sort=${sort}` : basePath;
}
