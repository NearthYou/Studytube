import { PetPlaceDetailArticle } from '../components/board/PetPlaceDetailArticle'
import { FeedbackModal } from '../components/common/FeedbackModal'
import { AppLayout } from '../components/layout/AppLayout'
import { useFeedbackModal } from '../hooks/useFeedbackModal'
import { usePetPlaceDetail } from '../hooks/usePetPlaceDetail'
import { appPaths } from '../utils/paths'

type PetPlaceDetailPageProps = {
  contentId: string
}

export function PetPlaceDetailPage({ contentId }: PetPlaceDetailPageProps) {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const { overviewText, place, status } = usePetPlaceDetail(contentId, { onError: openErrorModal })

  return (
    <AppLayout variant="board" mainClassName="board-main">
      {place ? (
        <PetPlaceDetailArticle overviewText={overviewText} place={place} />
      ) : (
        <section className="board-panel empty-board-panel">
          <h1>{status}</h1>
          <a className="ghost-action-button" href={appPaths.petPlaces}>
            장소 목록으로 돌아가기
          </a>
        </section>
      )}
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </AppLayout>
  )
}
