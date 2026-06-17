export type KakaoLatLng = {
  getLat(): number
  getLng(): number
}

export type KakaoMap = {
  getCenter(): KakaoLatLng
  setCenter(position: KakaoLatLng): void
}

export type KakaoMarker = {
  setMap(map: KakaoMap | null): void
  setPosition(position: KakaoLatLng): void
}

export type KakaoNamespace = {
  maps: {
    load(callback: () => void): void
    LatLng: new (lat: number, lng: number) => KakaoLatLng
    Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap
    Marker: new (options: { map: KakaoMap; position: KakaoLatLng }) => KakaoMarker
    event: {
      addListener(target: unknown, type: string, handler: (event: { latLng: KakaoLatLng }) => void): void
    }
  }
}

declare global {
  interface Window {
    kakao?: KakaoNamespace
  }
}

export function loadKakaoMaps(appKey: string) {
  if (window.kakao?.maps) {
    return Promise.resolve(window.kakao)
  }

  return new Promise<KakaoNamespace>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-kakao-map-sdk]')

    if (existingScript) {
      existingScript.remove()
    }

    const script = document.createElement('script')
    const timeoutId = window.setTimeout(() => {
      script.remove()
      reject(new Error('카카오 지도 SDK 응답 시간이 초과되었습니다.'))
    }, 8000)

    script.dataset.kakaoMapSdk = 'true'
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(
      appKey,
    )}&autoload=false&cache=${Date.now()}`
    script.async = true
    script.onload = () => {
      window.clearTimeout(timeoutId)

      if (!window.kakao?.maps) {
        reject(new Error('카카오 지도 SDK를 초기화하지 못했습니다.'))
        return
      }

      window.kakao.maps.load(() => resolve(window.kakao as KakaoNamespace))
    }
    script.onerror = () => {
      window.clearTimeout(timeoutId)
      script.remove()
      reject(new Error('카카오 지도 SDK를 불러오지 못했습니다.'))
    }
    document.head.appendChild(script)
  })
}
