import { Search } from 'lucide-react'
import type { RefObject } from 'react'

type PetPlacePoint = {
  lat: number
  lng: number
}

type PetPlaceMapPickerProps = {
  isLoading: boolean
  isMapMoved: boolean
  mapCenter: PetPlacePoint
  mapContainerRef: RefObject<HTMLDivElement | null>
  mapStatus: string
  onSearchCurrentArea: () => void
  placesCount: number
}

export function PetPlaceMapPicker({
  isLoading,
  isMapMoved,
  mapCenter,
  mapContainerRef,
  mapStatus,
  onSearchCurrentArea,
  placesCount,
}: PetPlaceMapPickerProps) {
  return (
    <div className="pet-place-map-shell">
      <div className="pet-place-map-frame">
        <div className="pet-place-map" ref={mapContainerRef} aria-label="반려동물 동반 장소 지도" />
        {isMapMoved && !mapStatus && (
          <div className="pet-place-map-actions">
            <button className="ui-button ui-button--primary pet-place-map-search-button" type="button" onClick={onSearchCurrentArea} disabled={isLoading}>
              <Search size={16} aria-hidden="true" />
              <span>{isLoading ? '검색 중' : '이 지역에서 검색'}</span>
            </button>
          </div>
        )}
        {mapStatus && (
          <div className="pet-place-map-message" role="status">
            <strong>{mapStatus}</strong>
            <span>지도 없이도 기본 위치 기준 장소 목록은 확인할 수 있어요.</span>
          </div>
        )}
      </div>
      <div className="pet-place-map-footer">
        <span>지도 중심</span>
        <strong>
          위도 {mapCenter.lat.toFixed(5)} · 경도 {mapCenter.lng.toFixed(5)}
        </strong>
        <em>{placesCount.toLocaleString('ko-KR')}곳 표시 중</em>
      </div>
    </div>
  )
}
