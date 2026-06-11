import { getAuthToken } from './authApi'
import type { PostWithMeta, SortOption } from '../types/community'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'

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

type CreatePostPayload = {
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

type GetPostResponse = {
  post: PostWithMeta
}

function appendQueryParam(
  searchParams: URLSearchParams,
  key: string,
  value: string | number | undefined,
) {
  if (value === undefined || value === '') {
    return
  }

  searchParams.set(key, String(value))
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      (data &&
        typeof data === 'object' &&
        'message' in data &&
        typeof data.message === 'string' &&
        data.message) ||
      '요청을 처리하지 못했습니다.'

    throw new Error(message)
  }

  return data as T
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

  return requestJson<FetchPostsResponse>(url)
}

export async function fetchPostById(postId: number) {
  return requestJson<GetPostResponse>(`${API_BASE_URL}/posts/${postId}`)
}

export async function incrementPostView(postId: number) {
  return requestJson<IncrementPostViewResponse>(`${API_BASE_URL}/posts/${postId}/view`, {
    method: 'POST',
  })
}

export async function createPost(payload: CreatePostPayload) {
  const token = getAuthToken()

  if (!token) {
    throw new Error('로그인이 필요합니다.')
  }

  return requestJson<CreatePostResponse>(`${API_BASE_URL}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}
