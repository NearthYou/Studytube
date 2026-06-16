import type { Comment, User } from '../types/community'
import type { Language } from './language'

export const PAGE_SIZE = 15

export const DEFAULT_POST_IMAGE_URL =
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80'
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:'])

export function countDiscussion(comments: Comment[]) {
  return comments.reduce((total, comment) => total + 1 + comment.replies.length, 0)
}

export function formatDate(date: string, language: Language = 'ko') {
  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
    month: 'long',
    day: 'numeric',
  }).format(new Date(date))
}

export function formatRelativeTime(date: string, language: Language = 'ko') {
  const parsed = new Date(date)
  const timestamp = parsed.getTime()

  if (Number.isNaN(timestamp)) {
    return date.split('T')[0] || date
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))

  if (language === 'ko') {
    if (diffSeconds < 60) {
      return '방금 전'
    }

    const diffMinutes = Math.floor(diffSeconds / 60)
    if (diffMinutes < 60) {
      return `${diffMinutes}분 전`
    }

    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) {
      return `${diffHours}시간 전`
    }

    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) {
      return `${diffDays}일 전`
    }

    const diffMonths = Math.floor(diffDays / 30)
    if (diffMonths < 12) {
      return `${diffMonths}개월 전`
    }

    return `${Math.floor(diffMonths / 12)}년 전`
  }

  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })

  if (diffSeconds < 60) {
    return rtf.format(-diffSeconds, 'second')
  }

  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) {
    return rtf.format(-diffMinutes, 'minute')
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return rtf.format(-diffHours, 'hour')
  }

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) {
    return rtf.format(-diffDays, 'day')
  }

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) {
    return rtf.format(-diffMonths, 'month')
  }

  return rtf.format(-Math.floor(diffMonths / 12), 'year')
}

function parseCalendarDate(date: string) {
  const dateOnlyMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    return new Date(Number(year), Number(month) - 1, Number(day))
  }

  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatCalendarDate(date: string, language: Language = 'ko') {
  const parsed = parseCalendarDate(date)

  if (!parsed) {
    return date.split('T')[0] || date
  }

  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(parsed)
}

export function toDateInputValue(date: string) {
  const parsed = parseCalendarDate(date)

  if (!parsed) {
    return date.split('T')[0] || date
  }

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function getPostImageUrl(imageUrl?: string | null) {
  const trimmed = imageUrl?.trim()

  if (!trimmed) {
    return DEFAULT_POST_IMAGE_URL
  }

  try {
    const url = new URL(trimmed)
    return SAFE_IMAGE_PROTOCOLS.has(url.protocol) ? trimmed : DEFAULT_POST_IMAGE_URL
  } catch {
    return DEFAULT_POST_IMAGE_URL
  }
}

export function getSummary(content: string) {
  if (content.length <= 96) {
    return content
  }

  return `${content.slice(0, 96)}...`
}

export function getUserLabel(users: User[], userId: number, language: Language = 'ko') {
  return users.find((user) => user.id === userId)?.nickname ?? (language === 'ko' ? '알 수 없음' : 'Unknown')
}
