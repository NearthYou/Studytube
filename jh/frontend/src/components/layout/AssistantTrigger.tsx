import type { RefObject } from 'react'
import tailTalkLogo from '../../assets/tail_talk_logo.png'

type AssistantTriggerProps = {
  isOpen: boolean
  onToggle: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

export function AssistantTrigger({ isOpen, onToggle, triggerRef }: AssistantTriggerProps) {
  return (
    <button
      className="assistant-trigger"
      type="button"
      aria-label={isOpen ? 'Tail Talk Assistant 닫기' : 'Tail Talk Assistant 열기'}
      aria-controls="tail-talk-assistant-panel"
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      ref={triggerRef}
      onClick={onToggle}
    >
      <img className="assistant-trigger-logo" src={tailTalkLogo} alt="" />
      <span className="assistant-trigger-copy">
        <span className="assistant-trigger-name">Tail Talk Assistant</span>
        <span className="assistant-trigger-text">궁금한 게시글을 빠르게 찾아보세요</span>
      </span>
    </button>
  )
}
