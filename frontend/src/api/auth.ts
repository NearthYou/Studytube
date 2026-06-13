import { apiForm, apiGet, apiPost } from './client'
import { API_BASE_URL } from './base'

interface MessageResponse {
  message: string
}

interface EmailResponse extends MessageResponse {
  email: string
  emailVerificationToken?: string
}

interface NicknameResponse extends MessageResponse {
  nickname: string
}

interface SignupPayload {
  email: string
  nickname: string
  password: string
  passwordConfirm: string
  termsAccepted: boolean
  emailVerificationToken: string
  profileImage?: File | null
}

interface SignupResponse extends MessageResponse {
  user: {
    id: string
    email: string
    nickname: string
    createdAt: string
    profileImageUrl: string | null
  }
}

interface LoginPayload {
  email: string
  password: string
}

interface LoginResponse extends SignupResponse {
  accessToken: string
}

export function requestEmailVerification(email: string) {
  return apiPost<EmailResponse>('/api/auth/email/code', { email })
}

export function confirmEmailVerification(email: string, code: string) {
  return apiPost<EmailResponse>('/api/auth/email/verify', { email, code })
}

export function checkEmail(email: string) {
  const query = new URLSearchParams({ email })

  return apiGet<EmailResponse>(`/api/auth/email/check?${query.toString()}`)
}

export function checkNickname(nickname: string) {
  const query = new URLSearchParams({ nickname })

  return apiGet<NicknameResponse>(`/api/auth/nickname/check?${query.toString()}`)
}

export function signup(payload: SignupPayload) {
  const formData = new FormData()

  formData.append('email', payload.email)
  formData.append('nickname', payload.nickname)
  formData.append('password', payload.password)
  formData.append('passwordConfirm', payload.passwordConfirm)
  formData.append('termsAccepted', String(payload.termsAccepted))
  formData.append('emailVerificationToken', payload.emailVerificationToken)

  if (payload.profileImage) {
    formData.append('profileImage', payload.profileImage)
  }

  return apiForm<SignupResponse>('/api/auth/signup', formData)
}

export function login(payload: LoginPayload) {
  return apiPost<LoginResponse>('/api/auth/login', payload)
}

export function logout() {
  return apiPost<MessageResponse>('/api/auth/logout', undefined, true)
}

export function getSocialAuthUrl(provider: string, redirect = '/') {
  const params = new URLSearchParams({ redirect })

  return `${API_BASE_URL}/api/auth/social/${provider}?${params.toString()}`
}
