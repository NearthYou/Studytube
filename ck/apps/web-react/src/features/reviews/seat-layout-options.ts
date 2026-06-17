import type { SeatOption } from "./types"

export function makeSeatOption(value: string, suffix = ""): SeatOption {
  return {
    value,
    label: suffix ? `${value}${suffix}` : value,
  }
}

function getSeatOptionSortRank(value: string) {
  const normalizedValue = value.trim().toUpperCase()

  if (normalizedValue === "OP") {
    return 0
  }

  if (normalizedValue.startsWith("BOX")) {
    return 1
  }

  if (normalizedValue.startsWith("FAMILY")) {
    return 2
  }

  return 3
}

function compareSeatOptionValues(a: string, b: string) {
  const aRank = getSeatOptionSortRank(a)
  const bRank = getSeatOptionSortRank(b)

  if (aRank !== bRank) {
    return aRank - bRank
  }

  return a.localeCompare(b, "ko-KR", { numeric: true, sensitivity: "base" })
}

function hasKorean(value: string) {
  return /[가-힣]/.test(value)
}

function hasLatin(value: string) {
  return /[A-Za-z]/.test(value)
}

function compareSectionValues(a: string, b: string) {
  const sideSectionPattern = /^([A-Z]+)(L|R)$/i
  const aSideSectionMatch = a.match(sideSectionPattern)
  const bSideSectionMatch = b.match(sideSectionPattern)
  const aBase = aSideSectionMatch?.[1]?.toUpperCase() ?? a.toUpperCase()
  const bBase = bSideSectionMatch?.[1]?.toUpperCase() ?? b.toUpperCase()

  if (aBase === bBase) {
    const sideRank = (value: string) => {
      const side = value.match(sideSectionPattern)?.[2]?.toUpperCase()
      if (side === "L") {
        return 0
      }
      if (!side) {
        return 1
      }
      return 2
    }

    return sideRank(a) - sideRank(b)
  }

  return compareSeatOptionValues(a, b)
}

export function sortSeatOptions(options: SeatOption[]) {
  return [...options].sort((a, b) => compareSeatOptionValues(a.value, b.value))
}

export function sortSectionOptions(options: SeatOption[]) {
  const hasKoreanSection = options.some((option) => hasKorean(option.value))
  const hasLatinSection = options.some((option) => hasLatin(option.value))

  if (hasKoreanSection && hasLatinSection) {
    return [...options]
  }

  return [...options].sort((a, b) => compareSectionValues(a.value, b.value))
}

export function mergeSeatOptions(
  currentOptions: SeatOption[] | undefined,
  values: string[],
  suffix = "",
) {
  const optionMap = new Map<string, SeatOption>()

  currentOptions?.forEach((option) => {
    optionMap.set(option.value, option)
  })

  values.forEach((value) => {
    if (!optionMap.has(value)) {
      optionMap.set(value, makeSeatOption(value, suffix))
    }
  })

  return sortSeatOptions(Array.from(optionMap.values()))
}
