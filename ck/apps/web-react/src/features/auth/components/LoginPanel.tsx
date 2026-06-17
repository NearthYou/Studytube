import type { SubmitEvent } from "react"
import "../styles/auth-panel.css"
import "../styles/login-panel.css"

type LoginPanelProps = {
  email: string
  onChangeEmail: (value: string) => void
  onChangePassword: (value: string) => void
  onGoogleLogin: () => void
  onShowSignup: () => void
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void | Promise<void>
  password: string
}

export default function LoginPanel({
  email,
  onChangeEmail,
  onChangePassword,
  onGoogleLogin,
  onShowSignup,
  onSubmit,
  password,
}: LoginPanelProps) {
  return (
    <section className="auth-card login-card">
      <div className="auth-card-head">
        <p className="auth-kicker">WELCOME BACK</p>
        <h1 className="auth-title">LOGIN</h1>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        <label className="auth-field">
          <span>ID</span>
          <input
            type="email"
            placeholder="email"
            autoComplete="email"
            value={email}
            onChange={(event) => onChangeEmail(event.target.value)}
          />
        </label>

        <label className="auth-field">
          <span>PW</span>
          <input
            type="password"
            placeholder="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onChangePassword(event.target.value)}
          />
        </label>

        <div className="auth-actions stacked">
          <button type="submit" className="auth-button primary">
            LOGIN
          </button>
          <div className="oauth-divider" aria-hidden="true">
            <span />
            <strong>OR</strong>
            <span />
          </div>
          <button type="button" className="auth-button google" onClick={onGoogleLogin}>
            <span className="google-mark" aria-hidden="true">
              G
            </span>
            Continue with Google
          </button>
          <button type="button" className="auth-button secondary" onClick={onShowSignup}>
            SIGN UP
          </button>
        </div>
      </form>
    </section>
  )
}
