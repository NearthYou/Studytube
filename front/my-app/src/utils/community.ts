import type { Comment, User } from '../types/community'

export const PAGE_SIZE = 15

export function countDiscussion(comments: Comment[]) {
  return comments.reduce((total, comment) => total + 1 + comment.replies.length, 0)
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
  }).format(new Date(date))
}

export function getSummary(content: string) {
  if (content.length <= 96) {
    return content
  }

  return `${content.slice(0, 96)}...`
}

export function getUserLabel(users: User[], userId: number) {
  return users.find((user) => user.id === userId)?.nickname ?? '알 수 없음'
}
