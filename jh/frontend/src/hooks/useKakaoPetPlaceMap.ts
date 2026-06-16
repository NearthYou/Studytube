import { useCallback, useEffect, useRef, useState } from 'react'
import type { PetPlace } from '../api/petPlaces'
import { getErrorMessage } from '../utils/error'
import type { KakaoMap, KakaoMarker, KakaoNamespace } from '../utils/kakaoMap'
import { loadKakaoMaps } from '../utils/kakaoMap'

export type MapPoint = {
  lat: number
  lng: number
}

type UseKakaoPetPlaceMapOptions = {
  defaultPoint: MapPoint
  onCenterChange: (point: MapPoint) => void
  onError?: (message: string) => void
  onMapMoved: () => void
  onPlaceSelect: (contentId: string) => void
  places: PetPlace[]
  selectedPlaceId: string | null
}

const kakaoMapKey = import.meta.env.VITE_KAKAO_MAP_JS_KEY as string | undefined

export function useKakaoPetPlaceMap({
  defaultPoint,
  onCenterChange,
  onError,
  onMapMoved,
  onPlaceSelect,
  places,
  selectedPlaceId,
}: UseKakaoPetPlaceMapOptions) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const kakaoRef = useRef<KakaoNamespace | null>(null)
  const mapRef = useRef<KakaoMap | null>(null)
  const markersRef = useRef<KakaoMarker[]>([])
  const [isMapReady, setIsMapReady] = useState(false)
  const [mapStatus, setMapStatus] = useState(
    kakaoMapKey ? '지도를 준비하는 중입니다.' : '지도를 불러오지 못해 기본 위치 기준으로 장소를 보여줍니다.',
  )

  const handleMapMoved = useCallback(
    (map: KakaoMap) => {
      const center = map.getCenter()

      onCenterChange({
        lat: center.getLat(),
        lng: center.getLng(),
      })
      onMapMoved()
    },
    [onCenterChange, onMapMoved],
  )

  useEffect(() => {
    if (!mapContainerRef.current || !kakaoMapKey) {
      if (!kakaoMapKey) {
        onError?.('지도를 불러오지 못했습니다. 기본 위치 기준 장소 목록을 확인해주세요.')
      }

      return undefined
    }

    let isMounted = true

    loadKakaoMaps(kakaoMapKey)
      .then((kakao) => {
        if (!isMounted || !mapContainerRef.current) return

        const center = new kakao.maps.LatLng(defaultPoint.lat, defaultPoint.lng)
        const map = new kakao.maps.Map(mapContainerRef.current, {
          center,
          level: 5,
        })

        kakaoRef.current = kakao
        mapRef.current = map
        setIsMapReady(true)
        setMapStatus('')

        kakao.maps.event.addListener(map, 'dragend', () => handleMapMoved(map))
        kakao.maps.event.addListener(map, 'zoom_changed', () => handleMapMoved(map))
      })
      .catch((error) => {
        if (isMounted) {
          setMapStatus('지도를 불러오지 못해 기본 위치 기준으로 장소를 보여줍니다.')
          onError?.(getErrorMessage(error, '카카오 지도를 불러오지 못했습니다.'))
        }
      })

    return () => {
      isMounted = false
      markersRef.current.forEach((marker) => marker.setMap(null))
      markersRef.current = []
      mapRef.current = null
      kakaoRef.current = null
      setIsMapReady(false)
    }
  }, [defaultPoint.lat, defaultPoint.lng, handleMapMoved, onError])

  useEffect(() => {
    const kakao = kakaoRef.current
    const map = mapRef.current

    if (!isMapReady || !kakao || !map) {
      return
    }

    markersRef.current.forEach((marker) => marker.setMap(null))
    markersRef.current = []

    places.forEach((place) => {
      const lat = Number(place.mapY)
      const lng = Number(place.mapX)

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return
      }

      const position = new kakao.maps.LatLng(lat, lng)
      const marker = new kakao.maps.Marker({
        map,
        position,
      })

      kakao.maps.event.addListener(marker, 'click', () => {
        map.setCenter(position)
        onPlaceSelect(place.contentId)
      })

      markersRef.current.push(marker)
    })
  }, [isMapReady, onPlaceSelect, places])

  useEffect(() => {
    if (!selectedPlaceId) {
      return
    }

    const kakao = kakaoRef.current
    const map = mapRef.current
    const selectedPlace = places.find((place) => place.contentId === selectedPlaceId)

    if (!kakao || !map || !selectedPlace) {
      return
    }

    const lat = Number(selectedPlace.mapY)
    const lng = Number(selectedPlace.mapX)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return
    }

    map.setCenter(new kakao.maps.LatLng(lat, lng))
  }, [places, selectedPlaceId])

  return {
    mapContainerRef,
    mapStatus,
  }
}
