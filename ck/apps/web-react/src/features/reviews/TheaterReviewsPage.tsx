import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { getCurrentUser } from "../auth/api"
import SeatAssistantPanel from "../agent/components/SeatAssistantPanel"
import { getTags } from "../tags/api"
import ReportReviewDialog from "./components/ReportReviewDialog"
import ReviewDetailModal from "./components/ReviewDetailModal"
import ReviewResultsPanel from "./components/ReviewResultsPanel"
import { deleteSeatReview, getPerformances, getTheaters, reportSeatReview } from "./api"
import { useSeatReviews } from "./hooks/useSeatReviews"
import {
  buildSeatReviewSearchQuery,
  type ReviewBoardSeatFilter,
  type ReviewBoardSortKey,
} from "./review-search-query"
import { getTheaterSeatLayout } from "./theater-seat-layouts"
import {
  getSeatFilterWarnings,
  getTheaterFilterOptions,
} from "./theater-review-filter-options"
import { getCanonicalTheaterName, theaterSeatMapNames } from "./theater-seat-map-index"
import { buildTheaterSeatMapSearchParams } from "./theater-seat-map-search"
import type { PublicUser } from "../auth/types"
import type { TagOption } from "../tags/types"
import type {
  PerformanceOption,
  PublicSeatReview,
  SeatReviewSearchParams,
  TheaterOption,
} from "./types"
import "./styles/review-board-page.css"
import "./styles/theater-reviews-page.css"

type ViewMode = "board" | "seatMap"
type RatingFilterKey = "view" | "sound" | "comfort" | "stageVisibility"

type RatingFilters = Record<RatingFilterKey, string>

type PerformanceFilter = {
  theaterId: string
  performanceId: string
}

const reviewPageLimit = 12

const initialSeatFilter: ReviewBoardSeatFilter = {
  floor: "",
  section: "",
  row: "",
  number: "",
}

const initialRatingFilters: RatingFilters = {
  view: "",
  sound: "",
  comfort: "",
  stageVisibility: "",
}

const sortLabels: Record<ReviewBoardSortKey, string> = {
  latest: "최신 후기",
  oldest: "오래된 후기",
  popular: "인기 많은 순",
  rating: "평점 높은 순",
  viewHigh: "시야 좋은 순",
  soundHigh: "음향 좋은 순",
  comfortHigh: "좌석 편한 순",
  expressionHigh: "표정 잘 보이는 순",
  stageVisibilityHigh: "무대 전체 잘 보이는 순",
}

const sortOptions: ReviewBoardSortKey[] = [
  "latest",
  "popular",
  "rating",
  "viewHigh",
  "stageVisibilityHigh",
  "soundHigh",
  "comfortHigh",
]

const ratingFilterLabels: Record<RatingFilterKey, string> = {
  view: "시야",
  sound: "음향",
  comfort: "좌석",
  stageVisibility: "무대",
}

const ratingOptions = ["", "3", "4", "5"]

function parseRatingFilter(value: string) {
  return value ? Number(value) : undefined
}

function getTheaterById(theaters: TheaterOption[], theaterId: string | undefined) {
  if (!theaterId) {
    return null
  }

  return theaters.find((theater) => theater.id === theaterId) ?? null
}

function getPerformanceDisplayTitle(performance: PerformanceOption) {
  return (
    performance.displayTitle ??
    [performance.seasonLabel, performance.musicalTitle].filter(Boolean).join(" ")
  )
}

export default function TheaterReviewsPage() {
  const navigate = useNavigate()
  const { theaterId } = useParams()
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null)
  const [theaters, setTheaters] = useState<TheaterOption[]>([])
  const [performances, setPerformances] = useState<PerformanceOption[]>([])
  const [isLoadingTheaters, setIsLoadingTheaters] = useState(true)
  const [isLoadingPerformances, setIsLoadingPerformances] = useState(false)
  const [theaterError, setTheaterError] = useState("")
  const [performanceError, setPerformanceError] = useState("")
  const [searchText, setSearchText] = useState("")
  const [tags, setTags] = useState<TagOption[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false)
  const [isLoadingTags, setIsLoadingTags] = useState(false)
  const [tagError, setTagError] = useState("")
  const [performanceFilter, setPerformanceFilter] = useState<PerformanceFilter>({
    theaterId: "",
    performanceId: "",
  })
  const [sortKey, setSortKey] = useState<ReviewBoardSortKey>("latest")
  const [seatFilter, setSeatFilter] = useState<ReviewBoardSeatFilter>(initialSeatFilter)
  const [ratingFilters, setRatingFilters] = useState<RatingFilters>(initialRatingFilters)
  const [reviewPage, setReviewPage] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>("board")
  const [selectedReview, setSelectedReview] = useState<PublicSeatReview | null>(null)
  const [reportingReview, setReportingReview] = useState<PublicSeatReview | null>(null)
  const [isReportingReview, setIsReportingReview] = useState(false)
  const [reportError, setReportError] = useState("")
  const [reportMessage, setReportMessage] = useState("")
  const [actionError, setActionError] = useState("")
  const selectedTheater = getTheaterById(theaters, theaterId)
  const theaterName = selectedTheater ? getCanonicalTheaterName(selectedTheater.name) : ""
  const selectedPerformanceId =
    performanceFilter.theaterId === theaterId ? performanceFilter.performanceId : ""
  const theaterPerformances = theaterId ? performances : []
  const canShowSeatMap = Boolean(theaterName && theaterSeatMapNames.has(theaterName))
  const effectiveViewMode: ViewMode = viewMode === "seatMap" && canShowSeatMap ? "seatMap" : "board"

  const reviewSearchParams = useMemo<SeatReviewSearchParams>(
    () =>
      theaterId
        ? {
            ...buildSeatReviewSearchQuery({
              page: reviewPage,
              limit: reviewPageLimit,
              fixedTheaterId: theaterId,
              fixedPerformanceId: selectedPerformanceId || undefined,
              searchText,
              selectedTagIds,
              selectedFilter: null,
              seatFilter,
              sortKey,
            }),
            minViewRating: parseRatingFilter(ratingFilters.view),
            minSoundRating: parseRatingFilter(ratingFilters.sound),
            minComfortRating: parseRatingFilter(ratingFilters.comfort),
            minStageVisibilityRating: parseRatingFilter(ratingFilters.stageVisibility),
          }
        : { page: reviewPage, limit: reviewPageLimit },
    [
      ratingFilters,
      reviewPage,
      searchText,
      seatFilter,
      selectedTagIds,
      selectedPerformanceId,
      sortKey,
      theaterId,
    ],
  )
  const seatMapSearchParams = useMemo<SeatReviewSearchParams>(
    () => buildTheaterSeatMapSearchParams(theaterId),
    [theaterId],
  )

  const {
    reviews,
    total,
    page,
    limit,
    hasNext,
    isLoading,
    error,
    removeReview,
  } = useSeatReviews(reviewSearchParams, {
    enabled: Boolean(theaterId && selectedTheater),
  })
  const {
    reviews: seatMapReviews,
    isLoading: isLoadingSeatMapReviews,
    error: seatMapError,
    removeReview: removeSeatMapReview,
  } = useSeatReviews(seatMapSearchParams, {
    enabled: Boolean(theaterId && selectedTheater && canShowSeatMap),
    loadAllPages: true,
  })
  const viewIsLoading = effectiveViewMode === "seatMap" ? isLoadingSeatMapReviews : isLoading
  const viewError = effectiveViewMode === "seatMap" ? seatMapError : error
  const isAuthenticated = Boolean(currentUser)
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const seatLayout = useMemo(() => getTheaterSeatLayout(selectedTheater), [selectedTheater])
  const { floorOptions, sectionOptions, rowOptions, numberOptions } = useMemo(
    () => getTheaterFilterOptions(seatLayout, seatFilter),
    [seatFilter, seatLayout],
  )
  const seatFilterWarnings = useMemo(
    () => getSeatFilterWarnings(seatLayout, seatFilter),
    [seatFilter, seatLayout],
  )

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
    let isMounted = true

    async function loadTheaters() {
      try {
        setTheaterError("")
        setIsLoadingTheaters(true)
        const theaterData = await getTheaters()

        if (isMounted) {
          setTheaters(theaterData)
        }
      } catch (err) {
        if (isMounted) {
          setTheaterError(err instanceof Error ? err.message : "극장 정보를 불러오지 못했습니다.")
        }
      } finally {
        if (isMounted) {
          setIsLoadingTheaters(false)
        }
      }
    }

    void loadTheaters()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!theaterId) {
      return
    }

    let isMounted = true

    async function loadPerformances() {
      try {
        setPerformanceError("")
        setIsLoadingPerformances(true)
        setPerformances([])

        const performanceData = await getPerformances({ theaterId })

        if (isMounted) {
          setPerformances(performanceData)
        }
      } catch (err) {
        if (isMounted) {
          setPerformances([])
          setPerformanceError(err instanceof Error ? err.message : "공연 목록을 불러오지 못했습니다.")
        }
      } finally {
        if (isMounted) {
          setIsLoadingPerformances(false)
        }
      }
    }

    void loadPerformances()

    return () => {
      isMounted = false
    }
  }, [theaterId])

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
    if (!reportMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setReportMessage("")
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [reportMessage])

  function updateSeatFilter(nextSeatFilter: ReviewBoardSeatFilter) {
    setReviewPage(1)
    setSeatFilter(nextSeatFilter)
  }

  function toggleTagFilter(tagId: string) {
    setReviewPage(1)
    setSelectedTagIds((currentTagIds) =>
      currentTagIds.includes(tagId)
        ? currentTagIds.filter((currentTagId) => currentTagId !== tagId)
        : [...currentTagIds, tagId],
    )
  }

  function handleWriteReview() {
    const reviewCreatePath = theaterId ? `/reviews/new?theaterId=${theaterId}` : "/reviews/new"

    if (isAuthenticated) {
      navigate(reviewCreatePath)
      return
    }

    navigate("/auth", { state: { redirectTo: reviewCreatePath } })
  }

  function handleEditReview(review: PublicSeatReview) {
    navigate(`/reviews/${review.id}/edit`)
  }

  async function handleDeleteReview(review: PublicSeatReview) {
    if (!isAuthenticated) {
      navigate("/auth", { state: { redirectTo: `/theaters/${theaterId}` } })
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
      navigate("/auth", { state: { redirectTo: `/theaters/${theaterId}` } })
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

  if (isLoadingTheaters) {
    return (
      <main className="review-board-page theater-reviews-page">
        <section className="theater-reviews-empty">
          <p>극장 정보를 불러오는 중입니다.</p>
        </section>
      </main>
    )
  }

  if (theaterError) {
    return (
      <main className="review-board-page theater-reviews-page">
        <section className="theater-reviews-empty theater-reviews-empty--error">
          <p>{theaterError}</p>
          <Link to="/">전체 후기 게시판으로 돌아가기</Link>
        </section>
      </main>
    )
  }

  if (!selectedTheater) {
    return (
      <main className="review-board-page theater-reviews-page">
        <section className="theater-reviews-empty">
          <p>찾을 수 없는 극장입니다.</p>
          <Link to="/">전체 후기 게시판으로 돌아가기</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="review-board-page theater-reviews-page">
      <div className="review-board-shell theater-reviews-shell">
        <header className="theater-reviews-header">
          <div>
            <Link className="theater-reviews-back-link" to="/">
              전체 후기
            </Link>
            <h1>{theaterName}</h1>
            <p>이 극장의 좌석 후기만 모아 보고, 좌석 위치와 태그로 좁혀볼 수 있습니다.</p>
          </div>
        </header>

        <section className="theater-reviews-controls">
          <div className="review-board-search-row">
            <input
              className="review-board-main-search"
              value={searchText}
              onChange={(event) => {
                setReviewPage(1)
                setSearchText(event.target.value)
              }}
              placeholder={`${theaterName} 후기 검색`}
            />
            <button className="review-board-write-button" type="button" onClick={handleWriteReview}>
              후기 작성
            </button>
          </div>

          <button
            className="theater-reviews-tag-search theater-reviews-tag-trigger"
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
            {selectedTagIds.length > 0 ? `태그 ${selectedTagIds.length}개 선택` : "태그 선택"}
          </button>

          {isTagDropdownOpen || selectedTagIds.length > 0 || tagError || isLoadingTags ? (
            <div className="theater-reviews-tag-panel">
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
                  {tags.length > 0 ? (
                    tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={selectedTagIds.includes(tag.id)}
                        onClick={() => toggleTagFilter(tag.id)}
                      >
                        {tag.name}
                      </button>
                    ))
                  ) : (
                    <p className="review-board-empty-filter">선택할 태그가 없습니다.</p>
                  )}
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
          ) : null}

          <div className="theater-reviews-control-grid">
            <label>
              정렬
              <select
                value={sortKey}
                onChange={(event) => {
                  setReviewPage(1)
                  setSortKey(event.target.value as ReviewBoardSortKey)
                }}
              >
                {sortOptions.map((option) => (
                  <option key={option} value={option}>
                    {sortLabels[option]}
                  </option>
                ))}
              </select>
            </label>

            <label>
              작품/공연
              <select
                value={selectedPerformanceId}
                disabled={isLoadingPerformances}
                onChange={(event) => {
                  setReviewPage(1)
                  setPerformanceFilter({
                    theaterId: theaterId ?? "",
                    performanceId: event.target.value,
                  })
                }}
              >
                <option value="">{isLoadingPerformances ? "불러오는 중" : "전체"}</option>
                {theaterPerformances.map((performance) => (
                  <option key={performance.id} value={performance.id}>
                    {getPerformanceDisplayTitle(performance)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              층
              <select
                value={seatFilter.floor}
                onChange={(event) =>
                  updateSeatFilter({
                    floor: event.target.value,
                    section: "",
                    row: "",
                    number: "",
                  })
                }
              >
                <option value="">전체</option>
                {floorOptions.map((floor) => (
                  <option key={floor} value={floor}>
                    {floor}
                  </option>
                ))}
              </select>
            </label>

            <label>
              구역
              <select
                value={seatFilter.section}
                onChange={(event) =>
                  updateSeatFilter({
                    ...seatFilter,
                    section: event.target.value,
                    row: "",
                    number: "",
                  })
                }
              >
                <option value="">전체</option>
                {sectionOptions.map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
              </select>
            </label>

            <label>
              열
              <input
                list="theater-review-row-options"
                value={seatFilter.row}
                onChange={(event) =>
                  updateSeatFilter({ ...seatFilter, row: event.target.value, number: "" })
                }
                placeholder="10 또는 10~12"
              />
              <datalist id="theater-review-row-options">
                {rowOptions.map((row) => (
                  <option key={row} value={row} />
                ))}
              </datalist>
            </label>

            <label>
              번호
              <input
                list="theater-review-number-options"
                value={seatFilter.number}
                onChange={(event) =>
                  updateSeatFilter({ ...seatFilter, number: event.target.value })
                }
                placeholder="1 또는 1~5"
              />
              <datalist id="theater-review-number-options">
                {numberOptions.map((number) => (
                  <option key={number} value={number} />
                ))}
              </datalist>
            </label>
          </div>

          {performanceError ? (
            <p className="theater-reviews-filter-error">{performanceError}</p>
          ) : null}
          {seatFilterWarnings.length > 0 ? (
            <div className="theater-reviews-filter-errors" role="status">
              {seatFilterWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <div className="theater-reviews-rating-grid">
            {(Object.keys(ratingFilterLabels) as RatingFilterKey[]).map((key) => (
              <label key={key}>
                {ratingFilterLabels[key]} 최소
                <select
                  value={ratingFilters[key]}
                  onChange={(event) => {
                    setReviewPage(1)
                    setRatingFilters((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }}
                >
                  {ratingOptions.map((rating) => (
                    <option key={rating || "all"} value={rating}>
                      {rating ? `${rating}점 이상` : "전체"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              type="button"
              onClick={() => {
                setReviewPage(1)
                setPerformanceFilter({
                  theaterId: theaterId ?? "",
                  performanceId: "",
                })
                setSeatFilter(initialSeatFilter)
                setRatingFilters(initialRatingFilters)
                setSelectedTagIds([])
                setIsTagDropdownOpen(false)
              }}
            >
              필터 초기화
            </button>
          </div>

          <div className="review-board-view-tabs theater-reviews-view-tabs">
            <button
              type="button"
              aria-pressed={effectiveViewMode === "board"}
              onClick={() => setViewMode("board")}
            >
              후기 목록
            </button>
            {canShowSeatMap ? (
              <button
                type="button"
                aria-pressed={effectiveViewMode === "seatMap"}
                onClick={() => setViewMode("seatMap")}
              >
                좌석배치도
              </button>
            ) : null}
          </div>
        </section>

        <section className="review-board-list-panel theater-reviews-list-panel">
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
            page={page}
            reviews={effectiveViewMode === "seatMap" ? seatMapReviews : reviews}
            theaterName={theaterName}
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

      <SeatAssistantPanel />
    </main>
  )
}
