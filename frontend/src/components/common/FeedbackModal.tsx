import { AlertTriangle, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { MouseEvent } from 'react'

type FeedbackModalProps = {
  message: string
  onClose: () => void
  title?: string
}

export function FeedbackModal({
  message,
  onClose,
  title = '요청을 처리하지 못했습니다',
}: FeedbackModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    document.body.classList.add('is-feedback-modal-open')

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('is-feedback-modal-open')
      window.requestAnimationFrame(() => restoreFocusRef.current?.focus())
    }
  }, [onClose])

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <div className="feedback-modal-backdrop" onMouseDown={handleBackdropMouseDown}>
      <section
        className="feedback-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="feedback-modal-icon" aria-hidden="true">
          <AlertTriangle size={22} />
        </div>
        <div className="feedback-modal-content">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{message}</p>
        </div>
        <button
          className="feedback-modal-close"
          type="button"
          aria-label="예외 메시지 닫기"
          ref={closeButtonRef}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </section>
    </div>
  )
}
