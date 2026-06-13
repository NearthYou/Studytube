import { apiGet } from './client'
import { toPetPlace, toPetPlaceDetail } from './petPlaceMapper'
import type { BackendPetPlace, BackendPetPlaceDetail } from './petPlaceMapper'

export type { PetPlace, PetPlaceDetail } from './petPlaceMapper'

type PetPlaceListResponse = {
  items: BackendPetPlace[]
  page: number
  limit: number
  totalCount: number
  totalPages: number
  message: string
}

export async function searchPetPlaces(keyword: string, contentTypeId?: string) {
  const params = new URLSearchParams({ keyword })

  if (contentTypeId) params.set('contentTypeId', contentTypeId)

  const response = await apiGet<PetPlaceListResponse>(`/api/pet-places/search?${params.toString()}`)

  return {
    ...response,
    items: response.items.map(toPetPlace),
  }
}

export async function fetchNearbyPetPlaces(lat: string, lng: string, radius = 3000, contentTypeId?: string) {
  const params = new URLSearchParams({
    lat,
    lng,
    radius: String(radius),
  })

  if (contentTypeId) params.set('contentTypeId', contentTypeId)

  const response = await apiGet<PetPlaceListResponse>(`/api/pet-places/nearby?${params.toString()}`)

  return {
    ...response,
    items: response.items.map(toPetPlace),
  }
}

export async function fetchPetPlaceDetail(contentId: string) {
  const response = await apiGet<{ place: BackendPetPlaceDetail; message: string }>(`/api/pet-places/${contentId}`)

  return {
    ...response,
    place: toPetPlaceDetail(response.place),
  }
}
