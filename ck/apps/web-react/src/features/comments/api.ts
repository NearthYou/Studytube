import { apiRequest } from "../../shared/api"
import { buildCommentListPath, type CommentSort } from "./comment-api-paths"
import type { CommentListResponse, PublicComment } from "./types"

export function getComments(reviewId: string, sort: CommentSort = "oldest") {
  return apiRequest<CommentListResponse>(buildCommentListPath(reviewId, sort))
}

export function createComment(reviewId: string, content: string, parentId?: string) {
  return apiRequest<PublicComment>(`/seat-reviews/${reviewId}/comments`, {
    method: "POST",
    body: JSON.stringify({ content, parentId }),
  })
}

export function updateComment(commentId: string, content: string) {
  return apiRequest<PublicComment>(`/comments/${commentId}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  })
}

export function deleteComment(commentId: string) {
  return apiRequest<{ deleted: boolean }>(`/comments/${commentId}`, {
    method: "DELETE",
  })
}

export function likeComment(commentId: string) {
  return apiRequest<{ liked: boolean }>(`/comments/${commentId}/like`, {
    method: "POST",
  })
}

export function unlikeComment(commentId: string) {
  return apiRequest<{ liked: boolean }>(`/comments/${commentId}/like`, {
    method: "DELETE",
  })
}

export function reportComment(commentId: string, reason: string, detail?: string) {
  return apiRequest<{ id: string }>(`/comments/${commentId}/reports`, {
    method: "POST",
    body: JSON.stringify({ reason, detail }),
  })
}
