import { deleteComment, updateComment as updateCommentRequest } from '../api/comments'
import type { Comment as ApiComment } from '../api/comments'
import { likeComment, unlikeComment } from '../api/likes'
import { redirectAnonymousUser } from '../utils/authGuard'
import { getErrorMessage } from '../utils/error'
import { appPaths } from '../utils/paths'

type UseCommentActionsOptions = {
  activePostId: string
  clearCommentEdit: () => void
  clearCommentEditIfActive: (commentId: string) => void
  editingBody: string
  onCommentCountChange: (delta: number) => void
  onError?: (message: string) => void
  removeComment: (commentId: string) => void
  replaceComment: (commentId: string, getNextComment: (comment: ApiComment) => ApiComment) => void
  setPendingCommentId: (commentId: string | null) => void
  setStatus: (message: string) => void
}

export function useCommentActions({
  activePostId,
  clearCommentEdit,
  clearCommentEditIfActive,
  editingBody,
  onCommentCountChange,
  onError,
  removeComment,
  replaceComment,
  setPendingCommentId,
  setStatus,
}: UseCommentActionsOptions) {
  const redirectToCurrentPost = () => redirectAnonymousUser(appPaths.postDetail(activePostId))

  const handleCommentLike = async (comment: ApiComment) => {
    if (redirectToCurrentPost()) {
      return
    }

    try {
      const response = comment.likedByMe ? await unlikeComment(comment.id) : await likeComment(comment.id)

      replaceComment(comment.id, (item) => ({
        ...item,
        likedByMe: response.likedByMe,
        likeCount: response.likeCount,
      }))
      setStatus('')
    } catch (error) {
      setStatus('')
      onError?.(getErrorMessage(error, '댓글 좋아요 처리 중 오류가 발생했습니다.'))
    }
  }

  const handleCommentEdit = async (comment: ApiComment) => {
    const nextContent = editingBody.trim()

    if (!nextContent) {
      setStatus('댓글 내용을 입력해 주세요.')
      return
    }

    if (redirectToCurrentPost()) {
      return
    }

    try {
      setPendingCommentId(comment.id)

      const response = await updateCommentRequest(comment.id, nextContent)

      replaceComment(comment.id, () => response.comment)
      clearCommentEdit()
      setStatus(response.message)
    } catch (error) {
      setStatus('')
      onError?.(getErrorMessage(error, '댓글 수정 중 오류가 발생했습니다.'))
    } finally {
      setPendingCommentId(null)
    }
  }

  const handleCommentDelete = async (comment: ApiComment) => {
    if (redirectToCurrentPost()) {
      return
    }

    try {
      setPendingCommentId(comment.id)

      const response = await deleteComment(comment.id)

      removeComment(comment.id)
      onCommentCountChange(-1)
      clearCommentEditIfActive(comment.id)
      setStatus(response.message)
    } catch (error) {
      setStatus('')
      onError?.(getErrorMessage(error, '댓글 삭제 중 오류가 발생했습니다.'))
    } finally {
      setPendingCommentId(null)
    }
  }

  return {
    handleCommentDelete,
    handleCommentEdit,
    handleCommentLike,
  }
}
