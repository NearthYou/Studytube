import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import '../styles/pages/SignupPage.css'

type SignupPageProps = {
  onSignup: (payload: {
    name: string
    userId: string
    password: string
    passwordConfirm: string
    email: string
    nickname: string
  }) => Promise<boolean>
  onCheckLoginId: (userId: string) => Promise<boolean>
  onCheckNickname: (nickname: string) => Promise<boolean>
  onRequestEmailVerification: (email: string) => Promise<{
    message: string
    verified: boolean
  }>
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isStrongPassword(value: string) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(value)
}

export function SignupPage({
  onSignup,
  onCheckLoginId,
  onCheckNickname,
  onRequestEmailVerification,
}: SignupPageProps) {
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
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isUserIdVerified = checkedUserId === form.userId.trim()
  const isNicknameVerified = checkedNickname === form.nickname.trim()
  const isEmailVerified = verifiedEmail === form.email.trim()

  const updateField = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))

    if (key === 'userId') {
      setCheckedUserId('')
    }

    if (key === 'nickname') {
      setCheckedNickname('')
    }

    if (key === 'email') {
      setVerifiedEmail('')
    }
  }

  const checkUserId = async () => {
    const value = form.userId.trim()

    if (!value) {
      window.alert('아이디를 먼저 입력해주세요.')
      return
    }

    try {
      const available = await onCheckLoginId(value)

      if (!available) {
        window.alert('중복된 아이디입니다.')
        return
      }

      setCheckedUserId(value)
      window.alert('사용 가능한 아이디입니다.')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '아이디 중복 체크에 실패했습니다.')
    }
  }

  const checkNickname = async () => {
    const value = form.nickname.trim()

    if (!value) {
      window.alert('닉네임을 먼저 입력해주세요.')
      return
    }

    try {
      const available = await onCheckNickname(value)

      if (!available) {
        window.alert('중복된 닉네임입니다.')
        return
      }

      setCheckedNickname(value)
      window.alert('사용 가능한 닉네임입니다.')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '닉네임 중복 체크에 실패했습니다.')
    }
  }

  const sendEmailVerification = async () => {
    const value = form.email.trim()

    if (!value) {
      window.alert('이메일을 먼저 입력해주세요.')
      return
    }

    if (!isValidEmail(value)) {
      window.alert('올바른 이메일 형식을 입력해주세요.')
      return
    }

    try {
      const response = await onRequestEmailVerification(value)

      if (!response.verified) {
        window.alert('이메일 인증에 실패했습니다.')
        return
      }

      setVerifiedEmail(value)
      window.alert(response.message)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '이메일 인증 요청에 실패했습니다.')
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card auth-card--wide">
        <div className="auth-card__header">
          <span className="auth-card__eyebrow">CREATE ACCOUNT</span>
          <h1>회원가입</h1>
          <p>이름, 아이디, 비밀번호, 이메일, 닉네임을 입력하고 가입을 진행합니다.</p>
        </div>
        <form
          className="signup-form"
          onSubmit={async (event) => {
            event.preventDefault()

            if (Object.values(form).some((value) => !value.trim())) {
              window.alert('모든 항목을 입력해주세요.')
              return
            }

            if (!isUserIdVerified) {
              window.alert('아이디 중복 체크를 먼저 해주세요.')
              return
            }

            if (!isNicknameVerified) {
              window.alert('닉네임 중복 체크를 먼저 해주세요.')
              return
            }

            if (!isEmailVerified) {
              window.alert('이메일 인증을 먼저 해주세요.')
              return
            }

            if (!isStrongPassword(form.password)) {
              window.alert('비밀번호는 대소문자와 숫자를 포함해 8자 이상이어야 합니다.')
              return
            }

            if (form.password !== form.passwordConfirm) {
              window.alert('비밀번호와 비밀번호 확인이 일치하지 않습니다.')
              return
            }

            setIsSubmitting(true)

            try {
              const success = await onSignup({
                name: form.name.trim(),
                userId: form.userId.trim(),
                password: form.password,
                passwordConfirm: form.passwordConfirm,
                email: form.email.trim(),
                nickname: form.nickname.trim(),
              })

              if (!success) {
                return
              }

              window.alert('회원가입이 완료되었습니다.')
              navigate('/login')
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          <label>
            이름
            <input value={form.name} onChange={(event) => updateField('name', event.target.value)} />
          </label>
          <div className="inline-check-field">
            <label>
              아이디
              <input
                value={form.userId}
                onChange={(event) => updateField('userId', event.target.value)}
              />
            </label>
            <button className="secondary-button" type="button" onClick={() => void checkUserId()}>
              중복 체크
            </button>
          </div>
          <label>
            비밀번호
            <input
              type="password"
              value={form.password}
              onChange={(event) => updateField('password', event.target.value)}
            />
            <small>대소문자 + 숫자를 포함해 8자 이상으로 입력해주세요.</small>
          </label>
          <label>
            비밀번호 확인
            <input
              type="password"
              value={form.passwordConfirm}
              onChange={(event) => updateField('passwordConfirm', event.target.value)}
            />
          </label>
          <div className="inline-check-field">
            <label>
              이메일
              <input
                type="email"
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
              />
            </label>
            <button className="secondary-button" type="button" onClick={() => void sendEmailVerification()}>
              인증
            </button>
          </div>
          <div className="inline-check-field">
            <label>
              닉네임
              <input
                value={form.nickname}
                onChange={(event) => updateField('nickname', event.target.value)}
              />
            </label>
            <button className="secondary-button" type="button" onClick={() => void checkNickname()}>
              중복 체크
            </button>
          </div>
          <button className="primary-button auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? '가입 중...' : '회원가입 완료'}
          </button>
        </form>
        <div className="auth-card__footer">
          <span>이미 계정이 있다면?</span>
          <Link to="/login">로그인으로 돌아가기</Link>
        </div>
      </section>
    </main>
  )
}
