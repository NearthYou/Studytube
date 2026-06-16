import type { Comment, Reply } from '../types/community'
import { getAuthHeaders, requestJson } from './apiClient'

type GetCommentsResponse = {
  items: Comment[]
}

type CreateCommentResponse = {
  message: string
  comment: Comment
}

type UpdateCommentResponse = {
  message: string
  comment: Comment
  postId: number
}

type DeleteCommentResponse = {
  message: string
  commentId: number
  postId: number
}

type CreateReplyResponse = {
  message: string
  reply: Reply
  commentId: number
  postId: number
}

type UpdateReplyResponse = {
  message: string
  reply: Reply
  commentId: number
  postId: number | null
}

type DeleteReplyResponse = {
  message: string
  replyId: number
  commentId: number
  postId: number | null
}

export async function fetchComments(postId: number) {
  return requestJson<GetCommentsResponse>(`/posts/${postId}/comments`)
}

export async function createComment(postId: number, content: string) {
  return requestJson<CreateCommentResponse>(`/posts/${postId}/comments`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ content }),
  })
}

export async function updateComment(commentId: number, content: string) {
  return requestJson<UpdateCommentResponse>(`/comments/${commentId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ content }),
  })
}

export async function deleteComment(commentId: number) {
  return requestJson<DeleteCommentResponse>(`/comments/${commentId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
}

export async function createReply(commentId: number, content: string) {
  return requestJson<CreateReplyResponse>(`/comments/${commentId}/replies`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ content }),
  })
}

export async function updateReply(replyId: number, content: string) {
  return requestJson<UpdateReplyResponse>(`/replies/${replyId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ content }),
  })
}

export async function deleteReply(replyId: number) {
  return requestJson<DeleteReplyResponse>(`/replies/${replyId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
}
