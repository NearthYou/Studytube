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
    eyebrow: 'travel log community',
    title: '다음 여행을 찾는 가장 쉬운 시작',
    body: 'Tripy에서 여행 후기, AI 추천, 여행 플래너를 한 화면 흐름으로 이어서 사용할 수 있습니다.',
    userId: '아이디',
    password: '비밀번호',
    submit: '로그인',
    submitting: '로그인 중...',
    missingFields: '아이디와 비밀번호를 모두 입력해 주세요.',
    noAccount: '계정이 아직 없나요?',
    goSignup: '회원가입으로 이동',
    noteTitle: '안내',
    noteBody: '회원가입에서 만든 계정으로 로그인하면 저장한 글과 맞춤 추천을 이어서 볼 수 있습니다.',
    promoLabel: 'why tripy',
    promoTitle: '읽고, 저장하고, 바로 일정으로 연결되는 여행 커뮤니티',
    promoBody:
      '검색으로 끝나는 게시판이 아니라, 게시글을 본 뒤 바로 AI 채팅과 플래너로 이어지는 탐색 흐름을 제공합니다.',
    highlights: ['실제 여행 후기를 기준으로 탐색', '게시글에서 AI 추천으로 자연스럽게 이동', '저장한 관심 글과 여행 취향 관리'],
    toggle: 'EN',
    show: '보기',
    hide: '숨기기',
  },
  en: {
    eyebrow: 'travel log community',
    title: 'The easiest way to start planning your next trip',
    body: 'Use travel posts, AI recommendations, and the planner in one connected flow on Tripy.',
    userId: 'User ID',
    password: 'Password',
    submit: 'Login',
    submitting: 'Logging in...',
    missingFields: 'Enter both your user ID and password.',
    noAccount: 'No account yet?',
    goSignup: 'Go to sign up',
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
    <main className="auth-screen">
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
          <p>{copy.body as string}</p>
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

        <div className="auth-card__note">
          <strong>{copy.noteTitle as string}</strong>
          <span>{copy.noteBody as string}</span>
        </div>
      </section>

      <section className="auth-promo">
        <div className="auth-promo__label">{copy.promoLabel as string}</div>
        <h2>{copy.promoTitle as string}</h2>
        <p>{copy.promoBody as string}</p>
        <ul className="auth-highlight-list">
          {(copy.highlights as string[]).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}
