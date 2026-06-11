import { useState } from 'react'
import { Link } from 'react-router'
import '../styles/pages/LoginPage.css'

type LoginPageProps = {
  onLogin: (userId: string, password: string) => Promise<void>
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-card__header">
          <span className="auth-card__eyebrow">TRIPBOARD</span>
          <h1>로그인</h1>
          <p>백엔드 인증 API와 연결된 실제 로그인 화면입니다.</p>
        </div>
        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault()

            if (!userId.trim() || !password.trim()) {
              window.alert('아이디와 비밀번호를 입력해주세요.')
              return
            }

            setIsSubmitting(true)

            try {
              await onLogin(userId.trim(), password)
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          <label>
            아이디
            <input
              placeholder="아이디"
              type="text"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
          </label>
          <label>
            비밀번호
            <input
              placeholder="비밀번호"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-button auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? '로그인 중...' : '로그인'}
          </button>
        </form>
        <div className="auth-card__footer">
          <span>계정이 없다면?</span>
          <Link to="/signup">회원가입으로 이동</Link>
        </div>
        <div className="auth-card__note">
          <strong>안내</strong>
          <span>회원가입 후 만든 계정으로 로그인하세요.</span>
        </div>
      </section>
      <section className="auth-promo">
        <div className="auth-promo__label">THE TRAVEL JOURNAL</div>
        <h2>블로그형 여행 커뮤니티</h2>
        <p>
          카드형 게시글, 상세 검색, 여행 추천 챗봇, 마이페이지, 글쓰기 흐름을 한 번에 담은
          여행 커뮤니티입니다.
        </p>
      </section>
    </main>
  )
}
