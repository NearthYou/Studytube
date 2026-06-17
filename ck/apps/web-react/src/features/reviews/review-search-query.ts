import type { SeatReviewSearchParams, SeatReviewSearchSort } from "./types";

export type ReviewBoardSearchFilter = {
  id: string;
  label: string;
  mode: "theater" | "work" | "tag";
};

export type ReviewBoardSortKey =
  | "latest"
  | "oldest"
  | "popular"
  | "rating"
  | "viewHigh"
  | "soundHigh"
  | "comfortHigh"
  | "expressionHigh"
  | "stageVisibilityHigh";

export type ReviewBoardSeatFilter = {
  floor: string;
  section: string;
  row: string;
  number: string;
};

export type ReviewBoardSearchState = {
  page: number;
  limit: number;
  searchText: string;
  fixedTheaterId?: string;
  fixedPerformanceId?: string;
  activeFilterMode?: ReviewBoardSearchFilter["mode"] | null;
  filterSearchText?: string;
  selectedFilter: ReviewBoardSearchFilter | null;
  selectedTagIds?: string[];
  seatFilter: ReviewBoardSeatFilter;
  sortKey: ReviewBoardSortKey;
};

const sortKeyToApiSort: Record<ReviewBoardSortKey, SeatReviewSearchSort> = {
  latest: "latest",
  oldest: "oldest",
  popular: "popular",
  rating: "rating",
  viewHigh: "view",
  soundHigh: "sound",
  comfortHigh: "comfort",
  expressionHigh: "expression",
  stageVisibilityHigh: "stageVisibility",
};

const searchParamOrder: Array<keyof SeatReviewSearchParams> = [
  "page",
  "limit",
  "q",
  "theaterId",
  "theater",
  "musicalId",
  "musical",
  "performanceId",
  "seasonLabel",
  "seatFloor",
  "seatSection",
  "seatRow",
  "seatRowFrom",
  "seatRowTo",
  "seatNumber",
  "seatNumberFrom",
  "seatNumberTo",
  "tagId",
  "tagIds",
  "tag",
  "hasObstruction",
  "minViewRating",
  "minSoundRating",
  "minComfortRating",
  "minExpressionRating",
  "minStageVisibilityRating",
  "sort",
];

function normalizeText(value: string) {
  return value.trim();
}

function parseNumericRange(value: string) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  const rangeMatch = normalizedValue.match(/^(\d+)\s*[~-]\s*(\d+)$/);

  if (!rangeMatch) {
    return null;
  }

  const first = Number(rangeMatch[1]);
  const second = Number(rangeMatch[2]);

  return {
    from: Math.min(first, second),
    to: Math.max(first, second),
  };
}

export function buildSeatReviewSearchQuery(
  state: ReviewBoardSearchState,
): SeatReviewSearchParams {
  const query: SeatReviewSearchParams = {
    page: state.page,
    limit: state.limit,
  };
  const q = normalizeText(state.searchText);
  const { selectedFilter, seatFilter } = state;

  if (q) {
    query.q = q;
  }

  if (state.fixedTheaterId) {
    query.theaterId = state.fixedTheaterId;
  } else if (selectedFilter?.mode === "theater") {
    query.theater = selectedFilter.label;
  }

  if (state.fixedPerformanceId) {
    query.performanceId = state.fixedPerformanceId;
  } else if (selectedFilter?.mode === "work") {
    query.performanceId = selectedFilter.id;
  }

  if (state.selectedTagIds && state.selectedTagIds.length > 0) {
    query.tagIds = state.selectedTagIds.join(",");
  } else if (selectedFilter?.mode === "tag") {
    query.tagId = selectedFilter.id;
  }

  const filterText = normalizeText(state.filterSearchText ?? "");

  if (
    !state.fixedTheaterId &&
    !selectedFilter &&
    filterText &&
    state.activeFilterMode === "theater"
  ) {
    query.theater = filterText;
  }

  if (!selectedFilter && filterText && state.activeFilterMode === "work") {
    query.musical = filterText;
  }

  if (!selectedFilter && filterText && state.activeFilterMode === "tag") {
    query.tag = filterText;
  }

  if (seatFilter.floor) {
    query.seatFloor = seatFilter.floor;
  }

  if (seatFilter.section) {
    query.seatSection = seatFilter.section;
  }

  if (seatFilter.row) {
    const rowRange = parseNumericRange(seatFilter.row);

    if (rowRange) {
      query.seatRowFrom = rowRange.from;
      query.seatRowTo = rowRange.to;
    } else {
      query.seatRow = normalizeText(seatFilter.row);
    }
  }

  if (seatFilter.number) {
    const numberRange = parseNumericRange(seatFilter.number);

    if (numberRange) {
      query.seatNumberFrom = numberRange.from;
      query.seatNumberTo = numberRange.to;
    } else {
      query.seatNumber = normalizeText(seatFilter.number);
    }
  }

  query.sort = sortKeyToApiSort[state.sortKey];

  return query;
}

export function buildSeatReviewSearchPath(params: SeatReviewSearchParams): string;
export function buildSeatReviewSearchPath(state: ReviewBoardSearchState): string;
export function buildSeatReviewSearchPath(
  input: SeatReviewSearchParams | ReviewBoardSearchState,
) {
  const query = "seatFilter" in input ? buildSeatReviewSearchQuery(input) : input;
  const searchParams = new URLSearchParams();

  searchParamOrder.forEach((key) => {
    const value = query[key];

    if (value === undefined || value === null || value === "") {
      return;
    }

    searchParams.set(key, String(value));
  });

  const queryString = searchParams.toString();
  return queryString ? `/seat-reviews/search?${queryString}` : "/seat-reviews/search";
}
