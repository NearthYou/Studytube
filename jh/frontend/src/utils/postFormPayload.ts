import { uploadPostImages } from '../api/posts'
import type { SavePostPayload } from '../api/posts'
import type { Post } from '../types/post'

type BuildPostPayloadOptions = {
  content: string
  existingImages: Post['images']
  pendingImages: File[]
  selectedCategoryId: string
  tagNames: string[]
  title: string
}

export async function buildPostPayload({
  content,
  existingImages,
  pendingImages,
  selectedCategoryId,
  tagNames,
  title,
}: BuildPostPayloadOptions): Promise<SavePostPayload> {
  const uploaded = pendingImages.length > 0 ? await uploadPostImages(pendingImages) : { images: [] }
  const imageIds = [...existingImages.map((image) => image.id), ...uploaded.images.map((image) => image.id)]

  return {
    title,
    content,
    categoryIds: [selectedCategoryId],
    imageIds,
    tagNames,
  }
}
