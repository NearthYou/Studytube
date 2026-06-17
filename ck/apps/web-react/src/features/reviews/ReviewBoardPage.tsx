import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { getCurrentUser, logout } from "../auth/api"
import SeatAssistantPanel from "../agent/components/SeatAssistantPanel"
import { getTags } from "../tags/api"
import ReportReviewDialog from "./components/ReportReviewDialog"
import ReviewDetailModal from "./components/ReviewDetailModal"
import ReviewResultsPanel from "./components/ReviewResultsPanel"
import { deleteSeatReview, getTheaters, reportSeatReview } from "./api"
import { useSeatReviews } from "./hooks/useSeatReviews"
import {
  canOpenTheaterReviewPage,
  getReviewBoardTheaterFilters,
  getReviewBoardDisplayReviews,
  getReviewTags,
  getSortedUniqueSeatValues,
  type ReviewBoardFilter,
} from "./review-board-filters"
import {
  buildSeatReviewSearchQuery,
  type ReviewBoardSortKey,
} from "./review-search-query"
import type { PublicUser } from "../auth/types"
import type { TagOption } from "../tags/types"
import type { PublicSeatReview, SeatReviewSearchParams, TheaterOption } from "./types"
import "./styles/review-board-page.css"

type FilterMode = "theater" | "work" | "tag"
type ViewMode = "board" | "seatMap"
type SortKey = ReviewBoardSortKey

type SeatFilter = {
  floor: string
  section: string
  row: string
  number: string
}

const sortLabels: Record<SortKey, string> = {
  latest: "최신 후기",
  oldest: "오래된 후기",
  popular: "댓글 많은순",
  rating: "평점 높은순",
  viewHigh: "시야 좋은순",
  soundHigh: "음향 좋은순",
  comfortHigh: "좌석 편한순",
  expressionHigh: "표정 잘 보이는순",
  stageVisibilityHigh: "무대 전체 잘 보이는순",
}

const sortGroups: Array<{ label: string; keys: SortKey[] }> = [
  { label: "기본", keys: ["latest", "oldest", "popular", "rating"] },
  { label: "시야", keys: ["viewHigh", "stageVisibilityHigh"] },
  { label: "관람감", keys: ["soundHigh", "comfortHigh"] },
  { label: "배우", keys: ["expressionHigh"] },
]

const reviewPageLimit = 12

const initialSeatFilter: SeatFilter = {
  floor: "",
  section: "",
  row: "",
  number: "",
}

const filterResultLabels: Record<FilterMode, string> = {
  theater: "극장 검색 결과",
  work: "작품 검색 결과",
  tag: "태그 검색 결과",
}

function getWorkLabel(review: PublicSeatReview) {
  return [review.performance?.seasonLabel, review.musical.title].filter(Boolean).join(" ")
}

function makeUniqueFilters(
  reviews: PublicSeatReview[],
  theaters: TheaterOption[],
  mode: FilterMode,
  query: string,
) {
  if (mode === "theater") {
    return getReviewBoardTheaterFilters({ reviews, theaters, query })
  }

  const normalizedQuery = query.trim().toLowerCase()
  const options = new Map<string, ReviewBoardFilter>()

  reviews.forEach((review) => {
    if (mode === "tag") {
      getReviewTags(review).forEach((tag) => {
        if (normalizedQuery && !tag.name.toLowerCase().includes(normalizedQuery)) {
          return
        }

        options.set(`tag:${tag.id}`, {
          id: tag.id,
          label: tag.name,
          mode,
        })
      })
      return
    }

    const id = review.performance?.id
    const rawLabel = getWorkLabel(review)
    const label = rawLabel

    if (!id || !rawLabel || !label) {
      return
    }

    if (
      normalizedQuery &&
      !label.toLowerCase().includes(normalizedQuery) &&
      !rawLabel.toLowerCase().includes(normalizedQuery)
    ) {
      return
    }

    const key = `${mode}:${label}`
    const existing = options.get(key)

    options.set(key, {
      id: existing?.id ?? id,
      label,
      mode,
      aliases: Array.from(new Set([...(existing?.aliases ?? []), rawLabel, label])),
    })
  })

  return Array.from(options.values())
}

export default function ReviewBoardPage() {
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null)
  const [searchText, setSearchText] = useState("")
  const [activeFilterMode, setActiveFilterMode] = useState<FilterMode | null>(null)
  const [filterMode, setFilterMode] = useState<FilterMode>("theater")
  const [filterSearchText, setFilterSearchText] = useState("")
  const [selectedFilter, setSelectedFilter] = useState<ReviewBoardFilter | null>(null)
  const [theaters, setTheaters] = useState<TheaterOption[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false)
  const [isLoadingTags, setIsLoadingTags] = useState(false)
  const [tagError, setTagError] = useState("")
  const [isSortOpen, setIsSortOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("latest")
  const [seatFilter, setSeatFilter] = useState<SeatFilter>(initialSeatFilter)
  const [reviewPage, setReviewPage] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>("board")
  const [selectedReview, setSelectedReview] = useState<PublicSeatReview | null>(null)
  const [reportingReview, setReportingReview] = useState<PublicSeatReview | null>(null)
  const [isReportingReview, setIsReportingReview] = useState(false)
  const [reportError, setReportError] = useState("")
  const [reportMessage, setReportMessage] = useState("")
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false)
  const [actionError, setActionError] = useState("")
  const reviewSearchParams = useMemo<SeatReviewSearchParams>(
    () =>
      buildSeatReviewSearchQuery({
        page: reviewPage,
        limit: reviewPageLimit,
        searchText,
        activeFilterMode,
        filterSearchText,
        selectedFilter,
        selectedTagIds: activeFilterMode === "tag" ? selectedTagIds : [],
        seatFilter,
        sortKey,
      }),
    [
      activeFilterMode,
      filterSearchText,
      reviewPage,
      searchText,
      seatFilter,
      selectedFilter,
      selectedTagIds,
      sortKey,
    ],
  )
  const canShowSeatMap = Boolean(selectedFilter?.mode === "theater" && selectedFilter.hasSeatMap)
  const effectiveViewMode: ViewMode = viewMode === "seatMap" && canShowSeatMap ? "seatMap" : "board"
  const {
    reviews,
    total,
    page,
    limit,
    hasNext,
    isLoading,
    error,
    removeReview,
  } = useSeatReviews(reviewSearchParams)
  const {
    reviews: seatMapReviews,
    isLoading: isLoadingSeatMapReviews,
    error: seatMapError,
    removeReview: removeSeatMapReview,
  } = useSeatReviews(reviewSearchParams, {
    enabled: canShowSeatMap,
    loadAllPages: true,
  })
  const viewReviews = effectiveViewMode === "seatMap" ? seatMapReviews : reviews
  const viewIsLoading = effectiveViewMode === "seatMap" ? isLoadingSeatMapReviews : isLoading
  const viewError = effectiveViewMode === "seatMap" ? seatMapError : error
  const isAuthenticated = Boolean(currentUser)

  const filterOptions = useMemo(
    () => makeUniqueFilters(reviews, theaters, filterMode, filterSearchText),
    [filterMode, filterSearchText, reviews, theaters],
  )

  const floorOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...getSortedUniqueSeatValues(viewReviews, (review) => review.seat.floor),
          seatFilter.floor,
        ].filter((value): value is string => Boolean(value))),
      ),
    [seatFilter.floor, viewReviews],
  )

  const sectionOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...getSortedUniqueSeatValues(viewReviews, (review) => review.seat.section),
          seatFilter.section,
        ].filter((value): value is string => Boolean(value))),
      ),
    [seatFilter.section, viewReviews],
  )

  const effectiveSeatFilter = useMemo<SeatFilter>(
    () => ({
      ...seatFilter,
      floor:
        seatFilter.floor && !floorOptions.includes(seatFilter.floor) ? "" : seatFilter.floor,
      section:
        seatFilter.section && !sectionOptions.includes(seatFilter.section)
          ? ""
          : seatFilter.section,
    }),
    [floorOptions, seatFilter, sectionOptions],
  )
  const seatFilterHint = selectedFilter
    ? `${selectedFilter.label} 기준으로 가능한 위치만 표시합니다.`
    : "극장이나 작품을 선택하면 해당 범위의 위치만 표시합니다."

  const displayReviews = getReviewBoardDisplayReviews({
    viewMode: effectiveViewMode,
    visibleReviews: reviews,
    seatMapReviews,
  })
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    let isMounted = true

    async function loadCurrentUser() {
      try {
        const user = await getCurrentUser()

        if (isMounted) {
          setCurrentUser(user)
        }
      } catch {
        if (isMounted) {
          setCurrentUser(null)
        }
      }
    }

    void loadCurrentUser()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadTheaterOptions() {
      try {
        const theaterOptions = await getTheaters()

        if (isMounted) {
          setTheaters(theaterOptions)
        }
      } catch {
        if (isMounted) {
          setTheaters([])
        }
      }
    }

    void loadTheaterOptions()

    return () => {
      isMounted = false
    }
  }, [])

  const loadTagOptions = useCallback(async () => {
    try {
      setTagError("")
      setIsLoadingTags(true)

      const tagOptions = await getTags()

      setTags(tagOptions)
    } catch {
      setTagError("태그 목록을 불러오지 못했습니다. API 서버 연결을 확인한 뒤 다시 시도해주세요.")
    } finally {
      setIsLoadingTags(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedReview) {
      return
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedReview(null)
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [selectedReview])

  useEffect(() => {
    if (!isLogoutConfirmOpen) {
      return
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsLogoutConfirmOpen(false)
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [isLogoutConfirmOpen])

  useEffect(() => {
    if (!reportMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setReportMessage("")
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [reportMessage])

  function handleWriteReview() {
    if (isAuthenticated) {
      navigate("/reviews/new")
      return
    }

    navigate("/auth", { state: { redirectTo: "/reviews/new" } })
  }

  async function handleLogout() {
    await logout().catch(() => undefined)
    setCurrentUser(null)
    setIsLogoutConfirmOpen(false)
  }

  function handleEditReview(review: PublicSeatReview) {
    navigate(`/reviews/${review.id}/edit`)
  }

  async function handleDeleteReview(review: PublicSeatReview) {
    if (!isAuthenticated) {
      navigate("/auth", { state: { redirectTo: "/" } })
      return
    }

    if (!window.confirm("정말 이 후기를 삭제하시겠습니까?")) {
      return
    }

    try {
      setActionError("")
      await deleteSeatReview(review.id)
      removeReview(review.id)
      removeSeatMapReview(review.id)

      if (selectedReview?.id === review.id) {
        setSelectedReview(null)
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "후기 삭제에 실패했습니다.")
    }
  }

  function handleReportReview(review: PublicSeatReview) {
    if (!isAuthenticated) {
      navigate("/auth", { state: { redirectTo: "/" } })
      return
    }

    setReportError("")
    setReportMessage("")
    setReportingReview(review)
  }

  async function submitReportReview(reason: string) {
    if (!reportingReview) {
      return
    }

    try {
      setReportError("")
      setReportMessage("")
      setIsReportingReview(true)
      await reportSeatReview(reportingReview.id, reason)
      setReportingReview(null)
      setReportMessage("신고가 접수되었습니다. 관리자가 확인할게요.")
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "후기 신고에 실패했습니다.")
    } finally {
      setIsReportingReview(false)
    }
  }

  function handleFilterModeChange(nextMode: FilterMode) {
    setReviewPage(1)
    setActiveFilterMode(nextMode)
    setFilterMode(nextMode)
    setFilterSearchText("")
    setSelectedFilter(null)
    setIsTagDropdownOpen(nextMode === "tag")

    if (nextMode === "tag" && tags.length === 0 && !isLoadingTags) {
      void loadTagOptions()
    }

    if (nextMode !== "tag") {
      setSelectedTagIds([])
    }
  }

  function updateSeatFilter(nextSeatFilter: SeatFilter) {
    setReviewPage(1)
    setSeatFilter(nextSeatFilter)
  }

  function toggleTagFilter(tagId: string) {
    setReviewPage(1)
    setSelectedFilter(null)
    setSelectedTagIds((currentTagIds) =>
      currentTagIds.includes(tagId)
        ? currentTagIds.filter((currentTagId) => currentTagId !== tagId)
        : [...currentTagIds, tagId],
    )
  }

  function selectFilter(option: ReviewBoardFilter) {
    setReviewPage(1)
    setSelectedFilter(option)
    setFilterSearchText(option.label)

    if (option.mode === "theater" && option.hasSeatMap) {
      setIsSortOpen(false)
      setViewMode("seatMap")
    }
  }

  function openTheaterReviewPage(option: ReviewBoardFilter) {
    if (!canOpenTheaterReviewPage(option)) {
      return
    }

    navigate(`/theaters/${option.id}`)
  }

  return (
    <main className="review-board-page">
      <div className="review-board-shell">
        <header className="review-board-header">
          <h1>게시판</h1>
          <div className="review-board-auth-actions">
            {isAuthenticated ? (
              <button type="button" onClick={() => setIsLogoutConfirmOpen(true)}>
                로그아웃
              </button>
            ) : (
              <button type="button" onClick={() => navigate("/auth", { state: { redirectTo: "/" } })}>
                로그인
              </button>
            )}
          </div>
        </header>

        <section className="review-board-search-row">
          <input
            className="review-board-main-search"
            value={searchText}
            onChange={(event) => {
              setReviewPage(1)
              setSearchText(event.target.value)
            }}
            placeholder="후기 내용을 검색하세요"
          />
          <button className="review-board-write-button" type="button" onClick={handleWriteReview}>
            후기 작성
          </button>
        </section>

        <section className="review-board-filter-panel">
          <div className="review-board-filter-row">
            <button
              className="review-board-chip"
              type="button"
              aria-pressed={activeFilterMode === "theater"}
              onClick={() => handleFilterModeChange("theater")}
            >
              극장별
            </button>
            <button
              className="review-board-chip"
              type="button"
              aria-pressed={activeFilterMode === "work"}
              onClick={() => handleFilterModeChange("work")}
            >
              작품별
            </button>
            <button
              className="review-board-chip"
              type="button"
              aria-pressed={activeFilterMode === "tag"}
              onClick={() => handleFilterModeChange("tag")}
            >
              태그별
            </button>
            {activeFilterMode && activeFilterMode !== "tag" ? (
              <input
                className="review-board-filter-search"
                value={filterSearchText}
                onChange={(event) => {
                  setReviewPage(1)
                  setFilterSearchText(event.target.value)
                  setSelectedFilter(null)
                }}
                placeholder="검색어를 입력하세요"
              />
            ) : null}
            {activeFilterMode === "tag" ? (
              <button
                className="review-board-tag-trigger"
                type="button"
                aria-expanded={isTagDropdownOpen}
                onClick={() => {
                  const nextIsOpen = !isTagDropdownOpen

                  setIsTagDropdownOpen(nextIsOpen)

                  if (nextIsOpen && tags.length === 0 && !isLoadingTags) {
                    void loadTagOptions()
                  }
                }}
              >
                {selectedTagIds.length > 0
                  ? `태그 ${selectedTagIds.length}개 선택`
                  : "태그 선택"}
              </button>
            ) : null}
          </div>

          {activeFilterMode === "tag" ? (
            <div className="review-board-filter-result-zone">
              <p>태그 선택</p>
              {tagError ? (
                <div className="review-board-filter-error-block">
                  <p>{tagError}</p>
                  <button type="button" onClick={() => void loadTagOptions()}>
                    다시 불러오기
                  </button>
                </div>
              ) : null}
              {isLoadingTags ? (
                <p className="review-board-empty-filter">태그를 불러오는 중입니다.</p>
              ) : null}
              {isTagDropdownOpen && !isLoadingTags && !tagError ? (
                <div
                  className="review-board-tag-menu"
                  role="listbox"
                  aria-label="태그 다중 선택"
                  aria-multiselectable="true"
                >
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={selectedTagIds.includes(tag.id)}
                      onClick={() => toggleTagFilter(tag.id)}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedTagIds.length > 0 ? (
                <div className="review-board-selected-tags" aria-label="선택된 태그">
                  {tags
                    .filter((tag) => selectedTagIds.includes(tag.id))
                    .map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTagFilter(tag.id)}
                      >
                        {tag.name} ×
                      </button>
                    ))}
                  <button
                    className="review-board-selected-tags-clear"
                    type="button"
                    onClick={() => {
                      setReviewPage(1)
                      setSelectedTagIds([])
                    }}
                  >
                    전체 해제
                  </button>
                </div>
              ) : null}
            </div>
          ) : activeFilterMode && filterSearchText.trim() ? (
            <div className="review-board-filter-result-zone">
              <p>{filterResultLabels[activeFilterMode]}</p>
              <div className="review-board-filter-results">
                {filterOptions.length > 0 ? (
                  filterOptions.map((option) => (
                    <button
                      key={`${option.mode}:${option.id}`}
                      className="review-board-filter-result"
                      type="button"
                      aria-pressed={
                        selectedFilter?.mode === option.mode && selectedFilter.id === option.id
                      }
                      onClick={() => selectFilter(option)}
                    >
                      {option.label}
                    </button>
                  ))
                ) : (
                  <p className="review-board-empty-filter">검색 결과가 없습니다.</p>
                )}
              </div>
            </div>
          ) : null}

          {selectedFilter && canOpenTheaterReviewPage(selectedFilter) ? (
            <div className="review-board-selected-filter-action">
              <span>{selectedFilter.label}</span>
              <button type="button" onClick={() => openTheaterReviewPage(selectedFilter)}>
                극장별 후기 보기
              </button>
            </div>
          ) : null}
        </section>

        <section className="review-board-list-panel">
          <div className="review-board-view-tabs">
            <button
              type="button"
              aria-pressed={effectiveViewMode === "board"}
              onClick={() => setViewMode("board")}
            >
              게시판
            </button>
            {canShowSeatMap ? (
              <button
                type="button"
                aria-pressed={effectiveViewMode === "seatMap"}
                onClick={() => {
                  setIsSortOpen(false)
                  setViewMode("seatMap")
                }}
              >
                좌석배치도
              </button>
            ) : null}
          </div>

          {effectiveViewMode === "board" ? (
            <div className="review-board-list-toolbar">
              <button
                className="review-board-sort-button"
                type="button"
                aria-expanded={isSortOpen}
                onClick={() => setIsSortOpen((isOpen) => !isOpen)}
              >
                <span />
                <span />
                <span />
              </button>

              {isSortOpen ? (
                <div className="review-board-sort-menu">
                <section>
                  <h3>정렬</h3>
                  <div className="review-board-sort-options">
                    {sortGroups.map((group) => (
                      <div className="review-board-sort-group" key={group.label}>
                        <span>{group.label}</span>
                        <div>
                          {group.keys.map((key) => (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={sortKey === key}
                              onClick={() => {
                                setReviewPage(1)
                                setSortKey(key)
                              }}
                            >
                              {sortLabels[key]}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3>좌석 필터</h3>
                  <p className="review-board-filter-hint">{seatFilterHint}</p>
                  <div className="review-board-seat-filter-group">
                    <span>층수</span>
                    <div>
                      {floorOptions.map((floor) => (
                        <button
                          key={floor}
                          type="button"
                          aria-pressed={effectiveSeatFilter.floor === floor}
                          onClick={() =>
                            updateSeatFilter({
                              ...effectiveSeatFilter,
                              floor: effectiveSeatFilter.floor === floor ? "" : floor,
                            })
                          }
                        >
                          {floor}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="review-board-seat-filter-group">
                    <span>구역</span>
                    <div>
                      {sectionOptions.map((section) => (
                        <button
                          key={section}
                          type="button"
                          aria-pressed={effectiveSeatFilter.section === section}
                          onClick={() =>
                            updateSeatFilter({
                              ...effectiveSeatFilter,
                              section: effectiveSeatFilter.section === section ? "" : section,
                            })
                          }
                        >
                          {section}구역
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="review-board-range-filters">
                    <label>
                      열
                      <input
                        value={effectiveSeatFilter.row}
                        onChange={(event) =>
                          updateSeatFilter({ ...effectiveSeatFilter, row: event.target.value })
                        }
                        placeholder="7"
                      />
                    </label>
                    <label>
                      번호
                      <input
                        value={effectiveSeatFilter.number}
                        onChange={(event) =>
                          updateSeatFilter({ ...effectiveSeatFilter, number: event.target.value })
                        }
                        placeholder="15"
                      />
                    </label>
                  </div>
                </section>

                <div className="review-board-sort-actions">
                  <button type="button" onClick={() => updateSeatFilter(initialSeatFilter)}>
                    초기화
                  </button>
                  <button type="button" onClick={() => setIsSortOpen(false)}>
                    적용
                  </button>
                </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <ReviewResultsPanel
            actionError={actionError}
            currentUserId={currentUser?.id}
            error={viewError}
            hasNext={hasNext}
            isLoading={viewIsLoading}
            onDeleteReview={handleDeleteReview}
            onEditReview={handleEditReview}
            onNextPage={() => setReviewPage((currentPage) => currentPage + 1)}
            onPreviousPage={() => setReviewPage((currentPage) => Math.max(1, currentPage - 1))}
            onReportReview={handleReportReview}
            onSelectReview={setSelectedReview}
            onTheaterSelect={(review) => navigate(`/theaters/${review.theater.id}`)}
            page={page}
            reviews={displayReviews}
            theaterName={selectedFilter?.label ?? ""}
            total={total}
            totalPages={totalPages}
            viewMode={effectiveViewMode}
          />
        </section>
      </div>

      {selectedReview ? (
        <ReviewDetailModal
          currentUserId={currentUser?.id}
          isAuthenticated={isAuthenticated}
          onClose={() => setSelectedReview(null)}
          onDeleteReview={handleDeleteReview}
          onEditReview={handleEditReview}
          onReportReview={handleReportReview}
          review={selectedReview}
        />
      ) : null}

      {reportingReview ? (
        <ReportReviewDialog
          error={reportError}
          isSubmitting={isReportingReview}
          onCancel={() => {
            if (!isReportingReview) {
              setReportingReview(null)
              setReportError("")
            }
          }}
          onSubmit={submitReportReview}
          review={reportingReview}
        />
      ) : null}

      {reportMessage ? (
        <p className="review-board-toast" role="status">
          {reportMessage}
        </p>
      ) : null}

      {isLogoutConfirmOpen ? (
        <div
          className="logout-confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsLogoutConfirmOpen(false)
            }
          }}
        >
          <section className="logout-confirm-card">
            <h2 id="logout-confirm-title">로그아웃 하시겠습니까?</h2>
            <p>현재 계정에서 로그아웃됩니다.</p>
            <div className="logout-confirm-actions">
              <button type="button" onClick={() => setIsLogoutConfirmOpen(false)}>
                취소
              </button>
              <button type="button" onClick={handleLogout}>
                로그아웃
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <SeatAssistantPanel />
    </main>
  )
}
