import { useEffect, useState } from 'react'
import { fetchPetPlaceDetail } from '../api/petPlaces'
import type { PetPlaceDetail } from '../api/petPlaces'
import { getErrorMessage } from '../utils/error'
import { htmlToPlainText } from '../utils/text'

type UsePetPlaceDetailOptions = {
  onError?: (message: string) => void
}

export function usePetPlaceDetail(contentId: string, { onError }: UsePetPlaceDetailOptions = {}) {
  const [place, setPlace] = useState<PetPlaceDetail | null>(null)
  const [status, setStatus] = useState('불러오는 중입니다.')

  useEffect(() => {
    let isMounted = true

    fetchPetPlaceDetail(contentId)
      .then((response) => {
        if (!isMounted) return

        setPlace(response.place)
        setStatus('')
      })
      .catch((error) => {
        if (!isMounted) return

        setStatus('장소 정보를 찾을 수 없습니다.')
        onError?.(getErrorMessage(error, '장소 정보를 불러오지 못했습니다.'))
      })

    return () => {
      isMounted = false
    }
  }, [contentId, onError])

  const overviewText = place?.overview ? htmlToPlainText(place.overview) : ''

  return {
    overviewText,
    place,
    status,
  }
}
