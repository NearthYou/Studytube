import { useState, type FormEvent } from "react"
import type { PublicSeatReview } from "../types"

type ReportReviewDialogProps = {
  error?: string
  isSubmitting: boolean
  onCancel: () => void
  onSubmit: (reason: string) => Promise<void> | void
  review: PublicSeatReview
}

function getReviewLabel(review: PublicSeatReview) {
  return [review.musical.title, review.theater.name, review.seat.section]
    .filter(Boolean)
    .join(" · ")
}

export default function ReportReviewDialog({
  error,
  isSubmitting,
  onCancel,
  onSubmit,
  review,
}: ReportReviewDialogProps) {
  const [reason, setReason] = useState("")
  const [validationError, setValidationError] = useState("")

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedReason = reason.trim()

    if (!trimmedReason) {
      setValidationError("신고 사유를 입력해주세요.")
      return
    }

    setValidationError("")
    await onSubmit(trimmedReason)
  }

  const visibleError = validationError || error

  return (
    <div
      className="review-report-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-report-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onCancel()
        }
      }}
    >
      <form className="review-report-card" onSubmit={handleSubmit}>
        <header>
          <div>
            <p>후기 신고</p>
            <h2 id="review-report-title">신고 사유를 알려주세요</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={isSubmitting}>
            닫기
          </button>
        </header>

        <p className="review-report-target">{getReviewLabel(review)}</p>

        <label className="review-report-field">
          <span>신고 사유</span>
          <textarea
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="예: 스팸, 욕설, 공연/좌석과 관련 없는 내용"
            disabled={isSubmitting}
          />
        </label>

        {visibleError ? <p className="review-report-error">{visibleError}</p> : null}

        <div className="review-report-actions">
          <button type="button" onClick={onCancel} disabled={isSubmitting}>
            취소
          </button>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "접수 중" : "신고 접수"}
          </button>
        </div>
      </form>
    </div>
  )
}
