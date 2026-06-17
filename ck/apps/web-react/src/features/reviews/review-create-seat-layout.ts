import type { PublicSeatReview, TheaterOption } from "./types"

export function getSelectedTheaterForSeatLayout(input: {
  theaters: TheaterOption[]
  selectedTheaterId: string
  editingReview: PublicSeatReview | null
}) {
  const selectedTheater =
    input.theaters.find((theater) => theater.id === input.selectedTheaterId) ?? null

  if (selectedTheater) {
    return selectedTheater
  }

  if (input.editingReview?.theater.id === input.selectedTheaterId) {
    return input.editingReview.theater
  }

  return null
}
