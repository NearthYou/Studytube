import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import { toComment } from './commentMapper'
import type { BackendComment } from './commentMapper'

export type { Comment } from './commentMapper'

type CommentListResponse = {
  items: BackendComment[]
  page: number
  limit: number
  totalCount: number
  totalPages: number
  message: string
}

export type CommentListResult = Omit<CommentListResponse, 'items'> & {
  items: ReturnType<typeof toComment>[]
}

export type CommentListOptions = {
  limit?: number
  page?: number
}

export const commentPageSize = 20

export function getCommentsPath(postId: string, { limit = commentPageSize, page = 1 }: CommentListOptions = {}) {
  const searchParams = new URLSearchParams({
    limit: String(limit),
    page: String(page),
  })

  return `/api/posts/${postId}/comments?${searchParams.toString()}`
}

export async function fetchComments(postId: string, options: CommentListOptions = {}): Promise<CommentListResult> {
  const response = await apiGet<CommentListResponse>(getCommentsPath(postId, options), true)

  return {
    ...response,
    items: response.items.map(toComment),
  }
}

export async function createComment(postId: string, content: string) {
  const response = await apiPost<{ comment: BackendComment; message: string }>(
    `/api/posts/${postId}/comments`,
    { content },
    true,
  )

  return {
    ...response,
    comment: toComment(response.comment),
  }
}

export async function updateComment(commentId: string, content: string) {
  const response = await apiPatch<{ comment: BackendComment; message: string }>(
    `/api/comments/${commentId}`,
    { content },
    true,
  )

  return {
    ...response,
    comment: toComment(response.comment),
  }
}

export function deleteComment(commentId: string) {
  return apiDelete<{ commentId: string; message: string }>(`/api/comments/${commentId}`, true)
}
