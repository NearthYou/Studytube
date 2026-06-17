import { apiDelete, apiForm, apiGet, apiPatch, apiPost } from './client'
import { toPost } from './postMapper'
import type { BackendPost, BackendPostListResponse } from './postMapper'
import type { PostImage } from '../types/post'

export type PostListResponse = BackendPostListResponse

export type PostQuery = {
  categoryId?: string
  keyword?: string
  limit?: number
  page?: number
  sort?: 'latest' | 'popular' | 'views'
  tag?: string
}

export type SavePostPayload = {
  title: string
  content: string
  categoryIds: string[]
  imageIds: string[]
  tagNames?: string[]
}

export async function fetchPosts(query: PostQuery = {}) {
  const params = toSearchParams(query)
  const response = await apiGet<PostListResponse>(`/api/posts?${params.toString()}`, true)

  return {
    ...response,
    items: response.items.map(toPost),
  }
}

export async function searchPosts(query: PostQuery & { keyword: string }) {
  const params = toSearchParams(query)
  const response = await apiGet<PostListResponse>(`/api/posts/search?${params.toString()}`, true)

  return {
    ...response,
    items: response.items.map(toPost),
  }
}

export async function fetchPost(postId: string) {
  return toPost(await apiGet<BackendPost>(`/api/posts/${postId}`, true))
}

export async function createPost(payload: SavePostPayload) {
  const response = await apiPost<{ post: BackendPost; message: string }>('/api/posts', payload, true)

  return {
    ...response,
    post: toPost(response.post),
  }
}

export async function updatePost(postId: string, payload: SavePostPayload) {
  const response = await apiPatch<{ post: BackendPost; message: string }>(`/api/posts/${postId}`, payload, true)

  return {
    ...response,
    post: toPost(response.post),
  }
}

export function deletePost(postId: string) {
  return apiDelete<{ postId: string; message: string }>(`/api/posts/${postId}`, true)
}

export function incrementPostViews(postId: string) {
  return apiPost<{ postId: string; views: number; message: string }>(`/api/posts/${postId}/views`)
}

export async function uploadPostImages(files: File[]) {
  const formData = new FormData()

  files.forEach((file) => formData.append('images', file))

  return apiForm<{ images: PostImage[]; message: string }>('/api/posts/images', formData, true)
}

export function deletePostImage(imageId: string) {
  return apiDelete<{ imageId: string; message: string }>(`/api/posts/images/${imageId}`, true)
}

function toSearchParams(query: PostQuery) {
  const params = new URLSearchParams()

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      params.set(key, String(value))
    }
  })

  return params
}
