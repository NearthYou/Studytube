import { getAuthHeaders, requestJson } from './apiClient'

type BookmarkResponse = {
  message: string
  postId: number
  bookmarked: boolean
}

type FollowResponse = {
  message: string
  userId: number
  following: boolean
}

export function addBookmark(postId: number) {
  return requestJson<BookmarkResponse>(`/posts/${postId}/bookmark`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })
}

export function removeBookmark(postId: number) {
  return requestJson<BookmarkResponse>(`/posts/${postId}/bookmark`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
}

export function followUser(userId: number) {
  return requestJson<FollowResponse>(`/users/${userId}/follow`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })
}

export function unfollowUser(userId: number) {
  return requestJson<FollowResponse>(`/users/${userId}/follow`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
}
