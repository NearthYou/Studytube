import { getStoredUser, redirectToLogin } from './authStorage'

export function redirectAnonymousUser(redirectPath?: string) {
  if (getStoredUser()) {
    return false
  }

  redirectToLogin(redirectPath)
  return true
}
