import { ArrowLeft, MapPin, MessageSquarePlus, Phone, Share2 } from 'lucide-react'
import type { PetPlaceDetail } from '../../api/petPlaces'
import { appPaths, getCategoryPath } from '../../utils/paths'
import { SafeImage } from '../common/SafeImage'
import { PetPlaceInfoGrid } from './PetPlaceInfoGrid'

type PetPlaceDetailArticleProps = {
  overviewText: string
  place: PetPlaceDetail
}

export function PetPlaceDetailArticle({ overviewText, place }: PetPlaceDetailArticleProps) {
  const heroImage = place.images[0]?.originUrl || place.firstImage

  return (
    <article className="board-panel pet-place-detail" aria-labelledby="pet-place-detail-title">
      <a className="back-link" href={appPaths.petPlaces}>
        <ArrowLeft size={16} aria-hidden="true" />
        <span>장소 목록</span>
      </a>
      <div className="pet-place-detail-hero">
        {heroImage ? <SafeImage src={heroImage} alt="" fallbackAlt="Tail Talk 기본 장소 이미지" /> : <span>Tail Talk</span>}
      </div>
      <div className="pet-place-detail-body">
        <p className="feed-kicker">동반 장소 상세</p>
        <h1 id="pet-place-detail-title">{place.title}</h1>
        <div className="detail-meta">
          {place.address && (
            <span>
              <MapPin size={15} aria-hidden="true" />
              {place.address}
            </span>
          )}
          {place.tel && (
            <span>
              <Phone size={15} aria-hidden="true" />
              {place.tel}
            </span>
          )}
        </div>
        {overviewText && <p className="detail-body detail-body--plain">{overviewText}</p>}

        <div className="pet-place-cta-row" aria-label="장소 커뮤니티 액션">
          <a className="ui-button ui-button--primary" href={`${appPaths.postCreate}?place=${encodeURIComponent(place.title)}`}>
            <MessageSquarePlus size={16} aria-hidden="true" />
            <span>이 장소 산책 후기 쓰기</span>
          </a>
          <a className="ui-button ui-button--ghost" href={getCategoryPath('walk')}>
            <MapPin size={16} aria-hidden="true" />
            <span>관련 산책 글 보기</span>
          </a>
          <button
            className="ui-button ui-button--subtle"
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href)
            }}
          >
            <Share2 size={16} aria-hidden="true" />
            <span>장소 공유</span>
          </button>
        </div>

        <PetPlaceInfoGrid petInfo={place.petInfo} />
      </div>
    </article>
  )
}
