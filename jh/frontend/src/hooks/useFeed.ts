import { useEffect, useState } from 'react'
import { fetchCategories } from '../api/categories'
import { fetchPosts, searchPosts } from '../api/posts'
import type { Category } from '../types/category'
import type { Post } from '../types/post'
import { getErrorMessage } from '../utils/error'
import {
  feedPageSize,
  getFeedHeaderCopy,
  getFeedPageHref,
  getFeedQuery,
  getFeedSortHref,
  getFeedTitle,
} from '../utils/feedQuery'

type UseFeedOptions = {
  onError?: (message: string) => void
}

export function useFeed({ onError }: UseFeedOptions = {}) {
  const { categoryId, currentPage, fallbackCategory, keyword, sort, tag } = getFeedQuery()
  const [posts, setPosts] = useState<Post[]>([])
  const [apiCategories, setApiCategories] = useState<Category[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [status, setStatus] = useState('불러오는 중입니다.')
  const activeCategory = categoryId
    ? apiCategories.find((category) => category.id === categoryId) ?? fallbackCategory
    : fallbackCategory
  const feedHeaderCopy = getFeedHeaderCopy(keyword, tag, activeCategory)
  const feedTitle = getFeedTitle(keyword, tag, activeCategory)

  useEffect(() => {
    let isMounted = true

    async function loadFeed() {
      setStatus('불러오는 중입니다.')

      try {
        const categories = await fetchCategories()
        const selectedCategory = categoryId
          ? categories.find((category) => category.id === categoryId)
          : categories.find((category) => category.value === fallbackCategory.value)
        const selectedCategoryId =
          categoryId ?? (fallbackCategory.value === 'all' ? undefined : selectedCategory?.id)
        const response = keyword
          ? await searchPosts({
              keyword,
              categoryId: selectedCategoryId,
              limit: feedPageSize,
              page: currentPage,
              sort,
              tag,
            })
          : await fetchPosts({
              categoryId: selectedCategoryId,
              limit: feedPageSize,
              page: currentPage,
              sort,
              tag,
            })

        if (!isMounted) {
          return
        }

        setApiCategories(categories)
        setPosts(response.items)
        setTotalCount(response.totalCount)
        setPageCount(Math.max(1, response.totalPages))
        setStatus('')
      } catch (error) {
        if (!isMounted) {
          return
        }

        setStatus('')
        onError?.(getErrorMessage(error, '게시글을 불러오지 못했습니다.'))
      }
    }

    void loadFeed()

    return () => {
      isMounted = false
    }
  }, [categoryId, currentPage, fallbackCategory.value, keyword, onError, sort, tag])

  return {
    currentPage,
    feedTitle,
    feedHeaderCopy,
    getPageHref: getFeedPageHref,
    getSortHref: getFeedSortHref,
    pageCount,
    posts,
    sort,
    status,
    totalCount,
  }
}
