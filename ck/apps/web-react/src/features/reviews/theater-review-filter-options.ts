import type { ReviewBoardSeatFilter } from "./review-search-query.ts"
import type { TheaterSeatLayout } from "./types.ts"

type ParsedSeatRange =
  | { kind: "empty"; values: string[] }
  | { kind: "single"; values: string[] }
  | { kind: "range"; values: string[] }
  | { kind: "invalid"; values: string[] }

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function optionValues(options: Array<{ value: string }>) {
  return options.map((option) => option.value)
}

function makeFloorSectionKey(floor: string, section: string) {
  return `${floor}::${section}`
}

function makeSeatLineKey(floor: string, section: string, row: string) {
  return `${floor}::${section}::${row}`
}

export function parseSeatRangeInput(value: string): ParsedSeatRange {
  const normalizedValue = value.trim()

  if (!normalizedValue) {
    return { kind: "empty", values: [] }
  }

  if (/^\d+$/.test(normalizedValue)) {
    return { kind: "single", values: [normalizedValue] }
  }

  const rangeMatch = normalizedValue.match(/^(\d+)\s*[~-]\s*(\d+)$/)

  if (!rangeMatch) {
    return { kind: "invalid", values: [] }
  }

  const first = Number(rangeMatch[1])
  const second = Number(rangeMatch[2])
  const start = Math.min(first, second)
  const end = Math.max(first, second)

  if (end - start > 200) {
    return { kind: "invalid", values: [] }
  }

  return {
    kind: "range",
    values: Array.from({ length: end - start + 1 }, (_, index) => String(start + index)),
  }
}

export function getTheaterFilterOptions(
  layout: TheaterSeatLayout,
  seatFilter: ReviewBoardSeatFilter,
) {
  const floorOptions = optionValues(layout.floors)
  const sectionOptions = seatFilter.floor
    ? optionValues(layout.sectionsByFloor[seatFilter.floor] ?? [])
    : unique(Object.values(layout.sectionsByFloor).flatMap(optionValues))
  const rowOptions =
    seatFilter.floor && seatFilter.section
      ? optionValues(
          layout.rowsByFloorAndSection?.[
            makeFloorSectionKey(seatFilter.floor, seatFilter.section)
          ] ?? [],
        )
      : []
  const parsedRows = parseSeatRangeInput(seatFilter.row)
  const selectedRows =
    parsedRows.kind === "single" || parsedRows.kind === "range" ? parsedRows.values : []
  const numberOptions =
    seatFilter.floor && seatFilter.section && selectedRows.length > 0
      ? unique(
          selectedRows.flatMap((row) =>
            optionValues(
              layout.numbersBySeatLine?.[
                makeSeatLineKey(seatFilter.floor, seatFilter.section, row)
              ] ?? [],
            ),
          ),
        )
      : []

  return {
    floorOptions,
    sectionOptions,
    rowOptions,
    numberOptions,
  }
}

export function getSeatFilterWarnings(
  layout: TheaterSeatLayout,
  seatFilter: ReviewBoardSeatFilter,
) {
  const warnings: string[] = []
  const { rowOptions, numberOptions } = getTheaterFilterOptions(layout, seatFilter)
  const parsedRows = parseSeatRangeInput(seatFilter.row)
  const parsedNumbers = parseSeatRangeInput(seatFilter.number)

  if (parsedRows.kind === "invalid") {
    warnings.push("열은 10 또는 10~12 형식으로 입력해주세요.")
  } else if (parsedRows.values.length > 0 && rowOptions.length > 0) {
    const missingRows = parsedRows.values.filter((row) => !rowOptions.includes(row))

    if (missingRows.length > 0) {
      warnings.push(`존재하지 않는 열입니다: ${missingRows.join(", ")}`)
    }
  }

  if (parsedNumbers.kind === "invalid") {
    warnings.push("번호는 1 또는 1~5 형식으로 입력해주세요.")
  } else if (parsedNumbers.values.length > 0 && numberOptions.length > 0) {
    const missingNumbers = parsedNumbers.values.filter((number) => !numberOptions.includes(number))

    if (missingNumbers.length > 0) {
      warnings.push(`존재하지 않는 번호입니다: ${missingNumbers.join(", ")}`)
    }
  }

  return warnings
}
