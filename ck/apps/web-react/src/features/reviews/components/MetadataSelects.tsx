import type { PerformanceOption, ReviewWorkOption, TheaterOption } from "../types"

type MetadataSelectsProps = {
  theaters: TheaterOption[]
  workOptions: ReviewWorkOption[]
  selectedTheaterId: string
  selectedPerformanceId: string
  selectedPerformance: PerformanceOption | null
  workSearchText: string
  isLoadingPerformances: boolean
  onChangeTheaterId: (value: string) => void
  onChangePerformanceId: (value: string) => void
  onChangeWorkSearchText: (value: string) => void
}

function getPerformanceDisplayTitle(performance: PerformanceOption) {
  return (
    performance.displayTitle ??
    [performance.seasonLabel, performance.musicalTitle].filter(Boolean).join(" ")
  )
}

export default function MetadataSelects({
  theaters,
  workOptions,
  selectedTheaterId,
  selectedPerformanceId,
  selectedPerformance,
  workSearchText,
  isLoadingPerformances,
  onChangeTheaterId,
  onChangePerformanceId,
  onChangeWorkSearchText,
}: MetadataSelectsProps) {
  const normalizedSearchText = workSearchText.trim().toLowerCase()
  const filteredWorkOptions = normalizedSearchText
    ? workOptions.filter((work) => work.searchText.includes(normalizedSearchText))
    : workOptions

  return (
    <section>
      <label>
        공연장
        <select value={selectedTheaterId} onChange={(event) => onChangeTheaterId(event.target.value)}>
          <option value="">공연장을 선택하세요</option>
          {theaters.map((theater) => (
            <option key={theater.id} value={theater.id}>
              {theater.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        작품 검색
        <input
          value={workSearchText}
          disabled={!selectedTheaterId || isLoadingPerformances}
          onChange={(event) => onChangeWorkSearchText(event.target.value)}
          placeholder="베어더뮤지컬"
        />
      </label>

      <label>
        작품
        <select
          value={selectedPerformanceId}
          disabled={!selectedTheaterId || isLoadingPerformances || filteredWorkOptions.length === 0}
          onChange={(event) => onChangePerformanceId(event.target.value)}
        >
          <option value="">{selectedTheaterId ? "작품을 선택하세요" : "공연장을 먼저 선택하세요"}</option>
          {filteredWorkOptions.map((work) => (
            <option key={work.performanceId} value={work.performanceId}>
              {work.displayTitle}
            </option>
          ))}
        </select>
      </label>

      <div>
        <strong>공연 조합</strong>
        {selectedPerformance ? (
          <p>
            {selectedPerformance.theaterName} / {getPerformanceDisplayTitle(selectedPerformance)}
          </p>
        ) : (
          <p>공연장과 작품을 선택하면 자동으로 정해집니다.</p>
        )}
      </div>

      {isLoadingPerformances ? <p>공연 목록을 불러오는 중입니다.</p> : null}
    </section>
  )
}
