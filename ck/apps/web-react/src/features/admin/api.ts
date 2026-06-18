import { apiRequest } from "../../shared/api"

export type ReviewReport = {
  id: string
  targetType: "SeatReview" | "Comment"
  targetId: string
  seatReviewId?: string
  commentId?: string
  reporterId: string
  reason: string
  detail: string | null
  status: string
  createdAt: string
}

export type AuditLog = {
  id: string
  actorId: string
  action: string
  targetType: string
  targetId: string
  metadata: unknown
  createdAt: string
}

export function getReports(status = "OPEN") {
  return apiRequest<ReviewReport[]>(`/admin/reports?status=${encodeURIComponent(status)}`)
}

export function getAuditLogs() {
  return apiRequest<AuditLog[]>("/admin/audit-logs")
}

export function hideReview(reviewId: string, reason: string) {
  return apiRequest<{ hidden: boolean }>(`/admin/seat-reviews/${reviewId}/hide`, {
    method: "PATCH",
    body: JSON.stringify({ reason }),
  })
}

export function restoreReview(reviewId: string) {
  return apiRequest<{ restored: boolean }>(`/admin/seat-reviews/${reviewId}/restore`, {
    method: "PATCH",
    body: JSON.stringify({}),
  })
}

export function forceDeleteReview(reviewId: string) {
  return apiRequest<{ deleted: boolean }>(`/admin/seat-reviews/${reviewId}/force`, {
    method: "DELETE",
  })
}

export function hideComment(commentId: string, reason: string) {
  return apiRequest<{ hidden: boolean }>(`/admin/comments/${commentId}/hide`, {
    method: "PATCH",
    body: JSON.stringify({ reason }),
  })
}

export function restoreComment(commentId: string) {
  return apiRequest<{ restored: boolean }>(`/admin/comments/${commentId}/restore`, {
    method: "PATCH",
    body: JSON.stringify({}),
  })
}

export function forceDeleteComment(commentId: string) {
  return apiRequest<{ deleted: boolean }>(`/admin/comments/${commentId}/force`, {
    method: "DELETE",
  })
}
