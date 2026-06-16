import { useState } from 'react'
import type { FormEvent } from 'react'
import { signup } from '../api/auth'
import { getErrorMessage } from '../utils/error'
import { navigate } from '../utils/navigation'
import { appPaths } from '../utils/paths'
import { useSignupAccountFields } from './useSignupAccountFields'
import { useEmailVerification } from './useEmailVerification'
import { useNicknameCheck } from './useNicknameCheck'

type EmailVerificationStatus = ReturnType<typeof useEmailVerification>['emailVerificationStatus']
type NicknameStatus = ReturnType<typeof useNicknameCheck>['nicknameStatus']
type SignupStep = 'email' | 'verification' | 'nickname' | 'account'

type UseSignupFormOptions = {
  onError?: (message: string) => void
  onSignupComplete?: () => void
}

export function useSignupForm({ onError, onSignupComplete }: UseSignupFormOptions = {}) {
  const [profileImage, setProfileImage] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [signupStatus, setSignupStatus] = useState('')
  const accountState = useSignupAccountFields()

  const runAsync = async (callback: () => Promise<void>) => {
    setIsSubmitting(true)
    setSignupStatus('')

    try {
      await callback()
    } catch (error) {
      onError?.(getErrorMessage(error, '요청 처리 중 오류가 발생했습니다.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const nicknameState = useNicknameCheck({
    runAsync,
    setStatus: setSignupStatus,
  })
  const emailState = useEmailVerification({
    onEmailChange: nicknameState.resetNicknameCheck,
    runAsync,
    setStatus: setSignupStatus,
  })
  const signupStep = getSignupStep(emailState.emailVerificationStatus, nicknameState.nicknameStatus)
  const canSubmit =
    emailState.isEmailVerified &&
    nicknameState.isNicknameChecked &&
    accountState.isPasswordReady &&
    accountState.isPasswordMatched &&
    accountState.termsAccepted &&
    !isSubmitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!canSubmit) {
      setSignupStatus('이메일 인증, 닉네임 확인, 비밀번호 조건과 약관 동의를 확인해 주세요.')
      return
    }

    await runAsync(async () => {
      const response = await signup({
        email: emailState.email,
        nickname: nicknameState.nickname,
        password: accountState.password,
        passwordConfirm: accountState.passwordConfirm,
        termsAccepted: accountState.termsAccepted,
        emailVerificationToken: emailState.emailVerificationToken,
        profileImage,
      })

      setSignupStatus(`${response.message} ${onSignupComplete ? '로그인 창으로 이동합니다.' : '로그인 페이지로 이동합니다.'}`)
      window.setTimeout(() => {
        if (onSignupComplete) {
          onSignupComplete()
          return
        }

        navigate(appPaths.login)
      }, 700)
    })
  }

  return {
    canSubmit,
    isSubmitting,
    profileImage,
    signupStatus,
    signupStep,
    handleSubmit,
    ...accountState,
    ...emailState,
    ...nicknameState,
    setProfileImage,
    setSignupStatus,
  }
}

function getSignupStep(emailStatus: EmailVerificationStatus, nicknameStatus: NicknameStatus): SignupStep {
  if (emailStatus === 'idle') {
    return 'email'
  }

  if (emailStatus === 'codeSent') {
    return 'verification'
  }

  if (nicknameStatus === 'idle') {
    return 'nickname'
  }

  return 'account'
}
