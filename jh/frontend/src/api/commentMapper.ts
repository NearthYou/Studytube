export type BackendComment = {
  id: string
  postId: string
  content: string
  body?: string
  createdAt: string
  updatedAt: string | null
  author: {
    id: string
    nickname: string
    profileImageUrl: string | null
  }
  likeCount: number
  likedByMe: boolean
  isOwner: boolean
}

export type Comment = {
  id: string
  postId: string
  content: string
  body: string
  createdAt: string
  updatedAt: string | null
  author: {
    id: string
    nickname: string
    profileImageUrl: string | null
  }
  likeCount: number
  likedByMe: boolean
  isOwner: boolean
}

export function toComment(comment: BackendComment): Comment {
  return {
    ...comment,
    body: comment.body ?? comment.content,
  }
}
