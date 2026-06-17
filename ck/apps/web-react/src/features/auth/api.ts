import { apiRequest, createApiUrl } from "../../shared/api.ts"
import type { CheckEmailResponse, LoginResponse, PublicUser } from "./types"

type RegisterInput = {
  email: string
  password: string
  nickname: string
}

type LoginInput = {
  email: string
  password: string
}

export function register(input: RegisterInput) {
  return apiRequest<PublicUser>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function login(input: LoginInput) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function logout() {
  return apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST" })
}

export function getCurrentUser() {
  return apiRequest<PublicUser>("/auth/me", { method: "GET" })
}

export function checkEmail(email: string) {
  return apiRequest<CheckEmailResponse>(`/auth/check-email?email=${encodeURIComponent(email)}`, {
    method: "GET",
  })
}

export function getGoogleLoginUrl(redirectTo = "/") {
  const url = new URL(createApiUrl("/auth/google"))
  url.searchParams.set("redirectTo", redirectTo)

  return url.toString()
}
