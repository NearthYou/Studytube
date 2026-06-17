import { X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { authModalEventName, consumePendingAuthModal } from '../../utils/authModal'
import type { AuthModalDetail, AuthModalMode } from '../../utils/authModal'
import { getCurrentPathWithSearch } from '../../utils/navigation'
import { appPaths } from '../../utils/paths'
import { toSafeRedirectPath } from '../../utils/paths'
import { LoginPanel } from './LoginPanel'
import { SignupPanel } from './SignupPanel'

type AuthModalState = {
  mode: AuthModalMode
  redirectPath: string
}

export function AuthModalHost() {
  const [modalState, setModalState] = useState<AuthModalState | null>(null)
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const closeModal = useCallback(() => {
    setModalState(null)
  }, [])

  const openModal = useCallback((detail: AuthModalDetail = {}) => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setModalState({
      mode: detail.mode ?? 'login',
      redirectPath: toSafeRedirectPath(detail.redirectPath ?? getCurrentPathWithSearch()),
    })
  }, [])

  useEffect(() => {
    const handleOpenAuthModal = (event: Event) => {
      consumePendingAuthModal()
      openModal((event as CustomEvent<AuthModalDetail>).detail)
    }

    window.addEventListener(authModalEventName, handleOpenAuthModal)

    const pendingAuthModal = consumePendingAuthModal()

    if (pendingAuthModal) {
      const timeoutId = window.setTimeout(() => openModal(pendingAuthModal), 0)

      return () => {
        window.clearTimeout(timeoutId)
        window.removeEventListener(authModalEventName, handleOpenAuthModal)
      }
    }

    if (window.location.pathname === appPaths.login || window.location.pathname === appPaths.signup) {
      const redirectPath = new URLSearchParams(window.location.search).get('redirect') ?? appPaths.home
      const timeoutId = window.setTimeout(() => {
        openModal({
          mode: window.location.pathname === appPaths.signup ? 'signup' : 'login',
          redirectPath,
        })
      }, 0)

      return () => {
        window.clearTimeout(timeoutId)
        window.removeEventListener(authModalEventName, handleOpenAuthModal)
      }
    }

    return () => {
      window.removeEventListener(authModalEventName, handleOpenAuthModal)
    }
  }, [openModal])

  useEffect(() => {
    if (!modalState) {
      window.requestAnimationFrame(() => restoreFocusRef.current?.focus())
      return undefined
    }

    closeButtonRef.current?.focus()
    document.body.classList.add('is-auth-modal-open')

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeModal()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('is-auth-modal-open')
    }
  }, [closeModal, modalState])

  if (!modalState) {
    return null
  }

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      closeModal()
    }
  }

  return (
    <div className="auth-modal-backdrop" onMouseDown={handleBackdropMouseDown}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="auth-modal-heading">
          <p>{modalState.mode === 'login' ? '로그인' : '회원가입'}</p>
          <h2 id={titleId}>{modalState.mode === 'login' ? 'Tail Talk에 다시 오신 걸 환영해요' : 'Tail Talk 계정 만들기'}</h2>
          <button
            className="auth-modal-close"
            type="button"
            aria-label="인증 창 닫기"
            ref={closeButtonRef}
            onClick={closeModal}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {modalState.mode === 'login' ? (
          <LoginPanel
            presentation="modal"
            redirectPath={modalState.redirectPath}
            onSwitchToSignup={() => setModalState((current) => current && { ...current, mode: 'signup' })}
          />
        ) : (
          <SignupPanel
            presentation="modal"
            redirectPath={modalState.redirectPath}
            onSignupComplete={() => setModalState((current) => current && { ...current, mode: 'login' })}
            onSwitchToLogin={() => setModalState((current) => current && { ...current, mode: 'login' })}
          />
        )}
      </section>
    </div>
  )
}
