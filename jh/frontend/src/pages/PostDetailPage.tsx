import { ArrowLeft } from 'lucide-react'
import { CommentSection } from '../components/board/CommentSection'
import { PostDetailArticle } from '../components/board/PostDetailArticle'
import { FeedbackModal } from '../components/common/FeedbackModal'
import { AppLayout } from '../components/layout/AppLayout'
import { useFeedbackModal } from '../hooks/useFeedbackModal'
import { usePostDetail } from '../hooks/usePostDetail'
import { getReturnPath } from '../utils/paths'

type PostDetailPageProps = {
  postId: string
}

export function PostDetailPage({ postId }: PostDetailPageProps) {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const {
    commentBody,
    comments,
    editingState,
    areCommentsLoading,
    hasCommentLoadError,
    hasMoreComments,
    isLoadingMoreComments,
    post,
    status,
    cancelCommentEdit,
    handleCommentDelete,
    handleCommentEdit,
    handleCommentLike,
    handleCommentSubmit,
    handlePostLike,
    loadMoreComments,
    setCommentBody,
    setEditingCommentBody,
    startCommentEdit,
  } = usePostDetail(postId, { onError: openErrorModal })
  const returnPath = getReturnPath()

  return (
    <AppLayout variant="board" mainClassName="board-main">
      {post ? (
        <>
          <PostDetailArticle
            commentCount={post.commentCount}
            onPostLike={handlePostLike}
            post={post}
            returnPath={returnPath}
          />
          <CommentSection
            commentBody={commentBody}
            comments={comments}
            totalCount={post.commentCount}
            editingState={editingState}
            hasCommentLoadError={hasCommentLoadError}
            hasMoreComments={hasMoreComments}
            isLoading={areCommentsLoading}
            isLoadingMore={isLoadingMoreComments}
            onCancelEdit={cancelCommentEdit}
            onChangeCommentBody={setCommentBody}
            onChangeEditingBody={setEditingCommentBody}
            onCommentDelete={handleCommentDelete}
            onCommentEdit={handleCommentEdit}
            onCommentLike={handleCommentLike}
            onCommentSubmit={handleCommentSubmit}
            onLoadMore={loadMoreComments}
            onStartEdit={startCommentEdit}
            status={status}
          />
        </>
      ) : (
        <section className="board-panel empty-board-panel">
          <h1>{status || '게시글을 찾을 수 없습니다.'}</h1>
          <a className="ui-button ui-button--ghost ghost-action-button" href={returnPath}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>목록으로 돌아가기</span>
          </a>
        </section>
      )}
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </AppLayout>
  )
}
