import {
  getTheaterSeatMapConfig,
  type TheaterSeatMapConfig,
} from "./theater-seat-map-configs"
import { buildSeatPositionMap } from "./seat-map-position"
import { makeSeatOption, mergeSeatOptions, sortSectionOptions } from "./seat-layout-options"
import type { SeatOption, TheaterOption, TheaterSeatLayout } from "./types"

function makeOption(value: string, suffix = ""): SeatOption {
  return makeSeatOption(value, suffix)
}

export function makeFloorSectionKey(floor: string, section: string) {
  return `${floor}::${section}`
}

export function makeSeatLineKey(floor: string, section: string, row: string) {
  return `${floor}::${section}::${row}`
}

function uniqueOptions(values: string[], suffix = "") {
  return sortSectionOptions(Array.from(new Set(values)).map((value) => makeOption(value, suffix)))
}

function isCopyrightSeatNumber(value: string) {
  return value.toLowerCase().includes("copyright")
}

function buildLayoutFromSeatMap(config: TheaterSeatMapConfig): TheaterSeatLayout {
  const sectionsByFloor: TheaterSeatLayout["sectionsByFloor"] = {}
  const rowsByFloorAndSection: NonNullable<TheaterSeatLayout["rowsByFloorAndSection"]> = {}
  const numbersBySeatLine: NonNullable<TheaterSeatLayout["numbersBySeatLine"]> = {}

  config.floors.forEach((floor) => {
    sectionsByFloor[floor.floor] = uniqueOptions(
      floor.blocks.map((block) => block.section),
      "구역",
    )

    floor.blocks.forEach((block) => {
      const floorSectionKey = makeFloorSectionKey(floor.floor, block.section)
      rowsByFloorAndSection[floorSectionKey] = mergeSeatOptions(
        rowsByFloorAndSection[floorSectionKey],
        block.rows.map((row) => row.row),
        "열",
      )

      block.rows.forEach((row) => {
        const seatLineKey = makeSeatLineKey(floor.floor, block.section, row.row)
        numbersBySeatLine[seatLineKey] = mergeSeatOptions(
          numbersBySeatLine[seatLineKey],
          row.cells
            .filter((cell) => cell.type === "seat")
            .filter((cell) => !isCopyrightSeatNumber(cell.number))
            .map((cell) => cell.number),
          "번",
        )
      })
    })
  })

  return {
    floors: config.floors.map((floor) => makeOption(floor.floor)),
    sectionsByFloor,
    rowsByFloorAndSection,
    numbersBySeatLine,
    positionBySeat: buildSeatPositionMap(config),
  }
}

const fallbackLayout: TheaterSeatLayout = {
  floors: [makeOption("1층"), makeOption("2층")],
  sectionsByFloor: {
    "1층": [makeOption("A", "구역"), makeOption("B", "구역"), makeOption("C", "구역")],
    "2층": [makeOption("A", "구역"), makeOption("B", "구역"), makeOption("C", "구역")],
  },
}

export function getTheaterSeatLayout(theater: TheaterOption | null): TheaterSeatLayout {
  if (!theater) {
    return fallbackLayout
  }

  const config = getTheaterSeatMapConfig(theater.name)

  return config ? buildLayoutFromSeatMap(config) : fallbackLayout
}
