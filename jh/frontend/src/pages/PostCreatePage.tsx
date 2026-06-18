import { LoginRequiredPanel } from '../components/auth/LoginRequiredPanel'
import { PostForm } from '../components/board/PostForm'
import { FeedbackModal } from '../components/common/FeedbackModal'
import { AppLayout } from '../components/layout/AppLayout'
import { useFeedbackModal } from '../hooks/useFeedbackModal'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { appPaths } from '../utils/paths'

export function PostCreatePage() {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const { isAuthenticated } = useRequireAuth(appPaths.postCreate)

  if (!isAuthenticated) {
    return (
      <AppLayout variant="board" mainClassName="board-main">
        <LoginRequiredPanel redirectPath={appPaths.postCreate} description="새 게시글을 작성하려면 먼저 로그인해주세요." />
        {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
      </AppLayout>
    )
  }

  return (
    <AppLayout variant="board" mainClassName="board-main">
      <PostForm mode="create" onError={openErrorModal} />
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </AppLayout>
  )
}
