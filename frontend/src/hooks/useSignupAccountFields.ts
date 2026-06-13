import { useState } from 'react'

export function useSignupAccountFields() {
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const isPasswordReady = password.length >= 8 && /[^A-Za-z0-9]/.test(password)
  const isPasswordMatched = password.length > 0 && password === passwordConfirm

  return {
    isPasswordMatched,
    isPasswordReady,
    password,
    passwordConfirm,
    setPassword,
    setPasswordConfirm,
    setTermsAccepted,
    termsAccepted,
  }
}
