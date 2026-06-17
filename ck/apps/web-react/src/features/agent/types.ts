import type { RagAnswer } from "../rag/types"

export type AgentPriority =
  | "view"
  | "sound"
  | "comfort"
  | "expression"
  | "stageVisibility"
  | "lowObstruction"

export type AgentFilters = {
  theaterName?: string | null
  musicalTitle?: string | null
  seasonLabel?: string | null
  seatFloor?: string | null
  seatSection?: string | null
  side?: "left" | "center" | "right" | null
  priorities: AgentPriority[]
  budget?: number | null
}

export type EvidenceReview = {
  id: string
  theaterName: string
  musicalTitle: string
  seasonLabel?: string | null
  seat: string
  ratings: Record<string, number>
  tags: string[]
  content: string
}

export type SeatRecommendation = {
  recommendation: string
  officialSection?: string | null
  descriptiveBlock?: string | null
  direction: string
  reasons: string[]
  cautions: string[]
  evidenceReviews: EvidenceReview[]
  filters: AgentFilters
  mcpStatus: string
  ragStatus: string
  ragAnswer?: string | null
}

export type SeatRecommendationInput = {
  question: string
  theaterName?: string
  musicalTitle?: string
  seasonLabel?: string
  priorities?: AgentPriority[]
  limit?: number
  useRag?: boolean
}

export type RagPanelResult = RagAnswer
