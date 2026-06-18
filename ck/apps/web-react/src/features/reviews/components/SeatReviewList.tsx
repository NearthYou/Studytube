import { useEffect, useState } from "react"
import { getSeatReviews } from "../api"
import type { PublicSeatReview } from "../types"

type SeatReviewListProps = {
  performanceId?: string
}

export default function SeatReviewList({ performanceId }: SeatReviewListProps) {
  const [reviews, setReviews] = useState<PublicSeatReview[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    async function loadReviews() {
      try {
        const result = await getSeatReviews({ performanceId })
        setReviews(result.items)
      } catch (err) {
        setError(err instanceof Error ? err.message : "후기 목록을 불러오지 못했습니다.")
      }
    }

    void loadReviews()
  }, [performanceId])

  if (error) {
    return <p style={{ color: "crimson" }}>{error}</p>
  }

  return (
    <section>
      <h2>최근 후기</h2>
      {reviews.map((review) => (
        <article key={review.id}>
          <h3>
            {review.theater.name} / {review.musical.title}
          </h3>
          <p>
            {review.seat.floor}
            {review.seat.section ? ` ${review.seat.section}구역` : ""} {review.seat.row}열{" "}
            {review.seat.number}번
          </p>
          <p>{review.content}</p>
        </article>
      ))}
    </section>
  )
}