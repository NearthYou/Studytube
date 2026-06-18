import { useEffect, useState } from "react"
import { getSeatReviews } from "../api"
import { loadAllSeatReviewPages } from "../review-pagination"
import type { PublicSeatReview, SeatReviewSearchParams } from "../types"

type UseSeatReviewsOptions = {
  enabled?: boolean
  loadAllPages?: boolean
}

export function useSeatReviews(
  params: SeatReviewSearchParams = {},
  options: UseSeatReviewsOptions = {},
) {
  const isEnabled = options.enabled ?? true
  const loadAllPages = options.loadAllPages ?? false
  const paramsKey = JSON.stringify(params)
  const [reviews, setReviews] = useState<PublicSeatReview[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(params.page ?? 1)
  const [limit, setLimit] = useState(params.limit ?? 20)
  const [hasNext, setHasNext] = useState(false)
  const [isLoading, setIsLoading] = useState(isEnabled)
  const [error, setError] = useState("")

  useEffect(() => {
    let isMounted = true

    if (!isEnabled) {
      return () => {
        isMounted = false
      }
    }

    async function loadReviews() {
      try {
        setError("")
        setIsLoading(true)

        const requestParams = JSON.parse(paramsKey) as SeatReviewSearchParams
        const result = loadAllPages
          ? {
              items: await loadAllSeatReviewPages((pageParams) =>
                getSeatReviews({ ...requestParams, ...pageParams }),
              ),
              total: 0,
              page: 1,
              limit: requestParams.limit ?? 50,
              hasNext: false,
            }
          : await getSeatReviews(requestParams)

        if (isMounted) {
          setReviews(result.items)
          setTotal(loadAllPages ? result.items.length : result.total)
          setPage(result.page)
          setLimit(result.limit)
          setHasNext(result.hasNext)
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "후기 목록을 불러오지 못했습니다.")
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadReviews()

    return () => {
      isMounted = false
    }
  }, [isEnabled, loadAllPages, paramsKey])

  return {
    reviews,
    total,
    page,
    limit,
    hasNext,
    isLoading,
    error,
    removeReview(reviewId: string) {
      setReviews((currentReviews) => currentReviews.filter((review) => review.id !== reviewId))
      setTotal((currentTotal) => Math.max(0, currentTotal - 1))
    },
  }
}
