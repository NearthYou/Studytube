import { apiGet } from './client'
import { writableCategories } from '../data/categories'
import type { Category, WritableCategoryValue } from '../types/category'

type WritableCategory = Category & { value: WritableCategoryValue }

type CategoryResponse = {
  categories: WritableCategory[]
  message: string
}

let categoriesRequest: Promise<WritableCategory[]> | null = null

export async function fetchCategories() {
  categoriesRequest ??= loadCategories().catch((error) => {
    categoriesRequest = null
    throw error
  })

  return categoriesRequest
}

async function loadCategories() {
  const response = await apiGet<CategoryResponse>('/api/categories')

  return response.categories.map(normalizeCategory)
}

function normalizeCategory(category: WritableCategory): WritableCategory {
  const localCategory = writableCategories.find((item) => item.value === category.value)

  if (!localCategory) {
    return category
  }

  return {
    ...category,
    label: localCategory.label,
    mobileLabel: localCategory.mobileLabel,
    description: localCategory.description,
    prompt: localCategory.prompt,
    trustHint: localCategory.trustHint,
  }
}
