import type { LookupOption } from '../types/community'
import { API_BASE_URL } from './env'

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
