import { resolveApiAssetUrl } from './base'
import fallbackPostImage from '../assets/tail_talk_logo.png'
import type { Category, WritableCategoryValue } from '../types/category'
import type { Post, PostImage } from '../types/post'
import { formatRelativeTime } from '../utils/date'

type BackendCategory = {
  id: string
  name: string
  value: WritableCategoryValue
}

type BackendTag = {
  id: string
  name: string
}

type BackendPostImage = {
  id: string
  url: string
  thumbnailUrl?: string | null
  cardUrl?: string | null
  detailUrl?: string | null
  originalUrl?: string | null
  originalFilename: string
  fileSize: string
  mimeType: string
}

export type BackendPost = {
  id: string
  title: string
  content: string
  body: string
  createdAt: string
  updatedAt: string | null
  views: number
  author: {
    id: string
    nickname: string
    profileImageUrl: string | null
  }
  categories: BackendCategory[]
  category: BackendCategory | null
  tags: BackendTag[]
  images: BackendPostImage[]
  thumbnailUrl: string | null
  detailImageUrl?: string | null
  likeCount: number
  commentCount: number
  likedByMe: boolean
  isOwner: boolean
}

export type BackendPostListResponse = {
  items: BackendPost[]
  page: number
  limit: number
  totalCount: number
  totalPages: number
  message: string
}

export function toPost(post: BackendPost): Post {
  const images = post.images.map(toPostImage)
  const firstImageUrl = post.thumbnailUrl ?? post.images[0]?.cardUrl ?? post.images[0]?.url ?? ''
  const detailImageUrl = post.detailImageUrl ?? post.images[0]?.detailUrl ?? firstImageUrl
  const primaryCategory = post.category ?? post.categories[0] ?? null
  const safeTitle = toSafeText(post.title, '게시글')
  const cardImageUrl = firstImageUrl ? resolveApiAssetUrl(firstImageUrl) : fallbackPostImage
  const resolvedDetailImageUrl = detailImageUrl ? resolveApiAssetUrl(detailImageUrl) : cardImageUrl

  return {
    id: post.id,
    category: primaryCategory?.value ?? 'daily',
    categoryInfo: primaryCategory ? toCategorySummary(primaryCategory) : null,
    categories: post.categories.map(toCategorySummary),
    tags: post.tags ?? [],
    title: safeTitle,
    body: post.body,
    content: post.content,
    author: toSafeText(post.author.nickname, '익명'),
    authorId: post.author.id,
    authorProfileImageUrl: post.author.profileImageUrl ? resolveApiAssetUrl(post.author.profileImageUrl) : null,
    time: formatRelativeTime(post.createdAt),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    views: post.views,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    likedByMe: post.likedByMe,
    isOwner: post.isOwner,
    imageUrl: cardImageUrl,
    cardImageUrl,
    detailImageUrl: resolvedDetailImageUrl,
    imageSrcSet: toImageSrcSet(images[0]),
    imageAlt: firstImageUrl ? `${safeTitle} 첨부 이미지` : 'Tail Talk 기본 게시글 이미지',
    images,
  }
}

function toPostImage(image: BackendPostImage): PostImage {
  const originalUrl = image.originalUrl ?? image.url

  return {
    ...image,
    url: resolveApiAssetUrl(image.url),
    thumbnailUrl: resolveApiAssetUrl(image.thumbnailUrl ?? image.url),
    cardUrl: resolveApiAssetUrl(image.cardUrl ?? image.url),
    detailUrl: resolveApiAssetUrl(image.detailUrl ?? image.url),
    originalUrl: resolveApiAssetUrl(originalUrl),
  }
}

function toImageSrcSet(image?: PostImage) {
  if (!image) {
    return ''
  }

  const seenUrls = new Set<string>()

  return [
    [image.thumbnailUrl, '480w'],
    [image.cardUrl, '960w'],
    [image.detailUrl, '1600w'],
  ]
    .filter(([url]) => {
      if (!url || seenUrls.has(url)) {
        return false
      }

      seenUrls.add(url)
      return true
    })
    .map(([url, width]) => `${url} ${width}`)
    .join(', ')
}

function toSafeText(value: string, fallback: string) {
  const trimmed = value.trim()

  return trimmed && trimmed !== 'undefined' && trimmed !== 'null' ? trimmed : fallback
}

function toCategorySummary(category: BackendCategory): Pick<Category, 'id' | 'value' | 'label'> {
  return {
    id: category.id,
    value: category.value,
    label: category.name,
  }
}
