import { getActiveCategory } from '../data/categories'
import type { Category } from '../types/category'
import { appPaths } from './paths'

export const feedPageSize = 8

export function getFeedQuery(search = window.location.search) {
  const searchParams = new URLSearchParams(search)
  const categoryValue = searchParams.get('category')

  return {
    categoryId: searchParams.get('categoryId'),
    categoryValue,
    currentPage: parseFeedPage(searchParams.get('page')),
    fallbackCategory: getActiveCategory(categoryValue),
    keyword: searchParams.get('q')?.trim() ?? '',
    sort: parseFeedSort(searchParams.get('sort')),
    tag: searchParams.get('tag')?.trim() ?? '',
  }
}

export function getFeedTitle(keyword: string, tag: string, activeCategory: Category) {
  if (keyword) {
    return `"${keyword}" 검색 결과`
  }

  if (tag) {
    return `#${tag} 게시글`
  }

  return activeCategory.value === 'all' ? activeCategory.label : `${activeCategory.label} 꼬리톡`
}

export function getFeedHeaderCopy(keyword: string, tag: string, activeCategory: Category) {
  if (keyword) {
    return {
      description: '검색어와 관련된 반려동물 이야기를 모았어요.',
      prompt: '원하는 글이 없다면 직접 질문이나 경험을 남겨보세요.',
      trustHint: '검색 결과는 최신 데이터 기준으로 표시됩니다.',
    }
  }

  if (tag) {
    return {
      description: `#${tag} 태그가 붙은 게시글을 모았어요.`,
      prompt: '같은 태그로 경험을 이어가거나 새 이야기를 남겨보세요.',
      trustHint: '태그는 작성자가 직접 입력한 커뮤니티 단서입니다.',
    }
  }

  return {
    description: activeCategory.description,
    prompt: activeCategory.prompt,
    trustHint: activeCategory.trustHint,
  }
}

export function getFeedPageHref(page: number, search = window.location.search) {
  const nextParams = new URLSearchParams(search)

  if (page <= 1) {
    nextParams.delete('page')
  } else {
    nextParams.set('page', String(page))
  }

  const queryString = nextParams.toString()

  return queryString ? `${appPaths.home}?${queryString}` : appPaths.home
}

export function getFeedSortHref(sort: 'latest' | 'popular' | 'views', search = window.location.search) {
  const nextParams = new URLSearchParams(search)

  nextParams.delete('page')

  if (sort === 'latest') {
    nextParams.delete('sort')
  } else {
    nextParams.set('sort', sort)
  }

  const queryString = nextParams.toString()

  return queryString ? `${appPaths.home}?${queryString}` : appPaths.home
}

function parseFeedPage(value: string | null) {
  const page = Number(value)

  return Number.isInteger(page) && page > 0 ? page : 1
}

function parseFeedSort(value: string | null): 'latest' | 'popular' | 'views' {
  return value === 'popular' || value === 'views' ? value : 'latest'
}
