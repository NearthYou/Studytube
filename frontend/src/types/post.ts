import type { Category, WritableCategoryValue } from './category'

export type Post = {
  id: string
  category: WritableCategoryValue
  categoryInfo: Pick<Category, 'id' | 'value' | 'label'> | null
  categories: Array<Pick<Category, 'id' | 'value' | 'label'>>
  tags: Array<{
    id: string
    name: string
  }>
  title: string
  body: string
  content: string
  author: string
  authorId: string
  authorProfileImageUrl: string | null
  time: string
  createdAt: string
  updatedAt: string | null
  views: number
  likeCount: number
  commentCount: number
  likedByMe: boolean
  isOwner: boolean
  imageUrl: string
  cardImageUrl: string
  detailImageUrl: string
  imageSrcSet: string
  imageAlt: string
  images: Array<{
    id: string
    url: string
    thumbnailUrl: string
    cardUrl: string
    detailUrl: string
    originalUrl: string
    originalFilename: string
  }>
}

export type PostImage = {
  id: string
  url: string
  thumbnailUrl: string
  cardUrl: string
  detailUrl: string
  originalUrl: string
  originalFilename: string
  fileSize: string
  mimeType: string
}
