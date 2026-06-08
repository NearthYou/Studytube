import { useState } from 'react'
import { Link } from 'react-router'
import '../styles/pages/LoginPage.css'

type LoginPageProps = {
  onLogin: (userId: string, password: string) => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-card__header">
          <span className="auth-card__eyebrow">TRIPBOARD</span>
          <h1>로그인</h1>
          <p>아이디와 비밀번호만 입력해서 바로 메인 화면으로 이동합니다.</p>
        </div>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault()
            onLogin(userId.trim(), password)
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
          <button className="primary-button auth-submit" type="submit">
            로그인
          </button>
        </form>
        <div className="auth-card__footer">
          <span>계정이 없다면</span>
          <Link to="/signup">회원가입으로 이동</Link>
        </div>
        <div className="auth-card__note">
          <strong>테스트 계정</strong>
          <span>ID: `traveler` / PW: `1234`</span>
        </div>
      </section>
      <section className="auth-promo">
        <div className="auth-promo__label">THE TRAVEL JOURNAL</div>
        <h2>블로그형 여행 커뮤니티</h2>
        <p>
          카드형 게시글, 상세 검색, 여행 추천 챗봇, 마이페이지, 글쓰기를 하나의 흐름으로
          구성한 프론트 프로토타입입니다.
        </p>
      </section>
    </main>
  )
}
