import { useState } from 'react'
import type { Post } from '../types/post'
import { usePostCategories } from './usePostCategories'
import { usePostFormSubmit } from './usePostFormSubmit'
import { usePostImageAttachments } from './usePostImageAttachments'

type UsePostFormOptions = {
  mode: 'create' | 'edit'
  onError?: (message: string) => void
  post?: Post
}

export function usePostForm({ mode, onError, post }: UsePostFormOptions) {
  const isEditMode = mode === 'edit'
  const [title, setTitle] = useState(post?.title ?? '')
  const [content, setContent] = useState(post?.content ?? '')
  const [tagNames, setTagNames] = useState(() => post?.tags.map((tag) => tag.name) ?? [])
  const {
    categoryOptions,
    categoryStatus,
    guideCategory,
    isCategoryReady,
    selectedCategory,
    selectedCategoryId,
    setSelectedCategoryId,
  } = usePostCategories(post, { onError })
  const {
    existingImages,
    imageStatus,
    pendingImages,
    handleImageSelect: selectImages,
    removeExistingImage: removeExistingPostImage,
    removePendingImage: removePendingPostImage,
  } = usePostImageAttachments(post)
  const { clearSaveStatus, handleSubmit, isSubmitting, saveStatus } = usePostFormSubmit({
    content,
    existingImages,
    isEditMode,
    pendingImages,
    post,
    onError,
    selectedCategory,
    tagNames,
    title,
  })
  const formStatus = saveStatus || imageStatus || categoryStatus

  const handleImageSelect = (files: File[]) => {
    clearSaveStatus()
    selectImages(files)
  }

  const removeExistingImage = (imageId: string) => {
    clearSaveStatus()
    removeExistingPostImage(imageId)
  }

  const removePendingImage = (imageIndex: number) => {
    clearSaveStatus()
    removePendingPostImage(imageIndex)
  }

  return {
    categoryOptions,
    content,
    existingImages,
    formStatus,
    guideCategory,
    isCategoryReady,
    isSubmitting,
    pendingImages,
    selectedCategoryId,
    tagNames,
    title,
    handleImageSelect,
    handleSubmit,
    removeExistingImage,
    removePendingImage,
    setContent,
    setSelectedCategoryId,
    setTagNames,
    setTitle,
  }
}
