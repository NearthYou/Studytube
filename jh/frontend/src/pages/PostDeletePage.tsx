import { useState } from 'react'
import { deletePost } from '../api/posts'
import { LoginRequiredPanel } from '../components/auth/LoginRequiredPanel'
import { FeedbackModal } from '../components/common/FeedbackModal'
import { SafeImage } from '../components/common/SafeImage'
import { AppLayout } from '../components/layout/AppLayout'
import { Trash2, X } from 'lucide-react'
import { getErrorMessage } from '../utils/error'
import { useFeedbackModal } from '../hooks/useFeedbackModal'
import { useProtectedPost } from '../hooks/useProtectedPost'
import { navigate } from '../utils/navigation'
import { appPaths } from '../utils/paths'

type PostDeletePageProps = {
  postId: string
}

export function PostDeletePage({ postId }: PostDeletePageProps) {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const [deleteStatus, setDeleteStatus] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const redirectPath = appPaths.postDelete(postId)
  const { isAuthenticated, post, status } = useProtectedPost({ postId, redirectPath, onError: openErrorModal })

  const handleDelete = async () => {
    if (!post) return

    setIsDeleting(true)
    setDeleteStatus('')

    try {
      const response = await deletePost(post.id)

      setDeleteStatus(response.message)
      window.setTimeout(() => {
        navigate(appPaths.home)
      }, 300)
    } catch (error) {
      openErrorModal(getErrorMessage(error, '삭제 중 오류가 발생했습니다.'))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AppLayout variant="board" mainClassName="board-main">
      {!isAuthenticated ? (
        <LoginRequiredPanel redirectPath={redirectPath} description="게시글을 삭제하려면 먼저 로그인해주세요." />
      ) : (
        <section className="board-panel delete-panel" aria-labelledby="delete-title">
          {post?.isOwner ? (
            <>
              <SafeImage src={post.imageUrl} alt="" fallbackAlt="Tail Talk 기본 게시글 이미지" />
              <div>
                <p className="feed-kicker">게시글 삭제</p>
                <h1 id="delete-title">이 게시글을 삭제할까요?</h1>
                <p className="delete-copy">삭제하면 게시글, 이미지, 댓글, 좋아요가 함께 정리됩니다.</p>
                <strong>{post.title}</strong>
                <div className="form-action-row">
                  <a className="ui-button ui-button--ghost ghost-action-button" href={appPaths.postDetail(post.id)}>
                    <X size={16} aria-hidden="true" />
                    <span>취소</span>
                  </a>
                  <button
                    className="ui-button ui-button--danger danger-action-button"
                    type="button"
                    disabled={isDeleting}
                    onClick={handleDelete}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    <span>삭제하기</span>
                  </button>
                </div>
                {deleteStatus && (
                  <p className="form-status" role="status">
                    {deleteStatus}
                  </p>
                )}
              </div>
            </>
          ) : post ? (
            <div className="delete-panel-message">
              <p className="feed-kicker">게시글 삭제</p>
              <h1 id="delete-title">삭제 권한이 없습니다.</h1>
              <p className="delete-copy">작성자 본인만 게시글을 삭제할 수 있습니다.</p>
              <a className="ui-button ui-button--ghost ghost-action-button" href={appPaths.postDetail(post.id)}>
                <X size={16} aria-hidden="true" />
                <span>게시글로 돌아가기</span>
              </a>
            </div>
          ) : (
            <>
              <h1 id="delete-title">{status}</h1>
              <a className="ui-button ui-button--ghost ghost-action-button" href={appPaths.home}>
                <X size={16} aria-hidden="true" />
                <span>목록으로 돌아가기</span>
              </a>
            </>
          )}
        </section>
      )}
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </AppLayout>
  )
}
