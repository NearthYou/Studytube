import { describe, expect, it } from 'vitest'
import { toPost } from './postMapper'
import type { BackendPost } from './postMapper'

describe('postMapper', () => {
  it('maps backend post shape to UI model', () => {
    const post = toPost(createBackendPost())

    expect(post.id).toBe('12')
    expect(post.category).toBe('walk')
    expect(post.categoryInfo?.label).toBe('산책')
    expect(post.author).toBe('마루집사')
    expect(post.imageUrl).toContain('/uploads/post.jpg')
    expect(post.images[0].url).toContain('/uploads/post.jpg')
  })

  it('keeps image alt text meaningful for empty or invalid backend values', () => {
    const post = toPost({
      ...createBackendPost(),
      title: 'undefined',
      images: [],
      thumbnailUrl: null,
      author: {
        id: '1',
        nickname: 'null',
        profileImageUrl: '/uploads/profile.jpg',
      },
    })

    expect(post.title).toBe('게시글')
    expect(post.author).toBe('익명')
    expect(post.authorProfileImageUrl).toContain('/uploads/profile.jpg')
    expect(post.imageAlt).toBe('Tail Talk 기본 게시글 이미지')
    expect(post.imageAlt).not.toMatch(/undefined|null/)
  })
})

function createBackendPost(): BackendPost {
  return {
    id: '12',
    title: '오늘 산책',
    content: '본문',
    body: '본문 요약',
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: null,
    views: 3,
    author: {
      id: '1',
      nickname: '마루집사',
      profileImageUrl: null,
    },
    categories: [
      {
        id: '2',
        name: '산책',
        value: 'walk',
      },
    ],
    category: {
      id: '2',
      name: '산책',
      value: 'walk',
    },
    tags: [{ id: '9', name: 'park' }],
    images: [
      {
        id: '5',
        originalFilename: 'post.jpg',
        url: '/uploads/post.jpg',
        fileSize: '100',
        mimeType: 'image/jpeg',
      },
    ],
    thumbnailUrl: null,
    likeCount: 4,
    commentCount: 2,
    likedByMe: true,
    isOwner: false,
  }
}
