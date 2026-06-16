import { useEffect, useMemo } from 'react'
import { LogIn } from 'lucide-react'
import { AppLayout } from '../components/layout/AppLayout'
import { saveAuthSession } from '../utils/authStorage'
import type { StoredUser } from '../utils/authStorage'
import { navigate, replaceCurrentPath } from '../utils/navigation'
import { appPaths, toSafeRedirectPath } from '../utils/paths'

export function SocialCallbackPage() {
  const callbackState = useMemo(() => readSocialCallbackState(), [])

  useEffect(() => {
    if (callbackState.kind !== 'success') {
      return
    }

    try {
      saveAuthSession(callbackState.accessToken, callbackState.user, true)
      replaceCurrentPath(appPaths.socialCallback)
      const redirectTimer = window.setTimeout(() => {
        navigate(callbackState.redirect)
      }, 500)

      return () => {
        window.clearTimeout(redirectTimer)
      }
    } catch {
      navigate(`${appPaths.login}?socialError=${encodeURIComponent('소셜 로그인 사용자 정보를 저장하지 못했습니다.')}`)
    }
  }, [callbackState])

  return (
    <AppLayout variant="auth" mainClassName="auth-main">
      <section className="login-panel" aria-labelledby="social-callback-title">
        <div className="login-copy">
          <p className="login-kicker">Tail Talk 소셜 로그인</p>
          <h1 id="social-callback-title">계정을 연결하고 있어요</h1>
          <p className="auth-description">{callbackState.status}</p>
        </div>
        <a className="ui-button ui-button--primary primary-login-button" href={appPaths.login}>
          <LogIn size={16} aria-hidden="true" />
          <span>로그인으로 이동</span>
        </a>
      </section>
    </AppLayout>
  )
}

type SocialCallbackState =
  | {
      kind: 'success'
      accessToken: string
      redirect: string
      status: string
      user: StoredUser
    }
  | {
      kind: 'error'
      status: string
    }

function readSocialCallbackState(): SocialCallbackState {
  const queryError = new URLSearchParams(window.location.search).get('error')

  if (queryError) {
    return {
      kind: 'error',
      status: queryError,
    }
  }

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const accessToken = params.get('accessToken')
  const rawUser = params.get('user')

  if (!accessToken || !rawUser) {
    return {
      kind: 'error',
      status: '소셜 로그인 응답을 확인할 수 없습니다.',
    }
  }

  try {
    return {
      kind: 'success',
      accessToken,
      user: JSON.parse(rawUser) as StoredUser,
      redirect: getSafeRedirect(params.get('redirect')),
      status: params.get('message') ?? '소셜 로그인에 성공했습니다.',
    }
  } catch {
    return {
      kind: 'error',
      status: '소셜 로그인 사용자 정보를 읽지 못했습니다.',
    }
  }
}

function getSafeRedirect(value: string | null) {
  return value ? toSafeRedirectPath(value) : appPaths.home
}
