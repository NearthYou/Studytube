import { apiPost } from './client'

export type AgentRiskLevel = 'none' | 'behavior_support' | 'caution' | 'vet_consult' | 'emergency'

export type AgentCard = {
  type: 'post' | 'place'
  id: string
  title: string
  href: string
}

export type AgentSource = {
  title: string
  excerpt?: string
  year?: number | null
  pmid?: string | null
  pmcid?: string | null
  url?: string | null
  sourceType?: string | null
}

export type AgentPlace = {
  contentId: string
  title: string
  address?: string
  firstImage?: string
  mapX?: string
  mapY?: string
}

export type AgentSafety = {
  action?: string
  blockedTerms?: string[]
  redFlagDetected?: boolean
  riskLevel?: AgentRiskLevel
  triggeredRules?: string[]
}

export type AgentConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AgentMessagePayload = {
  message: string
  history?: AgentConversationMessage[]
  context?: {
    route?: string
    postId?: string
    categoryId?: string
  }
}

export type AgentMessageResponse = {
  answer: string
  answerProvider?: 'openai' | 'local_template' | 'unknown'
  fallbackUsed?: boolean
  riskLevel: AgentRiskLevel
  usedTools: string[]
  cards?: AgentCard[]
  places?: AgentPlace[]
  sources?: AgentSource[]
  observationChecklist?: string[]
  vetConsultCriteria?: string[]
  retrievedChunkIds?: string[]
  safety?: AgentSafety
  message: string
}

export function sendAgentMessage(payload: AgentMessagePayload) {
  return apiPost<AgentMessageResponse>('/api/agent/chat', payload, true)
}
