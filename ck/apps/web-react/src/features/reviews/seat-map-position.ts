import type { TheaterSeatMapBlock, TheaterSeatMapConfig } from "./theater-seat-map-configs"

export type SeatHorizontalPosition = "left" | "center" | "right"

export type SeatPositionLookupInput = {
  theaterName: string
  floor: string
  section?: string | null
  row: string
  number: string
}

export function makeSeatPositionKey(
  floor: string,
  section: string | null | undefined,
  row: string,
  number: string,
) {
  return `${floor}::${section ?? ""}::${row}::${number}`
}

export function getBlockBandKey(block: TheaterSeatMapBlock) {
  const sectionClassMatch = block.sourceClass.replace(/\s/g, "").match(/^[A-Z]+(\d+)([A-Z]*)$/i)

  if (sectionClassMatch) {
    const [, numericBand, suffix] = sectionClassMatch
    return `${numericBand.at(-1)}${suffix}`
  }

  return block.sourceClass.replace(/\s/g, "").match(/\d+[A-Z]*$/i)?.[0] ?? block.sourceClass
}

export function groupBlocksByBand(blocks: TheaterSeatMapBlock[]) {
  const groupedBlocks = new Map<string, TheaterSeatMapBlock[]>()

  blocks.forEach((block) => {
    const bandKey = getBlockBandKey(block)
    const blockRow = groupedBlocks.get(bandKey)

    if (blockRow) {
      blockRow.push(block)
      return
    }

    groupedBlocks.set(bandKey, [block])
  })

  return Array.from(groupedBlocks.values())
}

function getBlockCenterRatio(blockRow: TheaterSeatMapBlock[], blockIndex: number) {
  const blockWidths = blockRow.map((block) =>
    Math.max(...block.rows.map((row) => row.cells.length), 1),
  )
  const totalWidth = blockWidths.reduce((sum, width) => sum + width, 0)
  const previousWidth = blockWidths
    .slice(0, blockIndex)
    .reduce((sum, width) => sum + width, 0)

  return (previousWidth + blockWidths[blockIndex] / 2) / totalWidth
}

export function getBlockHorizontalPosition(
  blockRow: TheaterSeatMapBlock[],
  blockIndex: number,
): SeatHorizontalPosition {
  const centerRatio = getBlockCenterRatio(blockRow, blockIndex)

  if (centerRatio < 1 / 3) {
    return "left"
  }

  if (centerRatio > 2 / 3) {
    return "right"
  }

  return "center"
}

function isCopyrightSeatNumber(value: string) {
  return value.toLowerCase().includes("copyright")
}

export function getSeatHorizontalPosition(
  config: TheaterSeatMapConfig,
  seat: Omit<SeatPositionLookupInput, "theaterName">,
) {
  const floor = config.floors.find((item) => item.floor === seat.floor)

  if (!floor) {
    return null
  }

  const section = seat.section?.trim().toUpperCase() ?? ""
  const row = seat.row.trim().toUpperCase()
  const number = seat.number.trim()

  for (const blockRow of groupBlocksByBand(floor.blocks)) {
    for (const [blockIndex, block] of blockRow.entries()) {
      const blockSection = block.section.trim().toUpperCase()

      if (section && blockSection !== section) {
        continue
      }

      const matchingRow = block.rows.find((item) => item.row.trim().toUpperCase() === row)
      const hasSeat = matchingRow?.cells.some(
        (cell) =>
          cell.type === "seat" &&
          !isCopyrightSeatNumber(cell.number) &&
          cell.number.trim() === number,
      )

      if (hasSeat) {
        return getBlockHorizontalPosition(blockRow, blockIndex)
      }
    }
  }

  return null
}

export function getSeatHorizontalPositionLabel(position: SeatHorizontalPosition | null) {
  if (position === "left") {
    return "왼쪽"
  }

  if (position === "center") {
    return "중앙"
  }

  if (position === "right") {
    return "오른쪽"
  }

  return "알 수 없음"
}

export function buildSeatPositionMap(config: TheaterSeatMapConfig) {
  const seatPositions: Record<string, SeatHorizontalPosition> = {}

  config.floors.forEach((floor) => {
    groupBlocksByBand(floor.blocks).forEach((blockRow) => {
      blockRow.forEach((block, blockIndex) => {
        const position = getBlockHorizontalPosition(blockRow, blockIndex)

        block.rows.forEach((row) => {
          row.cells.forEach((cell) => {
            if (cell.type !== "seat" || isCopyrightSeatNumber(cell.number)) {
              return
            }

            seatPositions[
              makeSeatPositionKey(floor.floor, block.section, row.row, cell.number)
            ] = position
          })
        })
      })
    })
  })

  return seatPositions
}
