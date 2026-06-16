import { useState } from 'react'
import type { Post } from '../types/post'

const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp']
const maxImageCount = 1
const maxImageSize = 5 * 1024 * 1024

export function usePostImageAttachments(post?: Post) {
  const [existingImages, setExistingImages] = useState(post?.images ?? [])
  const [pendingImages, setPendingImages] = useState<File[]>([])
  const [imageStatus, setImageStatus] = useState('')

  const handleImageSelect = (files: File[]) => {
    if (!files.length) {
      return
    }

    const totalCount = existingImages.length + pendingImages.length + files.length

    if (totalCount > maxImageCount) {
      setImageStatus('이미지는 최대 1장만 첨부할 수 있습니다.')
      return
    }

    const invalidFile = files.find((file) => !allowedImageTypes.includes(file.type) || file.size > maxImageSize)

    if (invalidFile) {
      setImageStatus('jpg, png, webp 이미지만 5MB 이하로 첨부할 수 있습니다.')
      return
    }

    setPendingImages((current) => [...current, ...files])
    setImageStatus('')
  }

  const removeExistingImage = (imageId: string) => {
    setExistingImages((current) => current.filter((image) => image.id !== imageId))
    setImageStatus('')
  }

  const removePendingImage = (imageIndex: number) => {
    setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== imageIndex))
    setImageStatus('')
  }

  return {
    existingImages,
    imageStatus,
    pendingImages,
    handleImageSelect,
    removeExistingImage,
    removePendingImage,
  }
}
