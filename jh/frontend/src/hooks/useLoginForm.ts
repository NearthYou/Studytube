import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { login } from '../api/auth'
import { getLoginRedirectPath, saveAuthSession } from '../utils/authStorage'
import { getErrorMessage } from '../utils/error'
import { navigate } from '../utils/navigation'

type UseLoginFormOptions = {
  onError?: (message: string) => void
  redirectPath?: string
}

export function useLoginForm({ onError, redirectPath: redirectPathOverride }: UseLoginFormOptions = {}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loginStatus, setLoginStatus] = useState('')
  const socialErrorRef = useRef(new URLSearchParams(window.location.search).get('socialError') ?? '')
  const redirectPath = redirectPathOverride ?? getLoginRedirectPath()

  useEffect(() => {
    if (!socialErrorRef.current) {
      return
    }

    onError?.(getErrorMessage(socialErrorRef.current, '소셜 로그인 처리 중 오류가 발생했습니다.'))
    socialErrorRef.current = ''
  }, [onError])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setLoginStatus('')

    try {
      const response = await login({ email, password })

      saveAuthSession(response.accessToken, response.user, rememberMe)
      setLoginStatus(`${response.user.nickname}님, 환영합니다.`)
      window.setTimeout(() => {
        navigate(redirectPath)
      }, 300)
    } catch (error) {
      onError?.(getErrorMessage(error, '로그인 처리 중 오류가 발생했습니다.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    email,
    handleSubmit,
    isSubmitting,
    loginStatus,
    password,
    redirectPath,
    rememberMe,
    setEmail,
    setPassword,
    setRememberMe,
  }
}
