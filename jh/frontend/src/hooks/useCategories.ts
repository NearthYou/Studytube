import { useEffect, useState } from 'react'
import { fetchCategories } from '../api/categories'
import { categories as staticCategories } from '../data/categories'
import type { Category } from '../types/category'

type UseCategoriesOptions = {
  enabled?: boolean
  includeHome?: boolean
}

export function useCategories({ enabled = true, includeHome = false }: UseCategoriesOptions = {}) {
  const [categories, setCategories] = useState<Category[]>(() => getFallbackCategories(includeHome))
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!enabled) {
      return
    }

    const fallbackCategories = getFallbackCategories(includeHome)

    let isMounted = true

    fetchCategories()
      .then((items) => {
        if (!isMounted) return

        setCategories(includeHome ? [staticCategories[0], ...items] : items)
        setStatus('')
      })
      .catch(() => {
        if (!isMounted) return

        setCategories(fallbackCategories)
        setStatus('카테고리를 불러오지 못했습니다.')
      })

    return () => {
      isMounted = false
    }
  }, [enabled, includeHome])

  return {
    categories,
    status,
  }
}

function getFallbackCategories(includeHome: boolean) {
  return includeHome ? staticCategories : []
}
