import type { SeatReviewListResponse } from "./types";

type SeatReviewPageRequest = {
  page?: number;
  limit?: number;
};

type SeatReviewPageLoader = (
  params: SeatReviewPageRequest,
) => Promise<SeatReviewListResponse>;

const reviewPageLimit = 50;

export async function loadAllSeatReviewPages(loadPage: SeatReviewPageLoader) {
  const firstPage = await loadPage({ page: 1, limit: reviewPageLimit });
  const allReviews = [...firstPage.items];
  const totalPages = Math.ceil(firstPage.total / firstPage.limit);

  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await loadPage({ page, limit: firstPage.limit });
    allReviews.push(...nextPage.items);
  }

  return allReviews;
}
