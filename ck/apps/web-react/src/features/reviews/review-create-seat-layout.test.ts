import { getSelectedTheaterForSeatLayout } from "./review-create-seat-layout.ts";
import type { PublicSeatReview } from "./types.ts";

function assertDeepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const editingReview: PublicSeatReview = {
  id: "review-1",
  author: { id: "user-1", nickname: "tester" },
  theater: { id: "theater-1", name: "Multi Floor Theater" },
  musical: { id: "musical-1", title: "Test Musical" },
  performance: { id: "performance-1", seasonLabel: "2026" },
  seat: { floor: "3층", section: "A", row: "1", number: "1" },
  ratings: {
    view: 5,
    sound: 5,
    comfort: 5,
    expression: 5,
    stageVisibility: 5,
  },
  content: "Great view",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z",
};

const selectedTheater = getSelectedTheaterForSeatLayout({
  theaters: [],
  selectedTheaterId: editingReview.theater.id,
  editingReview,
});

assertDeepEqual(selectedTheater, editingReview.theater);

console.log("review-create-seat-layout tests passed.");
