import { describe, expect, it } from 'vitest'
import { commentPageSize, getCommentsPath } from './comments'

describe('comments api helpers', () => {
  it('builds paged comment list paths', () => {
    expect(getCommentsPath('42')).toBe(`/api/posts/42/comments?limit=${commentPageSize}&page=1`)
    expect(getCommentsPath('42', { limit: 10, page: 3 })).toBe('/api/posts/42/comments?limit=10&page=3')
  })
})
