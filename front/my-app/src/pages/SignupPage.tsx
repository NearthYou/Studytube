import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { User } from '../types/community'
import '../styles/pages/SignupPage.css'

type SignupPageProps = {
  users: User[]
  onSignup: (payload: {
    name: string
    userId: string
    password: string
    email: string
    nickname: string
  }) => void
}

export function SignupPage({ users, onSignup }: SignupPageProps) {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    userId: '',
    password: '',
    email: '',
    nickname: '',
  })
  const [checkedUserId, setCheckedUserId] = useState('')
  const [checkedNickname, setCheckedNickname] = useState('')

  const normalizedIds = useMemo(
    () => users.map((user) => user.userId.toLowerCase()),
    [users],
  )
  const normalizedNicknames = useMemo(
    () => users.map((user) => user.nickname.toLowerCase()),
    [users],
  )

  const isUserIdVerified = checkedUserId === form.userId.trim()
  const isNicknameVerified = checkedNickname === form.nickname.trim()

  const updateField = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (key === 'userId') {
      setCheckedUserId('')
    }
    if (key === 'nickname') {
      setCheckedNickname('')
    }
  }

  const checkUserId = () => {
    const value = form.userId.trim()
    if (!value) {
      window.alert('아이디를 먼저 입력해주세요.')
      return
    }
    if (normalizedIds.includes(value.toLowerCase())) {
      window.alert('중복된 아이디입니다.')
      return
    }
    setCheckedUserId(value)
    window.alert('사용 가능한 아이디입니다.')
  }

  const checkNickname = () => {
    const value = form.nickname.trim()
    if (!value) {
      window.alert('닉네임을 먼저 입력해주세요.')
      return
    }
    if (normalizedNicknames.includes(value.toLowerCase())) {
      window.alert('중복된 닉네임입니다.')
      return
    }
    setCheckedNickname(value)
    window.alert('사용 가능한 닉네임입니다.')
  }

  return (
    <main className="auth-screen">
      <section className="auth-card auth-card--wide">
        <div className="auth-card__header">
          <span className="auth-card__eyebrow">CREATE ACCOUNT</span>
          <h1>회원가입</h1>
          <p>이름, 아이디, 비밀번호, 이메일, 닉네임을 입력하고 중복 체크 후 가입합니다.</p>
        </div>
        <form
          className="signup-form"
          onSubmit={(event) => {
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
            onSignup({
              name: form.name.trim(),
              userId: form.userId.trim(),
              password: form.password,
              email: form.email.trim(),
              nickname: form.nickname.trim(),
            })
            window.alert('회원가입이 완료되었습니다.')
            navigate('/login')
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
            <button className="secondary-button" type="button" onClick={checkUserId}>
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
          </label>
          <label>
            이메일
            <input
              type="email"
              value={form.email}
              onChange={(event) => updateField('email', event.target.value)}
            />
          </label>
          <div className="inline-check-field">
            <label>
              닉네임
              <input
                value={form.nickname}
                onChange={(event) => updateField('nickname', event.target.value)}
              />
            </label>
            <button className="secondary-button" type="button" onClick={checkNickname}>
              중복 체크
            </button>
          </div>
          <button className="primary-button auth-submit" type="submit">
            회원가입 완료
          </button>
        </form>
        <div className="auth-card__footer">
          <span>이미 계정이 있다면</span>
          <Link to="/login">로그인으로 돌아가기</Link>
        </div>
      </section>
    </main>
  )
}
