import { LogIn } from 'lucide-react'
import { openAuthModal } from '../../utils/authModal'

type LoginRequiredPanelProps = {
  description?: string
  redirectPath: string
  title?: string
}

export function LoginRequiredPanel({
  description = '이 기능을 사용하려면 먼저 로그인해주세요.',
  redirectPath,
  title = '로그인이 필요합니다',
}: LoginRequiredPanelProps) {
  return (
    <section className="board-panel empty-board-panel">
      <h1>{title}</h1>
      <p>{description}</p>
      <button
        className="ui-button ui-button--primary primary-login-button"
        type="button"
        onClick={() => openAuthModal({ mode: 'login', redirectPath })}
      >
        <LogIn size={16} aria-hidden="true" />
        <span>로그인하기</span>
      </button>
    </section>
  )
}
