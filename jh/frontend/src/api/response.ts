import { clearAuthSession } from '../utils/authStorage'
import { normalizeErrorMessages } from '../utils/error'

type ApiEnvelope<T> = {
  success: boolean
  data: T
  message: string
  errorCode?: string
}

export class ApiError extends Error {
  readonly errorCode?: string
  readonly status: number

  constructor(message: string, status: number, errorCode?: string) {
    super(message)
    this.name = 'ApiError'
    this.errorCode = errorCode
    this.status = status
  }
}

export function isUnauthorizedApiError(error: unknown) {
  return error instanceof ApiError && error.status === 401
}

export async function parseResponse<TResponse>(response: Response): Promise<TResponse> {
  const payload = await parseJson(response)

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthSession()
    }

    throw new ApiError(getApiErrorMessage(payload), response.status, getApiErrorCode(payload))
  }

  if (isEnvelope<TResponse>(payload)) {
    return payload.data
  }

  return payload as TResponse
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function isEnvelope<TResponse>(payload: unknown): payload is ApiEnvelope<TResponse> {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'success' in payload &&
    'data' in payload &&
    'message' in payload
  )
}

function getApiErrorMessage(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const message = (payload as Record<string, unknown>).message

    if (message) {
      return normalizeErrorMessages(message)
    }
  }

  return '요청 처리 중 오류가 발생했습니다.'
}

function getApiErrorCode(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const errorCode = (payload as Record<string, unknown>).errorCode

    if (typeof errorCode === 'string') {
      return errorCode
    }
  }

  return undefined
}
