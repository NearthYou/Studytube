import type { AuthApiUser } from './authApi'
import { appendQueryParam, requestJson } from './apiClient'
import type { PostWithMeta } from '../types/community'

type UserProfileResponse = {
  user: AuthApiUser
}

type UserPostsResponse = {
  user: AuthApiUser
  items: PostWithMeta[]
  totalCount: number
  page: number
  limit: number
  totalPages: number
}

export function fetchUserProfile(userId: number) {
  return requestJson<UserProfileResponse>(`/users/${userId}`)
}

export function fetchUserPosts(
  userId: number,
  params: {
    page?: number
    limit?: number
  } = {},
) {
  const searchParams = new URLSearchParams()
  appendQueryParam(searchParams, 'page', params.page)
  appendQueryParam(searchParams, 'limit', params.limit)
  const queryString = searchParams.toString()

  return requestJson<UserPostsResponse>(
    `/users/${userId}/posts${queryString ? `?${queryString}` : ''}`,
  )
}
