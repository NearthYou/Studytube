export type TagSeatReviewsQuery = {
  page?: number;
  limit?: number;
};

export function buildTagSeatReviewsPath(tagId: string, query: TagSeatReviewsQuery = {}) {
  const searchParams = new URLSearchParams();

  if (query.page) {
    searchParams.set("page", String(query.page));
  }

  if (query.limit) {
    searchParams.set("limit", String(query.limit));
  }

  const queryString = searchParams.toString();
  return queryString ? `/tags/${tagId}/seat-reviews?${queryString}` : `/tags/${tagId}/seat-reviews`;
}
