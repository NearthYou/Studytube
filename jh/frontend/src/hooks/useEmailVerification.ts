import { useState } from 'react'
import { confirmEmailVerification, requestEmailVerification } from '../api/auth'

type EmailVerificationStatus = 'idle' | 'codeSent' | 'verified'

type UseEmailVerificationOptions = {
  onEmailChange?: () => void
  runAsync: (callback: () => Promise<void>) => Promise<void>
  setStatus: (message: string) => void
}

export function useEmailVerification({ onEmailChange, runAsync, setStatus }: UseEmailVerificationOptions) {
  const [email, setEmail] = useState('')
  const [emailVerificationStatus, setEmailVerificationStatus] = useState<EmailVerificationStatus>('idle')
  const [emailVerificationToken, setEmailVerificationToken] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const isVerificationCodeVisible = emailVerificationStatus !== 'idle'
  const isEmailVerified = emailVerificationStatus === 'verified'

  const handleEmailCodeRequest = async () => {
    if (!email.trim()) {
      setStatus('이메일을 입력해 주세요.')
      return
    }

    await runAsync(async () => {
      const response = await requestEmailVerification(email)

      setEmailVerificationStatus('codeSent')
      setEmailVerificationToken('')
      setVerificationCode('')
      setStatus(response.message)
    })
  }

  const handleVerificationConfirm = async () => {
    if (!verificationCode.trim()) {
      setStatus('인증번호를 입력해 주세요.')
      return
    }

    await runAsync(async () => {
      const response = await confirmEmailVerification(email, verificationCode)

      setEmailVerificationStatus('verified')
      setEmailVerificationToken(response.emailVerificationToken ?? '')
      setStatus(response.message)
    })
  }

  const handleEmailChange = (value: string) => {
    setEmail(value)
    setEmailVerificationStatus('idle')
    setEmailVerificationToken('')
    setVerificationCode('')
    setStatus('')
    onEmailChange?.()
  }

  return {
    email,
    emailVerificationStatus,
    emailVerificationToken,
    isEmailVerified,
    isVerificationCodeVisible,
    verificationCode,
    handleEmailChange,
    handleEmailCodeRequest,
    handleVerificationConfirm,
    setVerificationCode,
  }
}
