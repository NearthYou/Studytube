type ReviewContentPanelProps = {
  content: string
  onChange: (content: string) => void
}

export default function ReviewContentPanel({ content, onChange }: ReviewContentPanelProps) {
  return (
    <section className="review-create-panel">
      <h2 className="review-create-section-title">후기</h2>
      <textarea
        className="review-create-textarea"
        aria-describedby="review-content-hint"
        minLength={10}
        value={content}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="review-create-field-hint" id="review-content-hint">
        후기는 10자 이상 입력해주세요.
      </p>
    </section>
  )
}
