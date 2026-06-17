import type { SeatOption } from "../reviews/types"

export type McpSeatLayoutMetadata = {
  externalScope: string[]
  mappingRules: string[]
  cacheTtlSeconds: number
}

export type McpSeatLayout = {
  theaterName: string
  canonicalTheaterName: string
  source: string
  status: "ok" | "fallback" | string
  cached: boolean
  isFallback: boolean
  updatedAt: string
  floors: SeatOption[]
  sectionsByFloor: Record<string, SeatOption[]>
  aiBlocksByFloor: Record<string, SeatOption[]>
  seatMapUrl?: string | null
  metadata: McpSeatLayoutMetadata
}

export type CacheRefreshResponse = {
  refreshed: boolean
  clearedKeys: number
}
