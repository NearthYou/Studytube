import { useCallback, useEffect, useState } from 'react'
import { fetchNearbyPetPlaces } from '../api/petPlaces'
import type { PetPlace } from '../api/petPlaces'
import { getErrorMessage } from '../utils/error'
import { useKakaoPetPlaceMap } from './useKakaoPetPlaceMap'
import type { MapPoint } from './useKakaoPetPlaceMap'

export type PetPlaceResultState = 'idle' | 'loading' | 'success' | 'empty' | 'error'

const defaultPoint = {
  lat: 37.5665,
  lng: 126.978,
}

const defaultRadius = 3000

type UsePetPlacesOptions = {
  onError?: (message: string) => void
}

export function usePetPlaces({ onError }: UsePetPlacesOptions = {}) {
  const [contentTypeId, setContentTypeId] = useState('')
  const [radius, setRadius] = useState(defaultRadius)
  const [mapCenter, setMapCenter] = useState(defaultPoint)
  const [places, setPlaces] = useState<PetPlace[]>([])
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [isMapMoved, setIsMapMoved] = useState(false)
  const [status, setStatus] = useState('지도 주변 동반 장소를 불러오는 중입니다.')
  const [resultState, setResultState] = useState<PetPlaceResultState>('idle')
  const [isLoading, setIsLoading] = useState(false)

  const searchNearby = useCallback(
    async (point: MapPoint, nextRadius: number, nextContentTypeId: string) => {
      setIsLoading(true)
      setResultState('loading')
      setStatus('지도 주변 동반 장소를 불러오는 중입니다.')

      try {
        const response = await fetchNearbyPetPlaces(
          String(point.lat),
          String(point.lng),
          nextRadius,
          nextContentTypeId,
        )

        setPlaces(response.items)
        setSelectedPlaceId(null)
        setIsMapMoved(false)
        setResultState(response.items.length ? 'success' : 'empty')
        setStatus(
          response.items.length
            ? `현재 지도 주변 동반 장소 ${response.items.length.toLocaleString('ko-KR')}곳을 찾았습니다.`
            : '현재 지도 주변 검색 결과가 없습니다.',
        )
      } catch (error) {
        setPlaces([])
        setSelectedPlaceId(null)
        setResultState('error')
        setStatus('장소 정보를 불러오지 못했습니다.')
        onError?.(getErrorMessage(error, '장소 정보를 불러오지 못했습니다.'))
      } finally {
        setIsLoading(false)
      }
    },
    [onError],
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void searchNearby(defaultPoint, defaultRadius, '')
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [searchNearby])

  const handleMapCenterChange = useCallback((nextCenter: MapPoint) => {
    setMapCenter(nextCenter)
  }, [])

  const handleMapMoved = useCallback(() => {
    setIsMapMoved(true)
  }, [])

  const handlePlaceSelect = useCallback((contentId: string) => {
    setSelectedPlaceId(contentId)
  }, [])

  const { mapContainerRef, mapStatus } = useKakaoPetPlaceMap({
    defaultPoint,
    onCenterChange: handleMapCenterChange,
    onError,
    onMapMoved: handleMapMoved,
    onPlaceSelect: handlePlaceSelect,
    places,
    selectedPlaceId,
  })

  const handleContentTypeIdChange = (nextContentTypeId: string) => {
    setContentTypeId(nextContentTypeId)
    void searchNearby(mapCenter, radius, nextContentTypeId)
  }

  const handleRadiusChange = (nextRadius: number) => {
    setRadius(nextRadius)
    void searchNearby(mapCenter, nextRadius, contentTypeId)
  }

  const handleSearchCurrentArea = () => {
    void searchNearby(mapCenter, radius, contentTypeId)
  }

  return {
    contentTypeId,
    isLoading,
    isMapMoved,
    mapCenter,
    mapContainerRef,
    mapStatus,
    places,
    radius,
    resultState,
    selectedPlaceId,
    status,
    handlePlaceSelect,
    handleSearchCurrentArea,
    setContentTypeId: handleContentTypeIdChange,
    setRadius: handleRadiusChange,
  }
}
