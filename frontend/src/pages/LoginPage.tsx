import { AppLayout } from '../components/layout/AppLayout'

export function LoginPage() {
  return (
    <AppLayout variant="auth" mainClassName="auth-main auth-modal-route-main">
      <section className="auth-modal-route-panel" aria-live="polite">
        <p className="login-kicker">Tail Talk 로그인</p>
        <h1>로그인 창을 열고 있어요</h1>
        <p>창이 보이지 않으면 상단의 로그인 버튼을 눌러 다시 열 수 있습니다.</p>
      </section>
    </AppLayout>
  )
}
