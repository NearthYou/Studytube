import { getAuthToken } from './authApi'
import type { Comment, Reply } from '../types/community'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'

type GetCommentsResponse = {
  items: Comment[]
}

type CreateCommentResponse = {
  message: string
  comment: Comment
}

type CreateReplyResponse = {
  message: string
  reply: Reply
  commentId: number
  postId: number
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

function getAuthHeaders() {
  const token = getAuthToken()

  if (!token) {
    throw new Error('로그인이 필요합니다.')
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export async function fetchComments(postId: number) {
  return requestJson<GetCommentsResponse>(`${API_BASE_URL}/posts/${postId}/comments`)
}

export async function createComment(postId: number, content: string) {
  return requestJson<CreateCommentResponse>(`${API_BASE_URL}/posts/${postId}/comments`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ content }),
  })
}

export async function createReply(commentId: number, content: string) {
  return requestJson<CreateReplyResponse>(`${API_BASE_URL}/comments/${commentId}/replies`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ content }),
  })
}
