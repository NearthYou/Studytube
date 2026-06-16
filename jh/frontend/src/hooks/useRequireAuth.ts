import { useEffect } from 'react'
import { getStoredUser, redirectToLogin } from '../utils/authStorage'

export function useRequireAuth(redirectPath: string) {
  const user = getStoredUser()
  const isAuthenticated = Boolean(user)

  useEffect(() => {
    if (!isAuthenticated) {
      redirectToLogin(redirectPath)
    }
  }, [isAuthenticated, redirectPath])

  return {
    isAuthenticated,
    user,
  }
}
