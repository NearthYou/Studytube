import { apiRequest } from "../../shared/api"
import { buildSeatReviewSearchPath } from "./review-search-query"
import type {
  CreateSeatReviewPayload,
  MusicalOption,
  PerformanceOption,
  PublicSeatReview,
  SeatReviewListResponse,
  SeatReviewSearchParams,
  TheaterOption,
  UpdateSeatReviewPayload,
} from "./types"

export function getTheaters() {
  return apiRequest<TheaterOption[]>("/theaters")
}

export function getMusicals() {
  return apiRequest<MusicalOption[]>("/musicals")
}

type GetPerformancesParams = {
  theaterId?: string
  musicalId?: string
}

export function getPerformances(params: GetPerformancesParams = {}) {
  const searchParams = new URLSearchParams()

  if (params.theaterId) {
    searchParams.set("theaterId", params.theaterId)
  }

  if (params.musicalId) {
    searchParams.set("musicalId", params.musicalId)
  }

  const queryString = searchParams.toString()
  const path = queryString ? `/performances?${queryString}` : "/performances"

  return apiRequest<PerformanceOption[]>(path)
}

export function createSeatReview(input: CreateSeatReviewPayload) {
  return apiRequest<PublicSeatReview>("/seat-reviews", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function getSeatReviews(params: SeatReviewSearchParams = {}) {
  return apiRequest<SeatReviewListResponse>(buildSeatReviewSearchPath(params))
}

export function getSeatReview(id: string) {
  return apiRequest<PublicSeatReview>(`/seat-reviews/${id}`)
}

export function updateSeatReview(id: string, input: UpdateSeatReviewPayload) {
  return apiRequest<PublicSeatReview>(`/seat-reviews/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export function deleteSeatReview(id: string) {
  return apiRequest<{ delete: boolean }>(`/seat-reviews/${id}`, {
    method: "DELETE",
  })
}

export function reportSeatReview(id: string, reason: string, detail?: string) {
  return apiRequest<{ id: string }>(`/seat-reviews/${id}/reports`, {
    method: "POST",
    body: JSON.stringify({ reason, detail }),
  })
}
