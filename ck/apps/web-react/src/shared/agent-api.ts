const AGENT_API_BASE_URL = import.meta.env.VITE_AGENT_API_BASE_URL ?? "http://localhost:8000"

type AgentApiErrorResponse = {
  detail?: string | { msg?: string }[]
  message?: string
}

export async function agentApiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${AGENT_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  })

  const data = (await response.json().catch(() => null)) as AgentApiErrorResponse | T | null

  if (!response.ok) {
    const detail = (data as AgentApiErrorResponse | null)?.detail
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item) => item.msg).filter(Boolean).join(", ")
          : (data as AgentApiErrorResponse | null)?.message

    throw new Error(message || "AI 보조 서버 요청에 실패했습니다.")
  }

  return data as T
}
