import { API_BASE_URL } from './env'

const AUTH_TOKEN_KEY = 'tripboard.accessToken'

export type AuthApiUser = {
  id: number
  loginId: string
  name: string
  email: string
  nickname: string
  bio: string | null
  location: string | null
  createdAt: string
  updatedAt: string
}

type ApiErrorResponse = {
  message?: string | string[]
  error?: string
  detail?: string
}

type LoginResponse = {
  accessToken: string
  user: AuthApiUser
}

type MeResponse = {
  user: AuthApiUser
}

type AvailabilityResponse = {
  available: boolean
}

type EmailVerificationResponse = {
  message: string
  verified: boolean
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    let message = '요청 처리에 실패했습니다.'

    try {
      const data = (await response.json()) as ApiErrorResponse

      if (Array.isArray(data.message) && data.message.length) {
        message = data.message[0]
      } else if (typeof data.message === 'string') {
        message = data.message
      } else if (data.error) {
        message = data.error
      } else if (data.detail) {
        message = data.detail
      }
    } catch {
      message = response.statusText || message
    }

    throw new Error(message)
  }

  return (await response.json()) as T
}

export function getAuthToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY)
}

export function clearAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
}

function setAuthToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export async function loginUser(payload: { loginId: string; password: string }) {
  const response = await request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  setAuthToken(response.accessToken)
  return response
}

export async function signupUser(payload: {
  name: string
  loginId: string
  password: string
  passwordConfirm: string
  email: string
  nickname: string
}) {
  return request<{ message: string; user: AuthApiUser }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchMe() {
  const token = getAuthToken()

  if (!token) {
    throw new Error('인증 토큰이 없습니다.')
  }

  return request<MeResponse>('/auth/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function logoutUser() {
  const token = getAuthToken()

  if (!token) {
    clearAuthToken()
    return { message: '로그아웃되었습니다.' }
  }

  try {
    return await request<{ message: string }>('/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  } finally {
    clearAuthToken()
  }
}

export async function isLoginIdAvailable(loginId: string) {
  const query = new URLSearchParams({ loginId })
  const response = await request<AvailabilityResponse>(`/auth/check-login-id?${query.toString()}`)
  return response.available
}

export async function isNicknameAvailable(nickname: string) {
  const query = new URLSearchParams({ nickname })
  const response = await request<AvailabilityResponse>(`/auth/check-nickname?${query.toString()}`)
  return response.available
}

export async function isEmailAvailable(email: string) {
  const query = new URLSearchParams({ email })
  const response = await request<AvailabilityResponse>(`/auth/check-email?${query.toString()}`)
  return response.available
}

export async function requestEmailVerification(email: string) {
  return request<EmailVerificationResponse>('/auth/email-verification/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}
