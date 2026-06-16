import { apiDelete, apiPost } from './client'

type PostLikeResponse = {
  postId: string
  likeCount: number
  likedByMe: boolean
  message: string
}

type CommentLikeResponse = {
  commentId: string
  likeCount: number
  likedByMe: boolean
  message: string
}

export function likePost(postId: string) {
  return apiPost<PostLikeResponse>(`/api/posts/${postId}/likes`, undefined, true)
}

export function unlikePost(postId: string) {
  return apiDelete<PostLikeResponse>(`/api/posts/${postId}/likes`, true)
}

export function likeComment(commentId: string) {
  return apiPost<CommentLikeResponse>(`/api/comments/${commentId}/likes`, undefined, true)
}

export function unlikeComment(commentId: string) {
  return apiDelete<CommentLikeResponse>(`/api/comments/${commentId}/likes`, true)
}
