type ReviewCreateActionsProps = {
  isEditMode: boolean
  isSubmitting: boolean
  onCancel: () => void
}

export default function ReviewCreateActions({
  isEditMode,
  isSubmitting,
  onCancel,
}: ReviewCreateActionsProps) {
  return (
    <div className="review-create-actions">
      <button className="review-create-action" type="button" onClick={onCancel}>
        나가기
      </button>
      <button className="review-create-action" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "저장 중..." : isEditMode ? "수정하기" : "저장하기"}
      </button>
    </div>
  )
}
