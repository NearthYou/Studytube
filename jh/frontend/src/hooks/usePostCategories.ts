import { useEffect, useState } from 'react'
import { fetchCategories } from '../api/categories'
import { categories as staticCategories, writableCategories } from '../data/categories'
import type { Category } from '../types/category'
import type { Post } from '../types/post'

type UsePostCategoriesOptions = {
  onError?: (message: string) => void
}

const fallbackPostCategories = writableCategories.map((category) => ({
  ...category,
  id: undefined,
}))

export function usePostCategories(post?: Post, { onError }: UsePostCategoriesOptions = {}) {
  const [categories, setCategories] = useState<Category[]>(fallbackPostCategories)
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    post?.categoryInfo?.id ?? getCategoryOptionValue(fallbackPostCategories[0]),
  )
  const [categoryStatus, setCategoryStatus] = useState('')
  const selectedCategory = categories.find((category) => getCategoryOptionValue(category) === selectedCategoryId)
  const isCategoryReady = Boolean(selectedCategory?.id)
  const guideCategory =
    staticCategories.find((category) => category.value === (selectedCategory?.value ?? post?.category ?? 'daily')) ??
    writableCategories[0]
  const categoryOptions = categories.map((category) => ({
    key: getCategoryOptionValue(category),
    label: category.label,
    value: getCategoryOptionValue(category),
  }))

  useEffect(() => {
    let isMounted = true

    fetchCategories()
      .then((items) => {
        if (!isMounted) {
          return
        }

        const nextCategories = items.length ? items : fallbackPostCategories

        setCategories(nextCategories)
        setSelectedCategoryId((current) => resolveCategorySelection(current, nextCategories))
        setCategoryStatus('')
      })
      .catch(() => {
        if (isMounted) {
          setCategoryStatus('')
          onError?.('카테고리를 불러오지 못했습니다.')
        }
      })

    return () => {
      isMounted = false
    }
  }, [onError])

  return {
    categoryOptions,
    categoryStatus,
    guideCategory,
    isCategoryReady,
    selectedCategory,
    selectedCategoryId,
    setSelectedCategoryId,
  }
}

function getCategoryOptionValue(category: Category | undefined) {
  return category?.id ?? category?.value ?? ''
}

function resolveCategorySelection(currentSelection: string, nextCategories: Category[]) {
  if (!nextCategories.length) {
    return ''
  }

  const currentCategory = nextCategories.find((category) => getCategoryOptionValue(category) === currentSelection)

  if (currentCategory) {
    return getCategoryOptionValue(currentCategory)
  }

  const matchingCategory = nextCategories.find((category) => category.value === currentSelection)

  return getCategoryOptionValue(matchingCategory ?? nextCategories[0])
}
