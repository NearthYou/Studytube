import { LogIn } from 'lucide-react'
import { FeedbackModal } from '../common/FeedbackModal'
import { useFeedbackModal } from '../../hooks/useFeedbackModal'
import { useLoginForm } from '../../hooks/useLoginForm'
import { appPaths } from '../../utils/paths'
import { SocialAuthLinks } from './SocialAuthLinks'
import { getEnabledSocialProviders } from '../../data/socialProviders'

type LoginPanelProps = {
  onSwitchToSignup?: () => void
  presentation?: 'page' | 'modal'
  redirectPath?: string
}

export function LoginPanel({ onSwitchToSignup, presentation = 'page', redirectPath: redirectPathOverride }: LoginPanelProps = {}) {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const {
    email,
    handleSubmit,
    isSubmitting,
    loginStatus,
    password,
    redirectPath,
    rememberMe,
    setEmail,
    setPassword,
    setRememberMe,
  } = useLoginForm({ onError: openErrorModal, redirectPath: redirectPathOverride })
  const isModal = presentation === 'modal'
  const hasSocialProviders = getEnabledSocialProviders().length > 0

  return (
    <>
      <section className={isModal ? 'login-panel login-panel--modal' : 'login-panel'} aria-labelledby={isModal ? undefined : 'login-title'}>
        {!isModal && <div className="login-copy">
          <p className="login-kicker">Tail Talk 로그인</p>
          <h1 id="login-title">오늘의 이야기를 이어가세요</h1>
          <p className="auth-description">이메일 계정으로 동물 일상 사진 게시판에 입장할 수 있습니다.</p>
          <figure className="login-visual">
            <img
              src="https://images.unsplash.com/photo-1507146426996-ef05306b995a?auto=format&fit=crop&w=900&q=80"
              alt="편안하게 쉬고 있는 강아지"
            />
          </figure>
        </div>}

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field-group" htmlFor="login-email">
            <span>이메일</span>
            <input
              id="login-email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="field-group" htmlFor="login-password">
            <span>비밀번호</span>
            <input
              id="login-password"
              type="password"
              placeholder="비밀번호 입력"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <div className="login-options">
            <label className="remember-check">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              <span>로그인 유지</span>
            </label>
            <span className="forgot-password-note" aria-label="비밀번호 찾기는 준비 중입니다.">
              비밀번호 찾기 준비 중
            </span>
          </div>

          <button
            className="ui-button ui-button--primary primary-login-button"
            type="submit"
            disabled={isSubmitting}
          >
            <LogIn size={16} aria-hidden="true" />
            <span>이메일로 로그인</span>
          </button>
          {loginStatus && (
            <p className="form-status" role="status">
              {loginStatus}
            </p>
          )}
        </form>

        {hasSocialProviders && (
          <>
            <p className="auth-divider">또는</p>
            <SocialAuthLinks mode="login" redirectPath={redirectPath} />
          </>
        )}

        <div className="signup-row">
          <span>아직 계정이 없나요?</span>
          {onSwitchToSignup ? (
            <button className="auth-switch-button" type="button" onClick={onSwitchToSignup}>
              회원가입
            </button>
          ) : (
            <a href={appPaths.signup}>회원가입</a>
          )}
        </div>
      </section>
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </>
  )
}
