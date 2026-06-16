import { useCallback, useEffect, useState } from 'react'
import { likePost, unlikePost } from '../api/likes'
import { fetchPost, incrementPostViews } from '../api/posts'
import type { Post } from '../types/post'
import { redirectAnonymousUser } from '../utils/authGuard'
import { getErrorMessage } from '../utils/error'
import { appPaths } from '../utils/paths'
import { usePostComments } from './usePostComments'

type UsePostDetailOptions = {
  onError?: (message: string) => void
}

export function usePostDetail(postId: string, { onError }: UsePostDetailOptions = {}) {
  const [post, setPost] = useState<Post | null>(null)
  const [status, setStatus] = useState('불러오는 중입니다.')
  const handleCommentTotalChange = useCallback((totalCount: number) => {
    setPost((current) => (current ? { ...current, commentCount: totalCount } : current))
  }, [])
  const commentState = usePostComments({
    post,
    postId,
    onError,
    onCommentTotalChange: handleCommentTotalChange,
    onCommentCountChange: (delta) => {
      setPost((current) =>
        current ? { ...current, commentCount: Math.max(0, current.commentCount + delta) } : current,
      )
    },
  })

  useEffect(() => {
    let isMounted = true

    async function loadPost() {
      setStatus('불러오는 중입니다.')

      try {
        const postResponse = await fetchPost(postId)

        if (!isMounted) {
          return
        }

        setPost(postResponse)
        setStatus('')
        void incrementPostViews(postId).catch(() => undefined)
      } catch (error) {
        if (!isMounted) {
          return
        }

        setStatus('게시글을 찾을 수 없습니다.')
        onError?.(getErrorMessage(error, '게시글을 불러오지 못했습니다.'))
      }
    }

    void loadPost()

    return () => {
      isMounted = false
    }
  }, [onError, postId])

  const handlePostLike = async () => {
    if (!post) {
      return
    }

    if (redirectAnonymousUser(appPaths.postDetail(post.id))) {
      return
    }

    try {
      const response = post.likedByMe ? await unlikePost(post.id) : await likePost(post.id)

      setPost((current) =>
        current
          ? {
              ...current,
              likedByMe: response.likedByMe,
              likeCount: response.likeCount,
            }
          : current,
      )
      setStatus('')
    } catch (error) {
      setStatus('')
      onError?.(getErrorMessage(error, '좋아요 처리 중 오류가 발생했습니다.'))
    }
  }

  return {
    ...commentState,
    post,
    status: commentState.status || status,
    handlePostLike,
  }
}
