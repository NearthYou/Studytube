import { MapPin } from 'lucide-react'
import { useEffect } from 'react'
import type { PetPlace } from '../../api/petPlaces'
import { appPaths } from '../../utils/paths'
import { SafeImage } from '../common/SafeImage'

type PetPlaceResultsProps = {
  onSelectPlace: (contentId: string) => void
  places: PetPlace[]
  resultState: 'idle' | 'loading' | 'success' | 'empty' | 'error'
  selectedPlaceId: string | null
  status: string
}

const resultStateCopy = {
  idle: {
    title: '지도를 준비하고 있어요.',
    body: '기본 위치 주변 동반 장소를 불러오고 있습니다.',
  },
  loading: {
    title: '지도 주변 장소를 찾고 있어요.',
    body: '조건에 맞는 반려동물 동반 장소를 확인하는 중입니다.',
  },
  empty: {
    title: '검색 결과가 없습니다.',
    body: '지도를 조금 이동하거나 반경을 넓혀 다시 검색해보세요.',
  },
  error: {
    title: '장소 정보를 불러오지 못했습니다.',
    body: '잠시 후 다시 시도하거나 좌표와 검색 조건을 확인해 주세요.',
  },
  success: {
    title: '',
    body: '',
  },
} as const

export function PetPlaceResults({ onSelectPlace, places, resultState, selectedPlaceId, status }: PetPlaceResultsProps) {
  useEffect(() => {
    if (!selectedPlaceId) {
      return
    }

    document.getElementById(`pet-place-card-${selectedPlaceId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [selectedPlaceId])

  if (places.length === 0) {
    const copy = resultState === 'success' ? resultStateCopy.idle : resultStateCopy[resultState]

    return (
      <div className={`pet-place-result-state pet-place-result-state--${resultState}`} role="status">
        <strong>{copy.title}</strong>
        <p>{status || copy.body}</p>
      </div>
    )
  }

  return (
    <>
      <p className="pet-place-result-summary" role="status">
        {status}
      </p>
      <div className="pet-place-grid">
        {places.map((place) => (
          <a
            className={place.contentId === selectedPlaceId ? 'pet-place-card is-selected' : 'pet-place-card'}
            href={appPaths.petPlaceDetail(place.contentId)}
            id={`pet-place-card-${place.contentId}`}
            key={place.contentId}
            aria-current={place.contentId === selectedPlaceId ? 'true' : undefined}
            onFocus={() => onSelectPlace(place.contentId)}
          >
            <div className="pet-place-image">
              {place.firstImage ? (
                <SafeImage src={place.firstImage} alt="" fallbackAlt="Tail Talk 기본 장소 이미지" />
              ) : (
                <span>Tail Talk</span>
              )}
            </div>
            <div>
              <strong>{place.title}</strong>
              <p>{place.address || '주소 정보 없음'}</p>
              {place.tel && <span>{place.tel}</span>}
              {place.distance && (
                <em>
                  <MapPin size={13} aria-hidden="true" />
                  {Number(place.distance).toLocaleString('ko-KR')}m
                </em>
              )}
            </div>
          </a>
        ))}
      </div>
    </>
  )
}
