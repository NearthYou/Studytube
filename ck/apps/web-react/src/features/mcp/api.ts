import { agentApiRequest } from "../../shared/agent-api"
import type { CacheRefreshResponse, McpSeatLayout } from "./types"

export function getMcpSeatLayout(theaterName: string, options: { simulateFailure?: boolean } = {}) {
  const searchParams = new URLSearchParams()

  if (options.simulateFailure) {
    searchParams.set("simulateFailure", "true")
  }

  const queryString = searchParams.toString()
  const path = `/mcp/seat-layouts/${encodeURIComponent(theaterName)}${
    queryString ? `?${queryString}` : ""
  }`

  return agentApiRequest<McpSeatLayout>(path)
}

export function refreshMcpCache() {
  return agentApiRequest<CacheRefreshResponse>("/mcp/cache/refresh", {
    method: "POST",
  })
}
