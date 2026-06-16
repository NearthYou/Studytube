import { PetPlaceMapPicker } from '../components/board/PetPlaceMapPicker'
import { PetPlaceResults } from '../components/board/PetPlaceResults'
import { PetPlaceSearchForm } from '../components/board/PetPlaceSearchForm'
import { FeedbackModal } from '../components/common/FeedbackModal'
import { AppLayout } from '../components/layout/AppLayout'
import { useFeedbackModal } from '../hooks/useFeedbackModal'
import { usePetPlaces } from '../hooks/usePetPlaces'

export function PetPlacesPage() {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const {
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
    setContentTypeId,
    setRadius,
  } = usePetPlaces({ onError: openErrorModal })

  return (
    <AppLayout variant="board" mainClassName="board-main">
      <section className="board-panel pet-place-panel" aria-labelledby="pet-place-title">
        <div className="board-panel-heading">
          <p className="feed-kicker">반려동물 동반 장소</p>
          <h1 id="pet-place-title">같이 갈 수 있는 곳 찾기</h1>
        </div>

        <PetPlaceMapPicker
          isLoading={isLoading}
          isMapMoved={isMapMoved}
          mapCenter={mapCenter}
          mapContainerRef={mapContainerRef}
          mapStatus={mapStatus}
          placesCount={places.length}
          onSearchCurrentArea={handleSearchCurrentArea}
        />

        <PetPlaceSearchForm
          contentTypeId={contentTypeId}
          isLoading={isLoading}
          onChangeContentTypeId={setContentTypeId}
          onChangeRadius={setRadius}
          radius={radius}
        />

        <PetPlaceResults
          places={places}
          resultState={resultState}
          selectedPlaceId={selectedPlaceId}
          status={status}
          onSelectPlace={handlePlaceSelect}
        />
      </section>
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </AppLayout>
  )
}
