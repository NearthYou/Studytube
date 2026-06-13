import { API_BASE_URL } from './base'
import { createApiHeaders } from './headers'
import { parseResponse } from './response'

type RequestOptions = {
  auth?: boolean
  body?: unknown
  method?: string
}

export async function apiGet<TResponse>(path: string, auth = false): Promise<TResponse> {
  return request<TResponse>(path, { auth })
}

export async function apiPost<TResponse>(path: string, body?: unknown, auth = false): Promise<TResponse> {
  return request<TResponse>(path, { auth, body, method: 'POST' })
}

export async function apiPatch<TResponse>(path: string, body: unknown, auth = false): Promise<TResponse> {
  return request<TResponse>(path, { auth, body, method: 'PATCH' })
}

export async function apiDelete<TResponse>(path: string, auth = false): Promise<TResponse> {
  return request<TResponse>(path, { auth, method: 'DELETE' })
}

export async function apiForm<TResponse>(path: string, body: FormData, auth = false): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: createApiHeaders({ auth }),
    body,
  })

  return parseResponse<TResponse>(response)
}

async function request<TResponse>(path: string, options: RequestOptions): Promise<TResponse> {
  const hasBody = options.body !== undefined

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: createApiHeaders({ auth: options.auth, json: hasBody }),
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })

  return parseResponse<TResponse>(response)
}
