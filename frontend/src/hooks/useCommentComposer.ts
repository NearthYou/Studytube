import { useState } from 'react'
import { createComment } from '../api/comments'
import type { Comment as ApiComment } from '../api/comments'
import type { Post } from '../types/post'
import { redirectAnonymousUser } from '../utils/authGuard'
import { getErrorMessage } from '../utils/error'
import { appPaths } from '../utils/paths'

type UseCommentComposerOptions = {
  appendComment: (postId: string, comment: ApiComment) => void
  onError?: (message: string) => void
  onCommentCountChange: (delta: number) => void
  post: Post | null
  setStatus: (message: string) => void
}

export function useCommentComposer({
  appendComment,
  onError,
  onCommentCountChange,
  post,
  setStatus,
}: UseCommentComposerOptions) {
  const [commentBody, setCommentBody] = useState('')

  const handleCommentSubmit = async () => {
    if (!post) {
      return
    }

    const nextCommentBody = commentBody.trim()

    if (!nextCommentBody) {
      setStatus('댓글 내용을 입력해 주세요.')
      return
    }

    if (redirectAnonymousUser(appPaths.postDetail(post.id))) {
      return
    }

    try {
      const response = await createComment(post.id, nextCommentBody)

      appendComment(post.id, response.comment)
      setCommentBody('')
      onCommentCountChange(1)
      setStatus(response.message)
    } catch (error) {
      setStatus('')
      onError?.(getErrorMessage(error, '댓글 등록 중 오류가 발생했습니다.'))
    }
  }

  return {
    commentBody,
    handleCommentSubmit,
    setCommentBody,
  }
}
