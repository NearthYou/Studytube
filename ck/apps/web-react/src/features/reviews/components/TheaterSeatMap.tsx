import { useMemo, useState } from "react"
import type { CSSProperties } from "react"
import SeatReviewCard from "./SeatReviewCard"
import {
  getTheaterSeatMapConfig,
  type SeatMapSeat,
  type TheaterSeatMapConfig,
} from "../theater-seat-map-configs"
import { groupBlocksByBand } from "../seat-map-position"
import type { PublicSeatReview } from "../types"

type TheaterSeatMapProps = {
  currentUserId?: string
  onDeleteReview?: (review: PublicSeatReview) => void
  onEditReview?: (review: PublicSeatReview) => void
  onReportReview?: (review: PublicSeatReview) => void
  reviews: PublicSeatReview[]
  theaterName: string
}

type SeatMapBlockRows = TheaterSeatMapConfig["floors"][number]["blocks"][number]["rows"]

function normalizeFloor(value: string) {
  const compactValue = value.replace(/\s/g, "")
  const floorNumber = compactValue.match(/\d+/)?.[0]

  return floorNumber ? `${floorNumber}F` : compactValue.replace("층", "F").toUpperCase()
}

function normalizeSection(value?: string | null) {
  return value?.trim().toUpperCase() ?? ""
}

function getSeatKey(seat: SeatMapSeat) {
  return [
    normalizeFloor(seat.floor),
    normalizeSection(seat.section),
    seat.row.trim().toUpperCase(),
    seat.number.trim(),
  ].join(":")
}

function getReviewSeatKey(review: PublicSeatReview) {
  return getSeatKey({
    floor: review.seat.floor,
    section: review.seat.section ?? "",
    row: review.seat.row,
    number: review.seat.number,
  })
}

function getAverageRating(reviews: PublicSeatReview[]) {
  const total = reviews.reduce(
    (sum, review) =>
      sum +
      review.ratings.view +
      review.ratings.sound +
      review.ratings.comfort +
      review.ratings.expression +
      review.ratings.stageVisibility,
    0,
  )

  return total / (reviews.length * 5)
}

function getSeatTone(reviews: PublicSeatReview[]) {
  if (!reviews.length) {
    return "empty"
  }

  const average = getAverageRating(reviews)

  if (average >= 4.5) {
    return "great"
  }

  if (average >= 4) {
    return "good"
  }

  if (average >= 3) {
    return "ok"
  }

  return "bad"
}

function buildSeatReviewMap(reviews: PublicSeatReview[]) {
  const seatReviews = new Map<string, PublicSeatReview[]>()

  reviews.forEach((review) => {
    const key = getReviewSeatKey(review)
    seatReviews.set(key, [...(seatReviews.get(key) ?? []), review])
  })

  return seatReviews
}

function getFloorReviews(config: TheaterSeatMapConfig, reviews: PublicSeatReview[]) {
  return config.floors
    .map((floor) => ({
      ...floor,
      reviewCount: reviews.filter(
        (review) => normalizeFloor(review.seat.floor) === normalizeFloor(floor.floor),
      ).length,
    }))
    .filter((floor) => floor.reviewCount > 0)
}

function getBlockSeatAlignment(section: string): CSSProperties["justifyContent"] {
  const normalizedSection = normalizeSection(section)

  if (["A", "D", "가"].includes(normalizedSection)) {
    return "flex-end"
  }

  if (["C", "F", "나"].includes(normalizedSection)) {
    return "flex-start"
  }

  return "center"
}

function getBlockMaxCells(rows: SeatMapBlockRows) {
  return Math.max(...rows.map((row) => row.cells.length), 1)
}

function isCopyrightSeatNumber(value: string) {
  return value.toLowerCase().includes("copyright")
}

function hasVisibleSeat(row: SeatMapBlockRows[number]) {
  return row.cells.some((cell) => cell.type === "seat" && !isCopyrightSeatNumber(cell.number))
}

function getVisibleBlockRows(floor: TheaterSeatMapConfig["floors"][number]) {
  return groupBlocksByBand(floor.blocks)
    .map((blockRow) =>
      blockRow
        .map((block) => ({
          ...block,
          rows: block.rows.filter(hasVisibleSeat),
        }))
        .filter((block) => block.rows.length > 0),
    )
    .filter((blockRow) => blockRow.length > 0)
}

function getSeatReviewLabel(
  blockLabel: string,
  row: string,
  seatNumber: string,
  reviewCount: number,
) {
  const seatLabel = `${blockLabel} ${row}열 ${seatNumber}번`

  return reviewCount > 0 ? `${seatLabel} 후기 ${reviewCount}개 보기` : `${seatLabel} 후기 없음`
}

export default function TheaterSeatMap({
  currentUserId,
  onDeleteReview,
  onEditReview,
  onReportReview,
  reviews,
  theaterName,
}: TheaterSeatMapProps) {
  const config = getTheaterSeatMapConfig(theaterName)
  const floorsWithReviews = useMemo(
    () => (config ? getFloorReviews(config, reviews) : []),
    [config, reviews],
  )
  const [selectedFloor, setSelectedFloor] = useState(
    floorsWithReviews[0]?.floor ?? config?.floors[0]?.floor ?? "",
  )
  const [selectedSeatKey, setSelectedSeatKey] = useState<string | null>(null)
  const seatReviewMap = useMemo(() => buildSeatReviewMap(reviews), [reviews])

  if (!config) {
    throw new Error(`${theaterName} 좌석배치도 설정이 없습니다.`)
  }

  const effectiveSelectedFloor =
    config.floors.find((item) => item.floor === selectedFloor)?.floor ??
    floorsWithReviews[0]?.floor ??
    config.floors[0]?.floor ??
    ""
  const floor =
    config.floors.find((item) => item.floor === effectiveSelectedFloor) ?? config.floors[0]
  const blockRows = getVisibleBlockRows(floor)
  const selectedReviews = selectedSeatKey ? seatReviewMap.get(selectedSeatKey) ?? [] : []

  return (
    <section className="theater-seat-map-panel">
      <header className="theater-seat-map-header">
        <div>
          <p>극장 좌석맵</p>
          <h2>{config.label}</h2>
        </div>
        <div className="theater-seat-map-floor-tabs">
          {config.floors.map((item) => (
            <button
              key={item.floor}
              type="button"
              aria-pressed={effectiveSelectedFloor === item.floor}
              onClick={() => {
                setSelectedFloor(item.floor)
                setSelectedSeatKey(null)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="theater-seat-map-stage">STAGE</div>

      <div className="theater-seat-map-floor">
        {blockRows.map((blockRow, blockRowIndex) => (
          <div
            className="theater-seat-map-block-row"
            key={`${floor.floor}:block-row:${blockRowIndex}`}
            style={{
              gridTemplateColumns: `repeat(${blockRow.length}, max-content)`,
            }}
          >
            {blockRow.map((block, blockIndex) => {
              const maxCells = getBlockMaxCells(block.rows)
              const seatRowStyle = {
                justifyContent: getBlockSeatAlignment(block.section),
                width: `${maxCells * 31 - 5}px`,
              } satisfies CSSProperties

              return (
                <section
                  className="theater-seat-map-block"
                  key={`${floor.floor}:${block.sourceId}:${block.section}:${blockIndex}`}
                >
                  <h3>{block.label}</h3>
                  <div className="theater-seat-map-rows">
                    {block.rows.map((row) => (
                      <div
                        className="theater-seat-map-row"
                        key={`${block.sourceId}:${block.section}:${row.row}`}
                      >
                        <span className="theater-seat-map-row-label">{row.row}</span>
                        <div className="theater-seat-map-seats" style={seatRowStyle}>
                          {row.cells.map((cell, index) => {
                            if (
                              cell.type === "gap" ||
                              isCopyrightSeatNumber(cell.number)
                            ) {
                              return (
                                <span
                                  key={`${block.sourceId}:${row.row}:gap:${index}`}
                                  className="theater-seat-map-seat theater-seat-map-seat--gap"
                                  aria-hidden="true"
                                />
                              )
                            }

                            const seatNumber = cell.number
                            const seat = {
                              floor: floor.floor,
                              section: block.section,
                              row: row.row,
                              number: seatNumber,
                            }
                            const seatKey = getSeatKey(seat)
                            const seatReviews = seatReviewMap.get(seatKey) ?? []
                            const reviewCount = seatReviews.length
                            const tone = getSeatTone(seatReviews)
                            const isSelected = selectedSeatKey === seatKey

                            return (
                              <button
                                key={`${block.sourceId}:${row.row}:${seatNumber}:${cell.sourcePk ?? index}`}
                                className={[
                                  "theater-seat-map-seat",
                                  `theater-seat-map-seat--${tone}`,
                                  reviewCount > 0 ? "theater-seat-map-seat--has-review" : "",
                                  isSelected ? "theater-seat-map-seat--selected" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                type="button"
                                aria-label={getSeatReviewLabel(
                                  block.label,
                                  row.row,
                                  seatNumber,
                                  reviewCount,
                                )}
                                aria-pressed={isSelected}
                                disabled={reviewCount === 0}
                                onClick={() => setSelectedSeatKey(seatKey)}
                                title={getSeatReviewLabel(
                                  block.label,
                                  row.row,
                                  seatNumber,
                                  reviewCount,
                                )}
                              >
                                <span>{seatNumber}</span>
                                {reviewCount > 0 ? (
                                  <small aria-hidden="true">{reviewCount}</small>
                                ) : null}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        ))}
      </div>

      <p className="theater-seat-map-copyright">
        Seat map data © SeeYa. Source: musicalseeya.com
      </p>

      {selectedReviews.length > 0 ? (
        <div className="theater-seat-map-modal" role="dialog" aria-modal="true">
          <div className="theater-seat-map-modal-card">
            <header>
              <h2>좌석 후기</h2>
              <button type="button" onClick={() => setSelectedSeatKey(null)}>
                닫기
              </button>
            </header>
            <div className="theater-seat-map-modal-list">
              {selectedReviews.map((review) => (
                <SeatReviewCard
                  canManage={review.author.id === currentUserId}
                  key={review.id}
                  onDelete={onDeleteReview}
                  onEdit={onEditReview}
                  onReport={onReportReview}
                  review={review}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
