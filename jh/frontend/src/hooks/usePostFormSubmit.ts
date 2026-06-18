import { useState } from 'react'
import type { FormEvent } from 'react'
import { createPost, updatePost } from '../api/posts'
import type { Post } from '../types/post'
import type { Category } from '../types/category'
import { redirectAnonymousUser } from '../utils/authGuard'
import { getErrorMessage } from '../utils/error'
import { navigate } from '../utils/navigation'
import { buildPostPayload } from '../utils/postFormPayload'
import { appPaths } from '../utils/paths'

type UsePostFormSubmitOptions = {
  content: string
  existingImages: Post['images']
  isEditMode: boolean
  onError?: (message: string) => void
  pendingImages: File[]
  post?: Post
  selectedCategory: Category | undefined
  tagNames: string[]
  title: string
}

export function usePostFormSubmit({
  content,
  existingImages,
  isEditMode,
  onError,
  pendingImages,
  post,
  selectedCategory,
  tagNames,
  title,
}: UsePostFormSubmitOptions) {
  const [saveStatus, setSaveStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const clearSaveStatus = () => {
    setSaveStatus('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (redirectAnonymousUser()) {
      return
    }

    if (!selectedCategory?.id) {
      setSaveStatus('카테고리 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.')
      return
    }

    setIsSubmitting(true)
    setSaveStatus('')

    try {
      const payload = await buildPostPayload({
        content,
        existingImages,
        pendingImages,
        selectedCategoryId: selectedCategory.id,
        tagNames,
        title,
      })
      const response = isEditMode && post ? await updatePost(post.id, payload) : await createPost(payload)

      setSaveStatus(response.message)
      window.setTimeout(() => {
        navigate(appPaths.postDetail(response.post.id))
      }, 250)
    } catch (error) {
      setSaveStatus('')
      onError?.(getErrorMessage(error, '게시글 저장 중 오류가 발생했습니다.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    clearSaveStatus,
    handleSubmit,
    isSubmitting,
    saveStatus,
  }
}
