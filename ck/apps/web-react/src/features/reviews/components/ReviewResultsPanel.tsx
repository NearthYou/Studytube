import { lazy, Suspense } from "react"
import SeatReviewCard from "./SeatReviewCard"
import type { PublicSeatReview } from "../types"

const TheaterSeatMap = lazy(() => import("./TheaterSeatMap"))

export type ReviewResultsViewMode = "board" | "seatMap"

type ReviewResultsPanelProps = {
  actionError: string
  currentUserId?: string
  error: string
  hasNext: boolean
  isLoading: boolean
  onDeleteReview: (review: PublicSeatReview) => void
  onEditReview: (review: PublicSeatReview) => void
  onNextPage: () => void
  onPreviousPage: () => void
  onReportReview: (review: PublicSeatReview) => void
  onSelectReview: (review: PublicSeatReview) => void
  onTheaterSelect?: (review: PublicSeatReview) => void
  page: number
  reviews: PublicSeatReview[]
  theaterName: string
  total: number
  totalPages: number
  viewMode: ReviewResultsViewMode
}

export default function ReviewResultsPanel({
  actionError,
  currentUserId,
  error,
  hasNext,
  isLoading,
  onDeleteReview,
  onEditReview,
  onNextPage,
  onPreviousPage,
  onReportReview,
  onSelectReview,
  onTheaterSelect,
  page,
  reviews,
  theaterName,
  total,
  totalPages,
  viewMode,
}: ReviewResultsPanelProps) {
  return (
    <>
      {isLoading ? <p className="review-board-state">후기 목록을 불러오는 중입니다.</p> : null}
      {error ? <p className="review-board-state review-board-state--error">{error}</p> : null}
      {actionError ? (
        <p className="review-board-state review-board-state--error">{actionError}</p>
      ) : null}

      {!error && viewMode === "board" ? (
        <div className="review-board-result-summary">
          <span>
            총 {total.toLocaleString()}개 · {page}/{totalPages}페이지
          </span>
          <div className="review-board-pagination">
            <button type="button" disabled={isLoading || page <= 1} onClick={onPreviousPage}>
              이전
            </button>
            <button type="button" disabled={isLoading || !hasNext} onClick={onNextPage}>
              다음
            </button>
          </div>
        </div>
      ) : null}

      {!isLoading && !error ? (
        viewMode === "seatMap" ? (
          <Suspense fallback={<p className="review-board-state">좌석배치도를 불러오는 중입니다.</p>}>
            <TheaterSeatMap
              currentUserId={currentUserId}
              onDeleteReview={onDeleteReview}
              onEditReview={onEditReview}
              onReportReview={onReportReview}
              reviews={reviews}
              theaterName={theaterName}
            />
          </Suspense>
        ) : (
          <div className="review-board-list">
            {reviews.length > 0 ? (
              reviews.map((review) => (
                <SeatReviewCard
                  canManage={review.author.id === currentUserId}
                  key={review.id}
                  onDelete={onDeleteReview}
                  onEdit={onEditReview}
                  onReport={onReportReview}
                  onSelect={onSelectReview}
                  onTheaterSelect={onTheaterSelect}
                  review={review}
                />
              ))
            ) : (
              <p className="review-board-state">보여줄 후기가 없습니다.</p>
            )}
          </div>
        )
      ) : null}
    </>
  )
}
