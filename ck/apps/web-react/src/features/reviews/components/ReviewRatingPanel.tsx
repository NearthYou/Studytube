export type ReviewRatingKey =
  | "viewRating"
  | "soundRating"
  | "comfortRating"
  | "expressionRating"
  | "stageVisibilityRating"

export type ReviewRatingValues = Record<ReviewRatingKey, number>

type ReviewRatingPanelProps = {
  onChange: (ratings: ReviewRatingValues) => void
  ratings: ReviewRatingValues
}

const ratingOptions = [
  { value: 1, label: "최악" },
  { value: 2, label: "나쁨" },
  { value: 3, label: "보통" },
  { value: 4, label: "좋음" },
  { value: 5, label: "최고" },
]

const ratingFields: Array<{ key: ReviewRatingKey; label: string }> = [
  { key: "viewRating", label: "시야" },
  { key: "soundRating", label: "음향" },
  { key: "comfortRating", label: "좌석" },
  { key: "expressionRating", label: "표정 체감" },
  { key: "stageVisibilityRating", label: "무대 전체 체감" },
]

export default function ReviewRatingPanel({ onChange, ratings }: ReviewRatingPanelProps) {
  return (
    <section className="review-create-panel">
      <h2 className="review-create-section-title">평점</h2>
      <div className="review-create-ratings">
        {ratingFields.map((field) => (
          <div className="review-create-rating-row" key={field.key}>
            <span className="review-create-rating-label">{field.label}</span>
            <div className="review-create-rating-options">
              {ratingOptions.map((option) => (
                <button
                  key={option.value}
                  className="review-create-chip"
                  type="button"
                  aria-pressed={ratings[field.key] === option.value}
                  onClick={() => onChange({ ...ratings, [field.key]: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
