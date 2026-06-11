import type { LookupOption } from '../types/community'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'

export type PostFilterLookups = {
  regions: LookupOption[]
  themes: LookupOption[]
  budgetRanges: LookupOption[]
  seasons: LookupOption[]
  companions: LookupOption[]
}

export async function fetchPostFilters() {
  const response = await fetch(`${API_BASE_URL}/lookups/post-filters`)
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      (data &&
        typeof data === 'object' &&
        'message' in data &&
        typeof data.message === 'string' &&
        data.message) ||
      '필터 옵션을 불러오지 못했습니다.'

    throw new Error(message)
  }

  return data as PostFilterLookups
}
