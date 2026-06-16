import type { Language } from './language'
import { AI_BASE_URL } from './env'

export { AI_BASE_URL }

export type TravelAgentRequest = {
  query: string
  sessionId?: string
  region: string
  budget: string
  theme: string
  season: string
  companion: string
  travelDate: string
  duration: number
  language?: Language
  planStyle?: 'balanced' | 'budget' | 'slow'
}

export type AiWeather = {
  headline: string
  temperature: string
  travel_verdict: string
  caution: string
}

export type AiSource = {
  post_id: number
  title: string
  summary: string
  region: string
  theme: string
  companion: string
  travel_date: string
  matched_excerpt: string
  score?: number | null
  comment_highlights: string[]
}

export type AiPlanStop = {
  time: string
  title: string
  description: string
  estimated_cost: string
}

export type AiPlanDay = {
  day_label: string
  theme: string
  stops: AiPlanStop[]
}

export type AiTrace = {
  tool: string
  purpose: string
  summary: string
}

export type AiAgentResponse = {
  session_id?: string | null
  answer: string
  retrieval_summary: string
  weather: AiWeather
  sources: AiSource[]
  plan: AiPlanDay[]
  trace: AiTrace[]
}

export type AiPlanResponse = AiAgentResponse & {
  style: 'balanced' | 'budget' | 'slow'
}

async function requestAiJson<T>(path: string, payload: TravelAgentRequest) {
  const response = await fetch(`${AI_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: payload.query,
      session_id: payload.sessionId ?? '',
      region: payload.region,
      budget: payload.budget,
      theme: payload.theme,
      season: payload.season,
      companion: payload.companion,
      travel_date: payload.travelDate,
      duration: payload.duration,
      language: payload.language ?? 'ko',
      plan_style: payload.planStyle ?? 'balanced',
    }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
        ? data.detail
        : 'AI request failed.'
    throw new Error(message)
  }

  return data as T
}

export function requestTravelChat(payload: TravelAgentRequest) {
  return requestAiJson<AiAgentResponse>('/agent/chat', payload)
}

export function requestTravelPlan(payload: TravelAgentRequest) {
  return requestAiJson<AiPlanResponse>('/agent/plan', payload)
}
