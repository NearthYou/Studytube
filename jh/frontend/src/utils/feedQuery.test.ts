import { describe, expect, it } from 'vitest'
import {
  feedPageSize,
  getFeedHeaderCopy,
  getFeedPageHref,
  getFeedQuery,
  getFeedSortHref,
  getFeedTitle,
} from './feedQuery'
import { categories } from '../data/categories'

describe('feedQuery', () => {
  it('parses category, pagination, search, tag and sort', () => {
    const query = getFeedQuery('?category=daily&page=2&q=%EA%B0%95%EC%95%84%EC%A7%80&tag=cute&sort=views')

    expect(query.categoryValue).toBe('daily')
    expect(query.currentPage).toBe(2)
    expect(query.keyword).toBe('강아지')
    expect(query.tag).toBe('cute')
    expect(query.sort).toBe('views')
    expect(feedPageSize).toBe(8)
  })

  it('normalizes invalid page and sort values', () => {
    const query = getFeedQuery('?page=-1&sort=oldest')

    expect(query.currentPage).toBe(1)
    expect(query.sort).toBe('latest')
  })

  it('builds page and sort links while preserving filters', () => {
    expect(getFeedPageHref(3, '?category=walk&q=park')).toBe('/?category=walk&q=park&page=3')
    expect(getFeedPageHref(1, '?category=walk&page=3')).toBe('/?category=walk')
    expect(getFeedSortHref('popular', '?category=walk&page=3')).toBe('/?category=walk&sort=popular')
    expect(getFeedSortHref('latest', '?category=walk&sort=views')).toBe('/?category=walk')
  })

  it('creates readable feed titles', () => {
    expect(getFeedTitle('사료', '', categories[0])).toBe('"사료" 검색 결과')
    expect(getFeedTitle('', '산책', categories[0])).toBe('#산책 게시글')
    expect(getFeedTitle('', '', categories[1])).toBe('일상 꼬리톡')
  })

  it('creates context-aware header copy', () => {
    expect(getFeedHeaderCopy('사료', '', categories[0]).description).toContain('검색어')
    expect(getFeedHeaderCopy('', '산책', categories[0]).description).toContain('#산책')
    expect(getFeedHeaderCopy('', '', categories[1]).description).toBe(categories[1].description)
  })
})
