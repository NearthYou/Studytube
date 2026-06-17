export type RagIntent =
  | "general"
  | "view"
  | "sound"
  | "comfort"
  | "expression"
  | "stageVisibility"

export type RagQuestionFilters = {
  theaterId?: string
  theaterName?: string
  musicalId?: string
  musicalTitle?: string
  seatFloor?: string
  seatSection?: string
  seatRow?: string
  seatNumber?: string
  side?: "left" | "center" | "right"
  intent: RagIntent
}

export type RagSource = {
  id: string
  score: number
  theater: {
    id: string
    name: string
  }
  musical: {
    id: string
    title: string
  }
  performance: {
    id: string
    seasonLabel: string | null
  } | null
  seat: {
    floor: string
    section: string | null
    row: string
    number: string
  }
  ratings: {
    view: number
    sound: number
    comfort: number
    expression: number
    stageVisibility: number
  }
  tags: string[]
  content: string
}

export type RagAnswer = {
  answer: string
  reasons: string[]
  filters: RagQuestionFilters
  sources: RagSource[]
}
