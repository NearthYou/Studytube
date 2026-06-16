import { useState } from 'react'
import { Link } from 'react-router'
import type { Language } from '../utils/language'
import '../styles/pages/LoginPage.css'

type LoginPageProps = {
  onLogin: (userId: string, password: string) => Promise<void>
  language: Language
  onToggleLanguage: () => void
}

const COPY = {
  ko: {
    eyebrow: 'tripy',
    title: '여행을 가볍게 시작하기',
    body: '',
    userId: '아이디',
    password: '비밀번호',
    submit: '로그인',
    submitting: '로그인 중...',
    missingFields: '아이디와 비밀번호를 모두 입력해 주세요.',
    noAccount: '계정이 아직 없나요?',
    goSignup: '회원가입',
    noteTitle: '안내',
    noteBody: '회원가입에서 만든 계정으로 로그인하면 저장한 글과 여행 취향을 그대로 이어서 볼 수 있습니다.',
    promoLabel: 'why tripy',
    promoTitle: '읽고, 저장하고, 바로 여행 계획으로 이어지는 커뮤니티',
    promoBody:
      '검색만 하고 끝나는 게시판이 아니라, 게시글을 본 뒤 바로 챗봇과 플래너로 이동할 수 있는 여행 보드를 제공합니다.',
    highlights: ['실제 여행 후기 중심 탐색', 'AI 추천과 일정 계획 연결', '저장한 글과 취향 한곳 관리'],
    toggle: 'EN',
    show: '보기',
    hide: '숨기기',
  },
  en: {
    eyebrow: 'tripy',
    title: 'Start your next trip',
    body: '',
    userId: 'User ID',
    password: 'Password',
    submit: 'Login',
    submitting: 'Logging in...',
    missingFields: 'Enter both your user ID and password.',
    noAccount: 'No account yet?',
    goSignup: 'Sign up',
    noteTitle: 'Note',
    noteBody: 'Sign in with the account you created on the sign-up page to keep your saved posts and preferences.',
    promoLabel: 'why tripy',
    promoTitle: 'A travel community connected to AI planning',
    promoBody:
      'Tripy helps you move from real travel stories into AI recommendations and itinerary planning without restarting your search.',
    highlights: [
      'Browse real traveler posts first',
      'Jump from posts into AI guidance',
      'Keep track of saved posts and travel preferences',
    ],
    toggle: 'KO',
    show: 'Show',
    hide: 'Hide',
  },
} satisfies Record<Language, Record<string, string | string[]>>

export function LoginPage({ onLogin, language, onToggleLanguage }: LoginPageProps) {
  const copy = COPY[language]
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  return (
    <main className="auth-screen auth-screen--login">
      <section className="auth-card">
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
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault()

            if (!userId.trim() || !password.trim()) {
              setError(copy.missingFields as string)
              return
            }

            setError('')
            setIsSubmitting(true)

            try {
              await onLogin(userId.trim(), password)
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          <label>
            {copy.userId as string}
            <input
              placeholder={copy.userId as string}
              type="text"
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value)
                setError('')
              }}
            />
          </label>

          <label>
            {copy.password as string}
            <div className="auth-password-field">
              <input
                placeholder={copy.password as string}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError('')
                }}
              />
              <button
                className="auth-password-toggle"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? (copy.hide as string) : (copy.show as string)}
              </button>
            </div>
          </label>

          {error ? (
            <p aria-live="polite" className="status-note status-note--error">
              {error}
            </p>
          ) : null}

          <button className="primary-button auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? (copy.submitting as string) : (copy.submit as string)}
          </button>
        </form>

        <div className="auth-card__footer">
          <span>{copy.noAccount as string}</span>
          <Link to="/signup">{copy.goSignup as string}</Link>
        </div>
      </section>
    </main>
  )
}
