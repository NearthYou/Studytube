import {
  getSeatFilterWarnings,
  getTheaterFilterOptions,
  parseSeatRangeInput,
} from "./theater-review-filter-options.ts";
import type { TheaterSeatLayout } from "./types.ts";

function assertDeepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const layout: TheaterSeatLayout = {
  floors: [
    { value: "1층", label: "1층" },
    { value: "2층", label: "2층" },
    { value: "3층", label: "3층" },
  ],
  sectionsByFloor: {
    "1층": [{ value: "A", label: "A구역" }],
    "2층": [{ value: "B", label: "B구역" }],
    "3층": [{ value: "C", label: "C구역" }],
  },
  rowsByFloorAndSection: {
    "3층::C": [
      { value: "10", label: "10열" },
      { value: "11", label: "11열" },
      { value: "12", label: "12열" },
    ],
  },
  numbersBySeatLine: {
    "3층::C::10": [
      { value: "1", label: "1번" },
      { value: "2", label: "2번" },
    ],
    "3층::C::11": [
      { value: "1", label: "1번" },
      { value: "2", label: "2번" },
      { value: "3", label: "3번" },
    ],
    "3층::C::12": [
      { value: "2", label: "2번" },
      { value: "3", label: "3번" },
    ],
  },
};

assertDeepEqual(parseSeatRangeInput("10"), { kind: "single", values: ["10"] });
assertDeepEqual(parseSeatRangeInput("10~12"), {
  kind: "range",
  values: ["10", "11", "12"],
});
assertDeepEqual(parseSeatRangeInput("12~10"), {
  kind: "range",
  values: ["10", "11", "12"],
});
assertDeepEqual(parseSeatRangeInput("abc"), { kind: "invalid", values: [] });

assertDeepEqual(
  getTheaterFilterOptions(layout, {
    floor: "",
    section: "",
    row: "",
    number: "",
  }),
  {
    floorOptions: ["1층", "2층", "3층"],
    sectionOptions: ["A", "B", "C"],
    rowOptions: [],
    numberOptions: [],
  },
);

assertDeepEqual(
  getTheaterFilterOptions(layout, {
    floor: "3층",
    section: "C",
    row: "10~12",
    number: "",
  }).numberOptions,
  ["1", "2", "3"],
);

assertDeepEqual(
  getSeatFilterWarnings(layout, {
    floor: "3층",
    section: "C",
    row: "10~12",
    number: "1~3",
  }),
  [],
);

assertDeepEqual(
  getSeatFilterWarnings(layout, {
    floor: "3층",
    section: "C",
    row: "10~13",
    number: "1~4",
  }),
  ["존재하지 않는 열입니다: 13", "존재하지 않는 번호입니다: 4"],
);

console.log("theater-review-filter-options tests passed.");
