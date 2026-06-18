import { PostForm } from '../components/board/PostForm'
import { FeedbackModal } from '../components/common/FeedbackModal'
import { AppLayout } from '../components/layout/AppLayout'
import { LoginRequiredPanel } from '../components/auth/LoginRequiredPanel'
import { useFeedbackModal } from '../hooks/useFeedbackModal'
import { useProtectedPost } from '../hooks/useProtectedPost'
import { appPaths } from '../utils/paths'

type PostEditPageProps = {
  postId: string
}

export function PostEditPage({ postId }: PostEditPageProps) {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const redirectPath = appPaths.postEdit(postId)
  const { isAuthenticated, post, status } = useProtectedPost({ postId, redirectPath, onError: openErrorModal })

  return (
    <AppLayout variant="board" mainClassName="board-main">
      {!isAuthenticated ? (
        <LoginRequiredPanel redirectPath={redirectPath} description="게시글을 수정하려면 먼저 로그인해주세요." />
      ) : post?.isOwner ? (
        <PostForm mode="edit" post={post} onError={openErrorModal} />
      ) : post ? (
        <section className="board-panel empty-board-panel">
          <h1>수정 권한이 없습니다.</h1>
          <p>작성자 본인만 게시글을 수정할 수 있습니다.</p>
          <a className="ghost-action-button" href={appPaths.postDetail(post.id)}>
            게시글로 돌아가기
          </a>
        </section>
      ) : (
        <section className="board-panel empty-board-panel">
          <h1>{status}</h1>
          <a className="ghost-action-button" href={appPaths.home}>
            목록으로 돌아가기
          </a>
        </section>
      )}
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </AppLayout>
  )
}
