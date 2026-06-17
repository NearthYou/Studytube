import { appPaths, toSafeRedirectPath } from './paths'
import { openAuthModal } from './authModal'

export type StoredUser = {
  id: string
  email: string
  nickname: string
  createdAt: string
  profileImageUrl: string | null
}

export function saveAuthSession(accessToken: string, user: StoredUser, rememberMe: boolean) {
  const targetStorage = rememberMe ? localStorage : sessionStorage
  const otherStorage = rememberMe ? sessionStorage : localStorage

  otherStorage.removeItem('accessToken')
  otherStorage.removeItem('user')
  targetStorage.setItem('accessToken', accessToken)
  targetStorage.setItem('user', JSON.stringify(user))
}

export function getStoredUser(): StoredUser | null {
  const rawUser = localStorage.getItem('user') ?? sessionStorage.getItem('user')
  const accessToken = localStorage.getItem('accessToken') ?? sessionStorage.getItem('accessToken')

  if (!rawUser || !accessToken) {
    return null
  }

  try {
    return JSON.parse(rawUser) as StoredUser
  } catch {
    clearAuthSession()
    return null
  }
}

export function getStoredAccessToken(): string | null {
  return localStorage.getItem('accessToken') ?? sessionStorage.getItem('accessToken')
}

export function getLoginRedirectPath(): string {
  const redirect = new URLSearchParams(window.location.search).get('redirect')

  if (redirect?.startsWith('/') && !redirect.startsWith('//')) {
    return redirect
  }

  return appPaths.home
}

export function redirectToLogin(redirectPath = `${window.location.pathname}${window.location.search}`) {
  openAuthModal({ mode: 'login', redirectPath: toSafeRedirectPath(redirectPath) })
}

export function clearAuthSession() {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('user')
  sessionStorage.removeItem('accessToken')
  sessionStorage.removeItem('user')
}
