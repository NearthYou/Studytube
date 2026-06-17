import type { PublicSeatReview } from "../types"

type SeatReviewCardProps = {
  review: PublicSeatReview
  onSelect?: (review: PublicSeatReview) => void
  onTheaterSelect?: (review: PublicSeatReview) => void
  onEdit?: (review: PublicSeatReview) => void
  onDelete?: (review: PublicSeatReview) => void
  onReport?: (review: PublicSeatReview) => void
  variant?: "default" | "detail"
  canManage?: boolean
}

const ratingText: Record<number, string> = {
  1: "최악",
  2: "나쁨",
  3: "보통",
  4: "좋음",
  5: "최고",
}

function getRatingLabel(value: number) {
  return ratingText[value] ?? String(value)
}

function getPerformanceTitle(review: PublicSeatReview) {
  return [review.performance?.seasonLabel, review.musical.title].filter(Boolean).join(" ")
}

function getSeatLabel(review: PublicSeatReview) {
  return [
    review.seat.floor,
    review.seat.section ? `${review.seat.section} 구역` : "",
    review.seat.row ? `${review.seat.row}열` : "",
    review.seat.number ? `${review.seat.number}번` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export default function SeatReviewCard({
  review,
  onSelect,
  onTheaterSelect,
  onEdit,
  onDelete,
  onReport,
  variant = "default",
  canManage = false,
}: SeatReviewCardProps) {
  const isInteractive = Boolean(onSelect)
  const tags = review.tags ?? []

  return (
    <article
      className={`board-review-card board-review-card--${variant}`}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={isInteractive ? () => onSelect?.(review) : undefined}
      onKeyDown={
        isInteractive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onSelect?.(review)
              }
            }
          : undefined
      }
    >
      <p className="board-review-content">{review.content}</p>

      <div className="board-review-meta">
        <h2>{getPerformanceTitle(review)}</h2>
        {onTheaterSelect ? (
          <button
            className="board-review-theater-link"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onTheaterSelect(review)
            }}
          >
            {review.theater.name}
          </button>
        ) : (
          <p>{review.theater.name}</p>
        )}
        <p>{getSeatLabel(review)}</p>
        <p className="board-review-byline">
          {review.author.nickname} - {formatCreatedAt(review.createdAt)}
        </p>
      </div>

      <div className="board-rating-tags" aria-label="평가">
        <span>시야 {getRatingLabel(review.ratings.view)}</span>
        <span>음향 {getRatingLabel(review.ratings.sound)}</span>
        <span>좌석 {getRatingLabel(review.ratings.comfort)}</span>
        <span>표정 {getRatingLabel(review.ratings.expression)}</span>
        <span>무대 {getRatingLabel(review.ratings.stageVisibility)}</span>
      </div>

      {tags.length > 0 || onReport ? (
        <div className="board-review-tags" aria-label="태그와 신고">
          {tags.map((tag) => (
            <span key={tag.id}>{tag.name}</span>
          ))}
          {onReport ? (
            <button
              className="board-review-report-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onReport(review)
              }}
            >
              신고
            </button>
          ) : null}
        </div>
      ) : null}

      {canManage ? (
        <div className="board-review-actions">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onEdit?.(review)
            }}
          >
            수정
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onDelete?.(review)
            }}
          >
            삭제
          </button>
        </div>
      ) : null}
    </article>
  )
}
