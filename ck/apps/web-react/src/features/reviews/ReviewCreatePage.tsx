import { useEffect, useMemo, useRef, useState } from "react"
import type { FocusEvent, SubmitEvent } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useReviewMetadata } from "./hooks/useReviewMetadata"
import {
  getTheaterSeatLayout,
  makeFloorSectionKey,
  makeSeatLineKey,
} from "./theater-seat-layouts"
import type {
  CreateSeatReviewPayload,
  PublicSeatReview,
  SeatLocationDraft,
  TheaterSeatLayout,
  UpdateSeatReviewPayload,
} from "./types"
import { getTags } from "../tags/api"
import type { TagOption } from "../tags/types"
import { createSeatReview, getSeatReview, updateSeatReview } from "./api"
import ReviewCreateActions from "./components/ReviewCreateActions"
import ReviewContentPanel from "./components/ReviewContentPanel"
import ReviewRatingPanel, { type ReviewRatingValues } from "./components/ReviewRatingPanel"
import ReviewTagPanel from "./components/ReviewTagPanel"
import { getSelectedTheaterForSeatLayout } from "./review-create-seat-layout"
import "./styles/review-create-page.css"

function normalizeSeatText(value: string) {
  return value.trim()
}

function normalizeSeatRow(value: string) {
  return normalizeSeatText(value)
}

function hasOfficialSections(layout: TheaterSeatLayout) {
  return Object.values(layout.sectionsByFloor).some((sections) => sections.length > 0)
}

function getReviewWorkTitle(review: PublicSeatReview) {
  return [review.performance?.seasonLabel, review.musical.title].filter(Boolean).join(" ")
}

const initialSeatLocation: SeatLocationDraft = {
  seatFloor: "",
  seatSection: "",
  seatRow: "",
  seatNumber: "",
}

type SeatDropdownKey = "row" | "number"

const initialRatings: ReviewRatingValues = {
  viewRating: 5,
  soundRating: 5,
  comfortRating: 5,
  expressionRating: 5,
  stageVisibilityRating: 5,
}

export default function ReviewCreatePage() {
  const navigate = useNavigate()
  const { reviewId } = useParams()
  const [searchParams] = useSearchParams()
  const isEditMode = Boolean(reviewId)
  const initialTheaterId = isEditMode ? "" : (searchParams.get("theaterId") ?? "")
  const [selectedTheaterId, setSelectedTheaterId] = useState(initialTheaterId)
  const [theaterSearchText, setTheaterSearchText] = useState("")
  const [selectedPerformanceId, setSelectedPerformanceId] = useState("")
  const [workSearchText, setWorkSearchText] = useState("")
  const [seatLocation, setSeatLocation] = useState<SeatLocationDraft>(initialSeatLocation)
  const [openSeatDropdown, setOpenSeatDropdown] = useState<SeatDropdownKey | null>(null)
  const [formError, setFormError] = useState("")

  const [content, setContent] = useState("")
  const [ratings, setRatings] = useState<ReviewRatingValues>(initialRatings)
  const [submitMessage, setSubmitMessage] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingReview, setEditingReview] = useState<PublicSeatReview | null>(null)
  const [tags, setTags] = useState<TagOption[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [isLoadingTags, setIsLoadingTags] = useState(true)
  const [tagError, setTagError] = useState("")
  const isSubmittingRef = useRef(false)

  const { theaters, workOptions, performances, isLoadingMetadata, isLoadingPerformances, error } =
    useReviewMetadata(selectedTheaterId)

  const selectedTheater = useMemo(
    () =>
      getSelectedTheaterForSeatLayout({
        theaters,
        selectedTheaterId,
        editingReview,
      }),
    [editingReview, theaters, selectedTheaterId],
  )
  const selectedTheaterName = useMemo(
    () => theaters.find((theater) => theater.id === selectedTheaterId)?.name ?? "",
    [selectedTheaterId, theaters],
  )
  const theaterSearchInputValue =
    theaterSearchText || (selectedTheaterId ? selectedTheaterName : "")

  const selectedPerformance = useMemo(
    () => performances.find((performance) => performance.id === selectedPerformanceId) ?? null,
    [performances, selectedPerformanceId],
  )

  const seatLayout = useMemo(() => getTheaterSeatLayout(selectedTheater), [selectedTheater])
  const needsOfficialSection = hasOfficialSections(seatLayout)
  const sections = seatLocation.seatFloor
    ? seatLayout.sectionsByFloor[seatLocation.seatFloor] ?? []
    : []
  const rowOptions =
    seatLocation.seatFloor && seatLocation.seatSection
      ? seatLayout.rowsByFloorAndSection?.[
          makeFloorSectionKey(seatLocation.seatFloor, seatLocation.seatSection)
        ] ?? []
      : []
  const numberOptions =
    seatLocation.seatFloor && seatLocation.seatSection && seatLocation.seatRow
      ? seatLayout.numbersBySeatLine?.[
          makeSeatLineKey(
            seatLocation.seatFloor,
            seatLocation.seatSection,
            seatLocation.seatRow,
          )
        ] ?? []
      : []
  const selectedRowLabel =
    rowOptions.find((row) => row.value === seatLocation.seatRow)?.label ??
    (seatLocation.seatRow ? `${seatLocation.seatRow}열` : "열 선택")
  const selectedNumberLabel =
    numberOptions.find((number) => number.value === seatLocation.seatNumber)?.label ??
    (seatLocation.seatNumber ? `${seatLocation.seatNumber}번` : "번호 선택")
  const isRowDropdownDisabled =
    !selectedTheaterId || !seatLocation.seatSection || rowOptions.length === 0
  const isNumberDropdownDisabled =
    !selectedTheaterId || !seatLocation.seatRow || numberOptions.length === 0
  const normalizedTheaterSearchText = theaterSearchText.trim().toLowerCase()
  const filteredTheaterOptions = useMemo(
    () =>
      normalizedTheaterSearchText
        ? theaters.filter((theater) =>
            theater.name.toLowerCase().includes(normalizedTheaterSearchText),
          )
        : theaters,
    [normalizedTheaterSearchText, theaters],
  )
  const normalizedSearchText = workSearchText.trim().toLowerCase()
  const filteredWorkOptions = useMemo(
    () =>
      normalizedSearchText
        ? workOptions.filter((work) => work.searchText.includes(normalizedSearchText))
        : workOptions,
    [normalizedSearchText, workOptions],
  )

  useEffect(() => {
    let isMounted = true

    async function loadTags() {
      try {
        setTagError("")
        setIsLoadingTags(true)

        const tagOptions = await getTags()

        if (isMounted) {
          setTags(tagOptions)
        }
      } catch (err) {
        if (isMounted) {
          setTagError(err instanceof Error ? err.message : "태그를 불러오지 못했습니다.")
        }
      } finally {
        if (isMounted) {
          setIsLoadingTags(false)
        }
      }
    }

    void loadTags()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!reviewId) {
      return
    }

    let isMounted = true
    const editingReviewId = reviewId

    async function loadEditingReview() {
      try {
        setFormError("")

        const review = await getSeatReview(editingReviewId)

        if (!isMounted) {
          return
        }

        setEditingReview(review)
        setSelectedTheaterId(review.theater.id)
        setSelectedPerformanceId(review.performance?.id ?? "")
        setTheaterSearchText(review.theater.name)
        setWorkSearchText(getReviewWorkTitle(review))
        setSeatLocation({
          seatFloor: review.seat.floor,
          seatSection: review.seat.section ?? "",
          seatRow: review.seat.row,
          seatNumber: review.seat.number,
        })
        setRatings({
          viewRating: review.ratings.view,
          soundRating: review.ratings.sound,
          comfortRating: review.ratings.comfort,
          expressionRating: review.ratings.expression,
          stageVisibilityRating: review.ratings.stageVisibility,
        })
        setContent(review.content)
        setSelectedTagIds((review.tags ?? []).map((tag) => tag.id))
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "후기를 불러오지 못했습니다.")
      }
    }

    void loadEditingReview()

    return () => {
      isMounted = false
    }
  }, [reviewId])

  function handleSeatDropdownBlur(event: FocusEvent<HTMLDivElement>) {
    const nextFocusedElement = event.relatedTarget as Node | null

    if (!event.currentTarget.contains(nextFocusedElement)) {
      setOpenSeatDropdown(null)
    }
  }

  function clearTheaterDependentFields() {
    setSelectedPerformanceId("")
    setWorkSearchText("")
    setSeatLocation(initialSeatLocation)
    setFormError("")
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSubmittingRef.current) {
      return
    }

    if (
      !selectedTheaterId ||
      (!isEditMode && (!selectedPerformanceId || !selectedPerformance)) ||
      !seatLocation.seatFloor ||
      (needsOfficialSection && !seatLocation.seatSection) ||
      !seatLocation.seatRow.trim() ||
      !seatLocation.seatNumber.trim() ||
      !content.trim()
    ) {
      setFormError("공연장, 작품, 좌석 위치를 모두 선택하거나 입력해주세요.")
      return
    }

    const reviewFields = {
      seatFloor: normalizeSeatText(seatLocation.seatFloor),
      seatRow: normalizeSeatRow(seatLocation.seatRow),
      seatNumber: normalizeSeatText(seatLocation.seatNumber),
      ...(needsOfficialSection
        ? { seatSection: normalizeSeatText(seatLocation.seatSection) }
        : {}),
      ...ratings,
      content: content.trim(),
      tagIds: selectedTagIds,
    }

    setFormError("")
    setSubmitMessage("")
    isSubmittingRef.current = true
    setIsSubmitting(true)

    try {
      if (isEditMode && reviewId) {
        const payload: UpdateSeatReviewPayload = reviewFields
        await updateSeatReview(reviewId, payload)
        setSubmitMessage("후기가 수정되었습니다.")
        navigate("/")
        return
      }

      if (!selectedPerformance) {
        throw new Error("공연 정보를 찾을 수 없습니다.")
      }

      const payload: CreateSeatReviewPayload = {
        theaterId: selectedTheaterId,
        musicalId: selectedPerformance.musicalId,
        performanceId: selectedPerformance.id,
        ...reviewFields,
      }

      await createSeatReview(payload)
      setSubmitMessage("후기가 저장되었습니다.")
    }
    catch (err) {
      setFormError(err instanceof Error ? err.message : "후기 저장에 실패했습니다.")
    }
    finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <main className="review-create-page">
      <h1 className="review-create-title">{isEditMode ? "리뷰 수정" : "리뷰 작성"}</h1>

      {error ? <p className="review-create-message review-create-message--error">{error}</p> : null}
      {formError ? (
        <p className="review-create-message review-create-message--error">{formError}</p>
      ) : null}
      {isLoadingMetadata ? (
        <p className="review-create-message">공연장 목록을 불러오는 중입니다.</p>
      ) : null}

      <form className="review-create-form" onSubmit={handleSubmit}>
        <section className="review-create-panel review-create-panel--primary">
          <div className="review-create-row">
            <span className="review-create-label">공연장</span>
            <div className="review-create-work-control">
              <input
                className="review-create-input review-create-input--work"
                value={theaterSearchInputValue}
                disabled={isEditMode || isLoadingMetadata}
                onChange={(event) => {
                  setTheaterSearchText(event.target.value)
                  setSelectedTheaterId("")
                  clearTheaterDependentFields()
                }}
                placeholder="공연장을 검색하세요"
              />

              {normalizedTheaterSearchText && !selectedTheaterId ? (
                <div className="review-create-work-results" role="listbox" aria-label="공연장 검색 결과">
                  {filteredTheaterOptions.length > 0 ? (
                    filteredTheaterOptions.map((theater) => (
                      <button
                        key={theater.id}
                        className="review-create-work-result"
                        type="button"
                        aria-pressed={selectedTheaterId === theater.id}
                        onClick={() => {
                          setSelectedTheaterId(theater.id)
                          setTheaterSearchText(theater.name)
                          clearTheaterDependentFields()
                        }}
                      >
                        {theater.name}
                      </button>
                    ))
                  ) : (
                    <p className="review-create-work-empty">검색 결과가 없습니다.</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="review-create-row">
            <span className="review-create-label">작품</span>
            <div className="review-create-work-control">
              <input
                className="review-create-input review-create-input--work"
                value={workSearchText}
                disabled={isEditMode || !selectedTheaterId || isLoadingPerformances}
                onChange={(event) => {
                  setWorkSearchText(event.target.value)
                  setSelectedPerformanceId("")
                }}
                placeholder="검색어를 입력하세요"
              />

              {isLoadingPerformances ? (
                <p className="review-create-work-hint">공연 목록을 불러오는 중입니다.</p>
              ) : null}

              {selectedTheaterId && normalizedSearchText && !selectedPerformanceId ? (
                <div className="review-create-work-results" role="listbox" aria-label="작품 검색 결과">
                  {filteredWorkOptions.length > 0 ? (
                    filteredWorkOptions.map((work) => (
                      <button
                        key={work.performanceId}
                        className="review-create-work-result"
                        type="button"
                        aria-pressed={selectedPerformanceId === work.performanceId}
                        onClick={() => {
                          setSelectedPerformanceId(work.performanceId)
                          setWorkSearchText(work.displayTitle)
                        }}
                      >
                        {work.displayTitle}
                      </button>
                    ))
                  ) : (
                    <p className="review-create-work-empty">검색 결과가 없습니다.</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="review-create-row">
            <span className="review-create-label">층</span>
            <div className="review-create-toggle-group">
              {seatLayout.floors.map((floor) => (
                <button
                  key={floor.value}
                  className="review-create-chip"
                  type="button"
                  aria-pressed={seatLocation.seatFloor === floor.value}
                  disabled={!selectedTheaterId}
                  onClick={() => {
                    setSeatLocation({
                      ...seatLocation,
                      seatFloor: floor.value,
                      seatSection: "",
                      seatRow: "",
                      seatNumber: "",
                    })
                    setOpenSeatDropdown(null)
                  }}
                >
                  {floor.label}
                </button>
              ))}
            </div>
          </div>

          {needsOfficialSection ? (
            <div className="review-create-row">
              <span className="review-create-label">구역</span>
              <div className="review-create-toggle-group">
                {sections.map((section) => (
                  <button
                    key={section.value}
                    className="review-create-chip"
                    type="button"
                    aria-pressed={seatLocation.seatSection === section.value}
                    disabled={!selectedTheaterId || !seatLocation.seatFloor}
                    onClick={() => {
                      setSeatLocation({
                        ...seatLocation,
                        seatSection: section.value,
                        seatRow: "",
                        seatNumber: "",
                      })
                      setOpenSeatDropdown(null)
                    }}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="review-create-row review-create-row--seat">
            <span className="review-create-label">열</span>
            <div className="review-create-dropdown review-create-dropdown--seat" onBlur={handleSeatDropdownBlur}>
              <button
                className="review-create-dropdown-trigger review-create-dropdown-trigger--seat"
                type="button"
                aria-expanded={openSeatDropdown === "row"}
                disabled={isRowDropdownDisabled}
                onClick={() =>
                  setOpenSeatDropdown(openSeatDropdown === "row" ? null : "row")
                }
              >
                <span>{selectedRowLabel}</span>
                <span aria-hidden="true" />
              </button>
              {openSeatDropdown === "row" ? (
                <div className="review-create-dropdown-menu review-create-dropdown-menu--seat" role="listbox">
                  {rowOptions.map((row) => (
                    <button
                      key={row.value}
                      className="review-create-dropdown-option"
                      type="button"
                      aria-selected={seatLocation.seatRow === row.value}
                      onClick={() => {
                        setSeatLocation({
                          ...seatLocation,
                          seatRow: row.value,
                          seatNumber: "",
                        })
                        setOpenSeatDropdown(null)
                      }}
                    >
                      {row.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="review-create-label review-create-label--number">번호</span>
            <div className="review-create-dropdown review-create-dropdown--seat" onBlur={handleSeatDropdownBlur}>
              <button
                className="review-create-dropdown-trigger review-create-dropdown-trigger--seat"
                type="button"
                aria-expanded={openSeatDropdown === "number"}
                disabled={isNumberDropdownDisabled}
                onClick={() =>
                  setOpenSeatDropdown(openSeatDropdown === "number" ? null : "number")
                }
              >
                <span>{selectedNumberLabel}</span>
                <span aria-hidden="true" />
              </button>
              {openSeatDropdown === "number" ? (
                <div className="review-create-dropdown-menu review-create-dropdown-menu--seat" role="listbox">
                  {numberOptions.map((number) => (
                    <button
                      key={number.value}
                      className="review-create-dropdown-option"
                      type="button"
                      aria-selected={seatLocation.seatNumber === number.value}
                      onClick={() => {
                        setSeatLocation({ ...seatLocation, seatNumber: number.value })
                        setOpenSeatDropdown(null)
                      }}
                    >
                      {number.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <ReviewRatingPanel ratings={ratings} onChange={setRatings} />

        <ReviewContentPanel content={content} onChange={setContent} />

        <ReviewTagPanel
          error={tagError}
          isLoading={isLoadingTags}
          onChange={setSelectedTagIds}
          selectedTagIds={selectedTagIds}
          tags={tags}
        />

        {submitMessage ? <p className="review-create-feedback">{submitMessage}</p> : null}

        <ReviewCreateActions
          isEditMode={isEditMode}
          isSubmitting={isSubmitting}
          onCancel={() => navigate("/")}
        />
      </form>
    </main>
  )
}
