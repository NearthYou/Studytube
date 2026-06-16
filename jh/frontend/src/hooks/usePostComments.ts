import type { Comment as ApiComment } from '../api/comments'
import type { Post } from '../types/post'
import { useCommentActions } from './useCommentActions'
import { useCommentComposer } from './useCommentComposer'
import { useCommentEditing } from './useCommentEditing'
import { useScopedCommentList } from './useScopedCommentList'

type UsePostCommentsOptions = {
  onCommentCountChange: (delta: number) => void
  onCommentTotalChange?: (totalCount: number) => void
  onError?: (message: string) => void
  post: Post | null
  postId: string
}

export function usePostComments({
  onCommentCountChange,
  onCommentTotalChange,
  onError,
  post,
  postId,
}: UsePostCommentsOptions) {
  const activePostId = post?.id ?? postId
  const postIdForComments = post?.id
  const {
    clearCommentEdit,
    clearCommentEditIfActive,
    editingBody,
    editingState,
    setEditingBody,
    setPendingCommentId,
    startCommentEdit: setCommentEdit,
  } = useCommentEditing()
  const {
    appendComment,
    areCommentsLoading,
    comments,
    removeComment,
    replaceComment,
    setScopedStatus,
    status,
    totalCommentCount,
    hasMoreComments,
    hasCommentLoadError,
    isLoadingMoreComments,
    loadMoreComments,
  } = useScopedCommentList({ activePostId, onError, onTotalCountChange: onCommentTotalChange, postIdForComments })
  const { commentBody, handleCommentSubmit, setCommentBody } = useCommentComposer({
    appendComment,
    onError,
    onCommentCountChange,
    post,
    setStatus: setScopedStatus,
  })
  const { handleCommentDelete, handleCommentEdit, handleCommentLike } = useCommentActions({
    activePostId,
    clearCommentEdit,
    clearCommentEditIfActive,
    editingBody,
    onCommentCountChange,
    onError,
    removeComment,
    replaceComment,
    setPendingCommentId,
    setStatus: setScopedStatus,
  })

  const startCommentEdit = (comment: ApiComment) => {
    setCommentEdit(comment)
    setScopedStatus('')
  }

  const cancelCommentEdit = () => {
    clearCommentEdit()
    setScopedStatus('')
  }

  return {
    commentBody,
    comments,
    editingState,
    areCommentsLoading,
    hasCommentLoadError,
    hasMoreComments,
    isLoadingMoreComments,
    loadMoreComments,
    status,
    totalCommentCount,
    cancelCommentEdit,
    handleCommentDelete,
    handleCommentEdit,
    handleCommentLike,
    handleCommentSubmit,
    setCommentBody,
    setEditingCommentBody: setEditingBody,
    startCommentEdit,
  }
}
