import type { AuthApiUser } from './authApi'
import { appendQueryParam, getAuthHeaders, requestJson } from './apiClient'
import type { PostWithMeta } from '../types/community'

export type PaginationParams = {
  page?: number
  limit?: number
}

export type CommentActivity = {
  id: number
  postId: number
  postTitle: string
  content: string
  createdAt: string
  updatedAt: string
  type: 'comment' | 'reply'
}

export type FollowUser = AuthApiUser

type PaginatedPostsResponse = {
  items: PostWithMeta[]
  totalCount: number
  page: number
  limit: number
  totalPages: number
}

type PaginatedCommentsResponse = {
  items: CommentActivity[]
  totalCount: number
  page: number
  limit: number
  totalPages: number
}

type PaginatedFollowsResponse = {
  items: FollowUser[]
  totalCount: number
  page: number
  limit: number
  totalPages: number
}

type UpdateMyProfileResponse = {
  message: string
  user: AuthApiUser
}

function createPaginationQuery(params: PaginationParams) {
  const searchParams = new URLSearchParams()

  appendQueryParam(searchParams, 'page', params.page)
  appendQueryParam(searchParams, 'limit', params.limit)

  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}

export function fetchMyPosts(params: PaginationParams = {}) {
  return requestJson<PaginatedPostsResponse>(`/me/posts${createPaginationQuery(params)}`, {
    headers: getAuthHeaders(),
  })
}

export function fetchMyBookmarks(params: PaginationParams = {}) {
  return requestJson<PaginatedPostsResponse>(`/me/bookmarks${createPaginationQuery(params)}`, {
    headers: getAuthHeaders(),
  })
}

export function fetchMyComments(params: PaginationParams = {}) {
  return requestJson<PaginatedCommentsResponse>(`/me/comments${createPaginationQuery(params)}`, {
    headers: getAuthHeaders(),
  })
}

export function fetchMyFollows(params: PaginationParams = {}) {
  return requestJson<PaginatedFollowsResponse>(`/me/follows${createPaginationQuery(params)}`, {
    headers: getAuthHeaders(),
  })
}

export function updateMyProfile(payload: {
  nickname?: string
  password?: string
  bio?: string
  location?: string
}) {
  return requestJson<UpdateMyProfileResponse>('/me/profile', {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  })
}
