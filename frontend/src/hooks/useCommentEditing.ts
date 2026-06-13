import { useState } from 'react'
import type { Comment as ApiComment } from '../api/comments'
import type { CommentEditingState } from '../types/comment'

export function useCommentEditing() {
  const [body, setBody] = useState('')
  const [commentId, setCommentId] = useState<string | null>(null)
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null)

  const startCommentEdit = (comment: ApiComment) => {
    setCommentId(comment.id)
    setBody(comment.content)
  }

  const clearCommentEdit = () => {
    setCommentId(null)
    setBody('')
  }

  const clearCommentEditIfActive = (targetCommentId: string) => {
    if (commentId === targetCommentId) {
      clearCommentEdit()
    }
  }

  const editingState: CommentEditingState = {
    body,
    commentId,
    pendingCommentId,
  }

  return {
    clearCommentEdit,
    clearCommentEditIfActive,
    editingBody: body,
    editingState,
    setEditingBody: setBody,
    setPendingCommentId,
    startCommentEdit,
  }
}
