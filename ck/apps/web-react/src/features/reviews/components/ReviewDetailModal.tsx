import ReviewComments from "../../comments/components/ReviewComments"
import SeatReviewCard from "./SeatReviewCard"
import type { PublicSeatReview } from "../types"

type ReviewDetailModalProps = {
  currentUserId?: string
  isAuthenticated: boolean
  onClose: () => void
  onDeleteReview: (review: PublicSeatReview) => void
  onEditReview: (review: PublicSeatReview) => void
  onReportReview: (review: PublicSeatReview) => void
  review: PublicSeatReview
}

export default function ReviewDetailModal({
  currentUserId,
  isAuthenticated,
  onClose,
  onDeleteReview,
  onEditReview,
  onReportReview,
  review,
}: ReviewDetailModalProps) {
  return (
    <div
      className="review-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-detail-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="review-detail-card">
        <header>
          <div>
            <p>선택한 후기</p>
            <h2 id="review-detail-title">후기 상세</h2>
          </div>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </header>
        <SeatReviewCard
          canManage={review.author.id === currentUserId}
          onDelete={onDeleteReview}
          onEdit={onEditReview}
          onReport={onReportReview}
          review={review}
          variant="detail"
        />
        <ReviewComments
          currentUserId={currentUserId}
          isAuthenticated={isAuthenticated}
          reviewId={review.id}
        />
      </section>
    </div>
  )
}
