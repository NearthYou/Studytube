import { apiRequest } from "../../shared/api"
import type { RagAnswer } from "./types"

export function askRagQuestion(input: { question: string; limit?: number }) {
  return apiRequest<RagAnswer>("/rag/questions", {
    method: "POST",
    body: JSON.stringify(input),
  })
}
