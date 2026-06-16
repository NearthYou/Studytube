import { useEffect, useState } from 'react'
import { fetchPost } from '../api/posts'
import type { Post } from '../types/post'
import { getErrorMessage } from '../utils/error'
import { useRequireAuth } from './useRequireAuth'

type UseProtectedPostOptions = {
  fallbackMessage?: string
  onError?: (message: string) => void
  postId: string
  redirectPath: string
}

type LoadError = {
  message: string
  postId: string
}

export function useProtectedPost({
  fallbackMessage = '게시글을 불러오지 못했습니다.',
  onError,
  postId,
  redirectPath,
}: UseProtectedPostOptions) {
  const [loadedPost, setLoadedPost] = useState<Post | null>(null)
  const [loadError, setLoadError] = useState<LoadError | null>(null)
  const { isAuthenticated, user } = useRequireAuth(redirectPath)
  const currentPost = loadedPost?.id === postId ? loadedPost : null
  const currentError = loadError?.postId === postId ? loadError.message : ''
  const status = !isAuthenticated || currentPost ? '' : currentError || '불러오는 중입니다.'

  useEffect(() => {
    let isMounted = true

    if (!isAuthenticated) {
      return undefined
    }

    void Promise.resolve().then(async () => {
      if (!isMounted) {
        return
      }

      setLoadError(null)

      try {
        const response = await fetchPost(postId)

        if (!isMounted) {
          return
        }

        setLoadedPost(response)
      } catch (error) {
        if (!isMounted) {
          return
        }

        setLoadError({
          message: '게시글을 찾을 수 없습니다.',
          postId,
        })
        onError?.(getErrorMessage(error, fallbackMessage))
      }
    })

    return () => {
      isMounted = false
    }
  }, [fallbackMessage, isAuthenticated, onError, postId])

  return {
    isAuthenticated,
    post: currentPost,
    status,
    user,
  }
}
