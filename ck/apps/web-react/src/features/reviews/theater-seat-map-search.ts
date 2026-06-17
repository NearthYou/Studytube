import type { SeatReviewSearchParams } from "./types.ts"

const theaterSeatMapPageLimit = 50

export function buildTheaterSeatMapSearchParams(theaterId: string | undefined): SeatReviewSearchParams {
  return {
    page: 1,
    limit: theaterSeatMapPageLimit,
    theaterId,
    sort: "latest",
  }
}
