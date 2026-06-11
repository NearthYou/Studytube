import type { PostWithMeta, SortOption } from '../types/community'
import { appendQueryParam, API_BASE_URL, getAuthHeaders, requestJson } from './apiClient'

export type FetchPostsParams = {
  q?: string
  regionCode?: string
  budgetCode?: string
  themeCode?: string
  season?: string
  companion?: string
  sort?: SortOption
  page?: number
  limit?: number
}

export type FetchPostsResponse = {
  items: PostWithMeta[]
  totalCount: number
  page: number
  limit: number
  totalPages: number
  sort: SortOption
}

type IncrementPostViewResponse = {
  postId: number
  viewCount: number
}

type PostPayload = {
  title: string
  travelDate: string
  imageUrl?: string
  regionCode: string
  budgetCode: string
  themeCode: string
  season: string
  companion: string
  content?: string
  tags?: string[]
}

type CreatePostResponse = {
  message: string
  post: PostWithMeta
}

type UpdatePostResponse = {
  message: string
  post: PostWithMeta
}

type DeletePostResponse = {
  message: string
  postId: number
}

type GetPostResponse = {
  post: PostWithMeta
}

export async function fetchPosts(params: FetchPostsParams) {
  const searchParams = new URLSearchParams()

  appendQueryParam(searchParams, 'q', params.q?.trim())
  appendQueryParam(searchParams, 'regionCode', params.regionCode)
  appendQueryParam(searchParams, 'budgetCode', params.budgetCode)
  appendQueryParam(searchParams, 'themeCode', params.themeCode)
  appendQueryParam(searchParams, 'season', params.season)
  appendQueryParam(searchParams, 'companion', params.companion)
  appendQueryParam(searchParams, 'sort', params.sort)
  appendQueryParam(searchParams, 'page', params.page)
  appendQueryParam(searchParams, 'limit', params.limit)

  const queryString = searchParams.toString()
  const url = queryString ? `${API_BASE_URL}/posts?${queryString}` : `${API_BASE_URL}/posts`

  return requestJson<FetchPostsResponse>(url.replace(API_BASE_URL, ''))
}

export async function fetchPostById(postId: number) {
  return requestJson<GetPostResponse>(`/posts/${postId}`)
}

export async function incrementPostView(postId: number) {
  return requestJson<IncrementPostViewResponse>(`/posts/${postId}/view`, {
    method: 'POST',
  })
}

export async function createPost(payload: PostPayload) {
  return requestJson<CreatePostResponse>('/posts', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  })
}

export async function updatePost(postId: number, payload: PostPayload) {
  return requestJson<UpdatePostResponse>(`/posts/${postId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  })
}

export async function deletePost(postId: number) {
  return requestJson<DeletePostResponse>(`/posts/${postId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
}
