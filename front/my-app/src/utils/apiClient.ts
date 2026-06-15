import { getAuthToken } from './authApi'
import { API_BASE_URL } from './env'

export { API_BASE_URL }

type ApiErrorResponse = {
  message?: string | string[]
  error?: string
  detail?: string
}

export function appendQueryParam(
  searchParams: URLSearchParams,
  key: string,
  value: string | number | undefined,
) {
  if (value === undefined || value === '') {
    return
  }

  searchParams.set(key, String(value))
}

export async function requestJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    let message = 'Request failed.'

    if (data && typeof data === 'object') {
      const typed = data as ApiErrorResponse

      if (Array.isArray(typed.message) && typed.message.length) {
        message = typed.message[0]
      } else if (typeof typed.message === 'string') {
        message = typed.message
      } else if (typed.error) {
        message = typed.error
      } else if (typed.detail) {
        message = typed.detail
      }
    }

    throw new Error(message)
  }

  return data as T
}

export function getAuthHeaders() {
  const token = getAuthToken()

  if (!token) {
    throw new Error('Login is required.')
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}
