import { useEffect, useState } from 'react'
import { commentPageSize, fetchComments } from '../api/comments'
import type { Comment as ApiComment } from '../api/comments'
import { getErrorMessage } from '../utils/error'

type ScopedCommentList = {
  comments: ApiComment[]
  limit: number
  page: number
  postId: string
  totalCount: number
  totalPages: number
}

type ScopedStatus = {
  message: string
  postId: string
  type?: 'error' | 'info'
}

type UseScopedCommentListOptions = {
  activePostId: string
  onTotalCountChange?: (totalCount: number) => void
  onError?: (message: string) => void
  postIdForComments: string | undefined
}

const emptyCommentList: ScopedCommentList = {
  comments: [],
  limit: commentPageSize,
  page: 0,
  postId: '',
  totalCount: 0,
  totalPages: 0,
}

export function useScopedCommentList({
  activePostId,
  onError,
  onTotalCountChange,
  postIdForComments,
}: UseScopedCommentListOptions) {
  const [commentList, setCommentList] = useState<ScopedCommentList>(emptyCommentList)
  const [statusState, setStatusState] = useState<ScopedStatus | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const comments = commentList.postId === activePostId ? commentList.comments : []
  const totalCommentCount = commentList.postId === activePostId ? commentList.totalCount : 0
  const hasScopedStatus = statusState?.postId === postIdForComments
  const areCommentsLoading = Boolean(
    postIdForComments && commentList.postId !== postIdForComments && !hasScopedStatus,
  )
  const hasMoreComments = Boolean(
    commentList.postId === activePostId && commentList.page > 0 && commentList.page < commentList.totalPages,
  )
  const status = statusState?.postId === activePostId ? statusState.message : ''
  const hasCommentLoadError = Boolean(
    statusState?.postId === activePostId && statusState.type === 'error',
  )

  useEffect(() => {
    if (!postIdForComments) {
      return undefined
    }

    let isMounted = true
    const scopedPostId = postIdForComments

    void Promise.resolve().then(async () => {
      try {
        const response = await fetchComments(scopedPostId, { limit: commentPageSize, page: 1 })

        if (!isMounted) {
          return
        }

        setCommentList({
          comments: response.items,
          limit: response.limit,
          page: response.page,
          postId: scopedPostId,
          totalCount: response.totalCount,
          totalPages: response.totalPages,
        })
        onTotalCountChange?.(response.totalCount)
        setStatusState({ message: '', postId: scopedPostId, type: 'info' })
      } catch (error) {
        if (!isMounted) {
          return
        }

        setStatusState({
          message: '댓글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
          postId: scopedPostId,
          type: 'error',
        })
        onError?.(getErrorMessage(error, '댓글을 불러오지 못했습니다.'))
      }
    })

    return () => {
      isMounted = false
    }
  }, [onError, onTotalCountChange, postIdForComments])

  const setScopedStatus = (message: string, type: ScopedStatus['type'] = 'info') => {
    setStatusState({ message, postId: activePostId, type })
  }

  const appendComment = (postId: string, comment: ApiComment) => {
    setCommentList((current) => {
      const comments = current.postId === postId ? [...current.comments, comment] : [comment]
      const limit = current.postId === postId ? current.limit : commentPageSize
      const totalCount = current.postId === postId ? current.totalCount + 1 : 1

      return {
        comments,
        limit,
        page: Math.max(1, current.postId === postId ? current.page : 1),
        postId,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      }
    })
  }

  const replaceComment = (commentId: string, getNextComment: (comment: ApiComment) => ApiComment) => {
    setCommentList((current) => ({
      ...current,
      comments: current.comments.map((item) => (item.id === commentId ? getNextComment(item) : item)),
    }))
  }

  const removeComment = (commentId: string) => {
    setCommentList((current) => {
      const comments = current.comments.filter((item) => item.id !== commentId)
      const removedCount = comments.length === current.comments.length ? 0 : 1
      const totalCount = Math.max(0, current.totalCount - removedCount)

      return {
        ...current,
        comments,
        totalCount,
        totalPages: Math.ceil(totalCount / current.limit),
      }
    })
  }

  const loadMoreComments = async () => {
    if (!postIdForComments || commentList.postId !== activePostId || !hasMoreComments || isLoadingMore) {
      return
    }

    setIsLoadingMore(true)
    setScopedStatus('')

    try {
      const response = await fetchComments(postIdForComments, {
        limit: commentList.limit,
        page: commentList.page + 1,
      })

      setCommentList((current) => {
        if (current.postId !== postIdForComments) {
          return current
        }

        const existingIds = new Set(current.comments.map((comment) => comment.id))
        const nextComments = response.items.filter((comment) => !existingIds.has(comment.id))

        return {
          comments: [...current.comments, ...nextComments],
          limit: response.limit,
          page: response.page,
          postId: postIdForComments,
          totalCount: response.totalCount,
          totalPages: response.totalPages,
        }
      })
      onTotalCountChange?.(response.totalCount)
    } catch (error) {
      setScopedStatus('댓글을 더 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'error')
      onError?.(getErrorMessage(error, '댓글을 더 불러오지 못했습니다.'))
    } finally {
      setIsLoadingMore(false)
    }
  }

  return {
    appendComment,
    areCommentsLoading,
    comments,
    hasMoreComments,
    hasCommentLoadError,
    isLoadingMoreComments: isLoadingMore,
    loadMoreComments,
    removeComment,
    replaceComment,
    setScopedStatus,
    status,
    totalCommentCount,
  }
}
