import {
  getCanonicalTheaterName,
  theaterSeatMapNames,
  theaterSeatMapOptions,
} from "./theater-seat-map-index.ts";
import type { PublicSeatReview, TheaterOption } from "./types";

export type ReviewBoardFilter = {
  id: string;
  label: string;
  mode: "theater" | "work" | "tag";
  hasSeatMap?: boolean;
  aliases?: string[];
};

export function getReviewTags(review: PublicSeatReview) {
  return review.tags ?? [];
}

export function canOpenTheaterReviewPage(filter: ReviewBoardFilter | null) {
  return Boolean(filter?.mode === "theater" && !filter.id.startsWith("seat-map:"));
}

export function getReviewBoardTheaterFilters(input: {
  reviews: PublicSeatReview[];
  theaters: TheaterOption[];
  query: string;
}) {
  const normalizedQuery = input.query.trim().toLowerCase();
  const options = new Map<string, ReviewBoardFilter>();

  function matchesQuery(...labels: string[]) {
    return labels.some((label) => label.toLowerCase().includes(normalizedQuery));
  }

  function setOption(option: ReviewBoardFilter) {
    const key = `theater:${option.label}`;
    const existing = options.get(key);

    options.set(key, {
      ...option,
      id: existing && !existing.id.startsWith("seat-map:") ? existing.id : option.id,
      aliases: Array.from(new Set([...(existing?.aliases ?? []), ...(option.aliases ?? [])])),
      hasSeatMap: existing?.hasSeatMap || option.hasSeatMap,
    });
  }

  input.reviews.forEach((review) => {
    const rawLabel = review.theater.name;
    const label = getCanonicalTheaterName(rawLabel);

    if (!rawLabel || !label || (normalizedQuery && !matchesQuery(label, rawLabel))) {
      return;
    }

    setOption({
      id: review.theater.id,
      label,
      mode: "theater",
      hasSeatMap: theaterSeatMapNames.has(label),
      aliases: [rawLabel, label],
    });
  });

  input.theaters.forEach((theater) => {
    const rawLabel = theater.name;
    const label = getCanonicalTheaterName(rawLabel);

    if (!rawLabel || !label || (normalizedQuery && !matchesQuery(label, rawLabel))) {
      return;
    }

    setOption({
      id: theater.id,
      label,
      mode: "theater",
      hasSeatMap: theaterSeatMapNames.has(label),
      aliases: [rawLabel, label],
    });
  });

  theaterSeatMapOptions.forEach((theater) => {
    const label = getCanonicalTheaterName(theater.label);

    if (normalizedQuery && !matchesQuery(label, theater.label)) {
      return;
    }

    setOption({
      id: theater.id,
      label,
      mode: "theater",
      aliases: [theater.label, label],
      hasSeatMap: true,
    });
  });

  return Array.from(options.values());
}

function getSearchText(review: PublicSeatReview) {
  return [review.content, ...getReviewTags(review).map((tag) => tag.name)].join(" ").toLowerCase();
}

export function matchesReviewBoardFilter(
  review: PublicSeatReview,
  selectedFilter: ReviewBoardFilter | null,
) {
  if (!selectedFilter) {
    return true;
  }

  if (selectedFilter.mode === "theater") {
    const canonicalTheaterName = getCanonicalTheaterName(review.theater.name);

    return (
      review.theater.id === selectedFilter.id ||
      canonicalTheaterName === selectedFilter.label ||
      Boolean(selectedFilter.aliases?.includes(review.theater.name))
    );
  }

  if (selectedFilter.mode === "work") {
    return review.performance?.id === selectedFilter.id;
  }

  return getReviewTags(review).some((tag) => tag.id === selectedFilter.id);
}

export function getSeatFilterScopeReviews(
  reviews: PublicSeatReview[],
  input: {
    searchText: string;
    selectedFilter: ReviewBoardFilter | null;
  },
) {
  const normalizedSearchText = input.searchText.trim().toLowerCase();

  return reviews.filter((review) => {
    if (normalizedSearchText && !getSearchText(review).includes(normalizedSearchText)) {
      return false;
    }

    return matchesReviewBoardFilter(review, input.selectedFilter);
  });
}

function getFirstNumber(value: string) {
  return value.match(/\d+/)?.[0];
}

function compareSeatValues(a: string, b: string) {
  const aNumber = getFirstNumber(a);
  const bNumber = getFirstNumber(b);

  if (aNumber && bNumber && Number(aNumber) !== Number(bNumber)) {
    return Number(aNumber) - Number(bNumber);
  }

  if (aNumber && !bNumber) {
    return -1;
  }

  if (!aNumber && bNumber) {
    return 1;
  }

  return a.localeCompare(b, "ko-KR", { numeric: true, sensitivity: "base" });
}

export function getSortedUniqueSeatValues(
  reviews: PublicSeatReview[],
  getValue: (review: PublicSeatReview) => string | null | undefined,
) {
  return Array.from(
    new Set(reviews.map((review) => getValue(review)?.trim()).filter(Boolean) as string[]),
  ).sort(compareSeatValues);
}

export function getReviewBoardDisplayReviews<T>(input: {
  viewMode: "board" | "seatMap";
  visibleReviews: T[];
  seatMapReviews: T[];
}) {
  return input.viewMode === "seatMap" ? input.seatMapReviews : input.visibleReviews;
}
