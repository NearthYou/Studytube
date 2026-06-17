import { agentApiRequest } from "../../shared/agent-api"
import type { SeatRecommendation, SeatRecommendationInput } from "./types"

export function askSeatRecommendation(input: SeatRecommendationInput) {
  return agentApiRequest<SeatRecommendation>("/agent/seat-recommendations", {
    method: "POST",
    body: JSON.stringify(input),
  })
}
