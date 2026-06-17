import { useEffect, useState } from "react"
import type { SubmitEvent } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { checkEmail, getCurrentUser, getGoogleLoginUrl, login, logout, register } from "./api"
import LoginPanel from "./components/LoginPanel"
import SignupPanel from "./components/SignupPanel"
import "./styles/auth-page.css"
import type { PublicUser } from "./types"

type AuthLocationState = {
  redirectTo?: string
}

function getSafeRedirectPath(redirectTo?: string) {
  if (!redirectTo || !redirectTo.startsWith("/") || redirectTo.startsWith("//")) {
    return "/"
  }

  return redirectTo
}

export default function AuthPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const redirectPath = getSafeRedirectPath((location.state as AuthLocationState | null)?.redirectTo)
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [registerName, setRegisterName] = useState("")
  const [registerEmail, setRegisterEmail] = useState("")
  const [registerPassword, setRegisterPassword] = useState("")
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("")
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [checkedEmail, setCheckedEmail] = useState("")
  const [isEmailChecked, setIsEmailChecked] = useState(false)
  const [isEmailAvailable, setIsEmailAvailable] = useState(false)
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let isMounted = true

    async function loadCurrentUser() {
      try {
        const user = await getCurrentUser()

        if (isMounted) {
          setCurrentUser(user)
        }
      } catch {
        if (isMounted) {
          setCurrentUser(null)
        }
      }
    }

    void loadCurrentUser()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)

    if (params.get("oauthError") === "google") {
      setMessage("")
      setError("Google login failed. Please try again.")
    }
  }, [location.search])

  async function handleRegister(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")
    setError("")

    if (registerPassword !== registerPasswordConfirm) {
      setError("Passwords do not match.")
      return
    }

    const normalizedEmail = registerEmail.trim()
    if (!isEmailChecked || checkedEmail !== normalizedEmail) {
      setError("Check email availability before signing up.")
      return
    }

    if (!isEmailAvailable) {
      setError("This email is already in use.")
      return
    }

    try {
      const user = await register({
        email: normalizedEmail,
        password: registerPassword,
        nickname: registerName,
      })

      setMessage(`Account created for ${user.nickname}. Please log in.`)
      setLoginEmail(normalizedEmail)
      setRegisterName("")
      setRegisterEmail("")
      setRegisterPassword("")
      setRegisterPasswordConfirm("")
      setCheckedEmail("")
      setIsEmailChecked(false)
      setIsEmailAvailable(false)
      setMode("login")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.")
    }
  }

  async function handleLogin(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")
    setError("")

    try {
      const result = await login({
        email: loginEmail,
        password: loginPassword,
      })

      setCurrentUser(result.user)
      setMessage(`Signed in as ${result.user.nickname}.`)
      setLoginPassword("")
      navigate(redirectPath, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.")
    }
  }

  async function handleDuplicateCheck() {
    setMessage("")
    setError("")
    const email = registerEmail.trim()

    if (!email) {
      setError("Enter an email before checking availability.")
      setCheckedEmail("")
      setIsEmailChecked(false)
      setIsEmailAvailable(false)
      return
    }

    try {
      const result = await checkEmail(email)
      setCheckedEmail(email)
      setIsEmailChecked(true)

      if (result.available) {
        setIsEmailAvailable(true)
        setMessage("This email is available.")
      } else {
        setIsEmailAvailable(false)
        setError("This email is already in use.")
      }
    } catch (err) {
      setCheckedEmail("")
      setIsEmailChecked(false)
      setIsEmailAvailable(false)
      setError(err instanceof Error ? err.message : "Email check failed.")
    }
  }

  function handleRegisterEmailChange(value: string) {
    setRegisterEmail(value)
    setCheckedEmail("")
    setIsEmailAvailable(false)
    setMessage("")
    setError("")
  }

  async function handleLogout() {
    try {
      await logout()
    } finally {
      setCurrentUser(null)
      setMessage("Signed out.")
      setError("")
    }
  }

  function handleGoogleLogin() {
    window.location.assign(getGoogleLoginUrl(redirectPath))
  }

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <header className="auth-brand">
          <p className="brand-kicker">MUSICAL SEAT ARCHIVE</p>
          <h1>Agentic Board</h1>
          <p className="brand-copy">
            A simple sign-in flow for reviews, seat notes, and saved activity.
          </p>
          <button type="button" className="auth-home-button" onClick={() => navigate("/")}>
            Home
          </button>

          {currentUser ? (
            <div className="auth-current-user">
              <span>{currentUser.nickname} is signed in</span>
              <button type="button" className="auth-link-button logout-link" onClick={handleLogout}>
                LOG OUT
              </button>
            </div>
          ) : null}
        </header>

        <div className="auth-panel-area">
          {mode === "login" ? (
            <LoginPanel
              email={loginEmail}
              onChangeEmail={setLoginEmail}
              onChangePassword={setLoginPassword}
              onGoogleLogin={handleGoogleLogin}
              onShowSignup={() => {
                setMessage("")
                setError("")
                setMode("signup")
              }}
              onSubmit={handleLogin}
              password={loginPassword}
            />
          ) : (
            <SignupPanel
              email={registerEmail}
              name={registerName}
              onChangeEmail={handleRegisterEmailChange}
              onChangeName={setRegisterName}
              onChangePassword={setRegisterPassword}
              onChangePasswordConfirm={setRegisterPasswordConfirm}
              onCheckDuplicate={handleDuplicateCheck}
              onShowLogin={() => {
                setMessage("")
                setError("")
                setMode("login")
              }}
              onSubmit={handleRegister}
              password={registerPassword}
              passwordConfirm={registerPasswordConfirm}
            />
          )}

          {message ? <p className="feedback success-feedback">{message}</p> : null}
          {error ? <p className="feedback error-feedback">{error}</p> : null}
        </div>
      </div>
    </main>
  )
}
