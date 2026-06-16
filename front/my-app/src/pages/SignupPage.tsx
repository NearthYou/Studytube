import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Language } from '../utils/language'
import '../styles/pages/SignupPage.css'

type SignupPageProps = {
  onSignup: (payload: {
    name: string
    userId: string
    password: string
    passwordConfirm: string
    email: string
    emailVerificationToken?: string
    nickname: string
  }) => Promise<boolean>
  onCheckLoginId: (userId: string) => Promise<boolean>
  onCheckNickname: (nickname: string) => Promise<boolean>
  onRequestEmailVerification: (email: string) => Promise<{
    message: string
    verified: boolean
    verificationToken?: string
  }>
  language: Language
  onToggleLanguage: () => void
}

type StatusTone = 'idle' | 'success' | 'error'

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isStrongPassword(value: string) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(value)
}

const COPY = {
  ko: {
    eyebrow: 'sign up',
    title: '계정 만들기',
    body: '',
    name: '이름',
    userId: '아이디',
    password: '비밀번호',
    passwordConfirm: '비밀번호 확인',
    email: '이메일',
    nickname: '닉네임',
    check: '중복 확인',
    verify: '이메일 인증',
    submitting: '가입 처리 중...',
    submit: '회원가입 완료',
    haveAccount: '이미 계정이 있나요?',
    goLogin: '로그인',
    passwordHint: '영문 대문자, 소문자, 숫자를 포함해 8자 이상으로 입력해 주세요.',
    enterUserId: '아이디를 먼저 입력해 주세요.',
    duplicateUserId: '이미 사용 중인 아이디입니다.',
    availableUserId: '사용 가능한 아이디입니다.',
    userIdCheckFailed: '아이디 확인에 실패했습니다.',
    enterNickname: '닉네임을 먼저 입력해 주세요.',
    duplicateNickname: '이미 사용 중인 닉네임입니다.',
    availableNickname: '사용 가능한 닉네임입니다.',
    nicknameCheckFailed: '닉네임 확인에 실패했습니다.',
    enterEmail: '이메일을 먼저 입력해 주세요.',
    invalidEmail: '올바른 이메일 형식을 입력해 주세요.',
    emailVerificationFailed: '이메일 인증에 실패했습니다.',
    emailVerificationRequestFailed: '이메일 인증 요청에 실패했습니다.',
    fillAll: '모든 항목을 입력해 주세요.',
    verifyUserId: '아이디 중복 확인을 먼저 진행해 주세요.',
    verifyNickname: '닉네임 중복 확인을 먼저 진행해 주세요.',
    verifyEmail: '이메일 인증을 먼저 완료해 주세요.',
    weakPassword: '비밀번호 조건을 다시 확인해 주세요.',
    passwordMismatch: '비밀번호와 비밀번호 확인이 일치하지 않습니다.',
    signupDone: '회원가입이 완료되었습니다.',
    emailVerified: '이메일 인증이 완료되었습니다.',
    toggle: 'EN',
    checklistTitle: '가입 전에 확인할 항목',
    checklist: ['아이디 중복 확인', '닉네임 중복 확인', '이메일 인증', '비밀번호 조건 충족'],
  },
  en: {
    eyebrow: 'sign up',
    title: 'Create account',
    body: '',
    name: 'Name',
    userId: 'User ID',
    password: 'Password',
    passwordConfirm: 'Confirm password',
    email: 'Email',
    nickname: 'Nickname',
    check: 'Check',
    verify: 'Verify email',
    submitting: 'Creating account...',
    submit: 'Create account',
    haveAccount: 'Already have an account?',
    goLogin: 'Login',
    passwordHint: 'Use at least 8 characters with uppercase, lowercase, and a number.',
    enterUserId: 'Enter a user ID first.',
    duplicateUserId: 'This user ID is already taken.',
    availableUserId: 'This user ID is available.',
    userIdCheckFailed: 'Failed to check the user ID.',
    enterNickname: 'Enter a nickname first.',
    duplicateNickname: 'This nickname is already taken.',
    availableNickname: 'This nickname is available.',
    nicknameCheckFailed: 'Failed to check the nickname.',
    enterEmail: 'Enter an email first.',
    invalidEmail: 'Enter a valid email address.',
    emailVerificationFailed: 'Email verification failed.',
    emailVerificationRequestFailed: 'Failed to request email verification.',
    fillAll: 'Fill in every field.',
    verifyUserId: 'Run the user ID check first.',
    verifyNickname: 'Run the nickname check first.',
    verifyEmail: 'Complete email verification first.',
    weakPassword: 'Review the password requirements.',
    passwordMismatch: 'Password and confirmation do not match.',
    signupDone: 'Your account has been created.',
    emailVerified: 'Email verification completed.',
    toggle: 'KO',
    checklistTitle: 'Complete these checks',
    checklist: ['User ID availability', 'Nickname availability', 'Email verification', 'Password requirements'],
  },
} satisfies Record<Language, Record<string, string | string[]>>

function getStatusClassName(tone: StatusTone) {
  if (tone === 'success') {
    return 'status-note status-note--success'
  }

  if (tone === 'error') {
    return 'status-note status-note--error'
  }

  return 'status-note'
}

export function SignupPage({
  onSignup,
  onCheckLoginId,
  onCheckNickname,
  onRequestEmailVerification,
  language,
  onToggleLanguage,
}: SignupPageProps) {
  const copy = COPY[language]
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    userId: '',
    password: '',
    passwordConfirm: '',
    email: '',
    nickname: '',
  })
  const [checkedUserId, setCheckedUserId] = useState('')
  const [checkedNickname, setCheckedNickname] = useState('')
  const [verifiedEmail, setVerifiedEmail] = useState('')
  const [emailVerificationToken, setEmailVerificationToken] = useState('')
  const [userIdMessage, setUserIdMessage] = useState('')
  const [userIdTone, setUserIdTone] = useState<StatusTone>('idle')
  const [nicknameMessage, setNicknameMessage] = useState('')
  const [nicknameTone, setNicknameTone] = useState<StatusTone>('idle')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailTone, setEmailTone] = useState<StatusTone>('idle')
  const [formMessage, setFormMessage] = useState('')
  const [formTone, setFormTone] = useState<StatusTone>('idle')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isUserIdVerified = checkedUserId === form.userId.trim()
  const isNicknameVerified = checkedNickname === form.nickname.trim()
  const isEmailVerified =
    verifiedEmail === form.email.trim() && Boolean(emailVerificationToken)

  const updateField = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFormMessage('')
    setFormTone('idle')

    if (key === 'userId') {
      setCheckedUserId('')
      setUserIdMessage('')
      setUserIdTone('idle')
    }

    if (key === 'nickname') {
      setCheckedNickname('')
      setNicknameMessage('')
      setNicknameTone('idle')
    }

    if (key === 'email') {
      setVerifiedEmail('')
      setEmailVerificationToken('')
      setEmailMessage('')
      setEmailTone('idle')
    }
  }

  const checkUserId = async () => {
    const value = form.userId.trim()

    if (!value) {
      setUserIdMessage(copy.enterUserId as string)
      setUserIdTone('error')
      return
    }

    try {
      const available = await onCheckLoginId(value)

      if (!available) {
        setUserIdMessage(copy.duplicateUserId as string)
        setUserIdTone('error')
        return
      }

      setCheckedUserId(value)
      setUserIdMessage(copy.availableUserId as string)
      setUserIdTone('success')
    } catch (error) {
      setUserIdMessage(error instanceof Error ? error.message : (copy.userIdCheckFailed as string))
      setUserIdTone('error')
    }
  }

  const checkNickname = async () => {
    const value = form.nickname.trim()

    if (!value) {
      setNicknameMessage(copy.enterNickname as string)
      setNicknameTone('error')
      return
    }

    try {
      const available = await onCheckNickname(value)

      if (!available) {
        setNicknameMessage(copy.duplicateNickname as string)
        setNicknameTone('error')
        return
      }

      setCheckedNickname(value)
      setNicknameMessage(copy.availableNickname as string)
      setNicknameTone('success')
    } catch (error) {
      setNicknameMessage(error instanceof Error ? error.message : (copy.nicknameCheckFailed as string))
      setNicknameTone('error')
    }
  }

  const sendEmailVerification = async () => {
    const value = form.email.trim()

    if (!value) {
      setEmailMessage(copy.enterEmail as string)
      setEmailTone('error')
      return
    }

    if (!isValidEmail(value)) {
      setEmailMessage(copy.invalidEmail as string)
      setEmailTone('error')
      return
    }

    try {
      const response = await onRequestEmailVerification(value)

      if (!response.verified || !response.verificationToken) {
        setEmailMessage(copy.emailVerificationFailed as string)
        setEmailTone('error')
        return
      }

      setVerifiedEmail(value)
      setEmailVerificationToken(response.verificationToken)
      setEmailMessage(response.message || (copy.emailVerified as string))
      setEmailTone('success')
    } catch (error) {
      setEmailMessage(
        error instanceof Error ? error.message : (copy.emailVerificationRequestFailed as string),
      )
      setEmailTone('error')
    }
  }

  return (
    <main className="auth-screen auth-screen--signup">
      <section className="auth-card auth-card--wide">
        <div className="auth-card__header">
          <div className="auth-card__header-top">
            <img alt="Tripy logo" className="auth-card__brand-logo" src="/tripy-logo.png" />
            <button className="secondary-button auth-language-toggle" type="button" onClick={onToggleLanguage}>
              {copy.toggle as string}
            </button>
          </div>
          <span className="auth-card__eyebrow">{copy.eyebrow as string}</span>
          <h1>{copy.title as string}</h1>
        </div>

        <form
          className="signup-form"
          onSubmit={async (event) => {
            event.preventDefault()

            if (Object.values(form).some((value) => !value.trim())) {
              setFormMessage(copy.fillAll as string)
              setFormTone('error')
              return
            }

            if (!isUserIdVerified) {
              setFormMessage(copy.verifyUserId as string)
              setFormTone('error')
              return
            }

            if (!isNicknameVerified) {
              setFormMessage(copy.verifyNickname as string)
              setFormTone('error')
              return
            }

            if (!isEmailVerified) {
              setFormMessage(copy.verifyEmail as string)
              setFormTone('error')
              return
            }

            if (!isStrongPassword(form.password)) {
              setFormMessage(copy.weakPassword as string)
              setFormTone('error')
              return
            }

            if (form.password !== form.passwordConfirm) {
              setFormMessage(copy.passwordMismatch as string)
              setFormTone('error')
              return
            }

            setFormMessage('')
            setFormTone('idle')
            setIsSubmitting(true)

            try {
              const success = await onSignup({
                name: form.name.trim(),
                userId: form.userId.trim(),
                password: form.password,
                passwordConfirm: form.passwordConfirm,
                email: form.email.trim(),
                emailVerificationToken,
                nickname: form.nickname.trim(),
              })

              if (!success) {
                return
              }

              navigate('/login')
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          <label>
            {copy.name as string}
            <input value={form.name} onChange={(event) => updateField('name', event.target.value)} />
          </label>

          <div className="inline-check-field">
            <label>
              {copy.userId as string}
              <input value={form.userId} onChange={(event) => updateField('userId', event.target.value)} />
            </label>
            <button className="secondary-button" type="button" onClick={() => void checkUserId()}>
              {copy.check as string}
            </button>
          </div>
          {userIdMessage ? <p className={getStatusClassName(userIdTone)}>{userIdMessage}</p> : null}

          <label>
            {copy.password as string}
            <input
              type="password"
              value={form.password}
              onChange={(event) => updateField('password', event.target.value)}
            />
            <small>{copy.passwordHint as string}</small>
          </label>

          <label>
            {copy.passwordConfirm as string}
            <input
              type="password"
              value={form.passwordConfirm}
              onChange={(event) => updateField('passwordConfirm', event.target.value)}
            />
          </label>

          <div className="inline-check-field">
            <label>
              {copy.email as string}
              <input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} />
            </label>
            <button className="secondary-button" type="button" onClick={() => void sendEmailVerification()}>
              {copy.verify as string}
            </button>
          </div>
          {emailMessage ? <p className={getStatusClassName(emailTone)}>{emailMessage}</p> : null}

          <div className="inline-check-field">
            <label>
              {copy.nickname as string}
              <input value={form.nickname} onChange={(event) => updateField('nickname', event.target.value)} />
            </label>
            <button className="secondary-button" type="button" onClick={() => void checkNickname()}>
              {copy.check as string}
            </button>
          </div>
          {nicknameMessage ? <p className={getStatusClassName(nicknameTone)}>{nicknameMessage}</p> : null}

          {formMessage ? <p className={getStatusClassName(formTone)}>{formMessage}</p> : null}

          <button className="primary-button auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? (copy.submitting as string) : (copy.submit as string)}
          </button>
        </form>

        <div className="auth-card__footer">
          <span>{copy.haveAccount as string}</span>
          <Link to="/login">{copy.goLogin as string}</Link>
        </div>
      </section>
    </main>
  )
}
