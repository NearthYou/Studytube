import {
  mergeSeatOptions,
  sortSeatOptions,
  sortSectionOptions,
} from "./seat-layout-options.ts";

function assertDeepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

assertDeepEqual(
  mergeSeatOptions(undefined, ["1", "2"], "열"),
  [
    { value: "1", label: "1열" },
    { value: "2", label: "2열" },
  ],
);

assertDeepEqual(
  mergeSeatOptions(
    [
      { value: "1", label: "1열" },
      { value: "2", label: "2열" },
    ],
    ["2", "3"],
    "열",
  ),
  [
    { value: "1", label: "1열" },
    { value: "2", label: "2열" },
    { value: "3", label: "3열" },
  ],
);

assertDeepEqual(
  sortSectionOptions([
    { value: "C", label: "C구역" },
    { value: "A", label: "A구역" },
    { value: "OP", label: "OP구역" },
    { value: "B", label: "B구역" },
  ]),
  [
    { value: "OP", label: "OP구역" },
    { value: "A", label: "A구역" },
    { value: "B", label: "B구역" },
    { value: "C", label: "C구역" },
  ],
);

assertDeepEqual(
  sortSectionOptions([
    { value: "가", label: "가구역" },
    { value: "A", label: "A구역" },
    { value: "B", label: "B구역" },
    { value: "C", label: "C구역" },
    { value: "나", label: "나구역" },
  ]),
  [
    { value: "가", label: "가구역" },
    { value: "A", label: "A구역" },
    { value: "B", label: "B구역" },
    { value: "C", label: "C구역" },
    { value: "나", label: "나구역" },
  ],
);

assertDeepEqual(
  sortSectionOptions([
    { value: "BL", label: "BL구역" },
    { value: "B", label: "B구역" },
    { value: "BR", label: "BR구역" },
  ]),
  [
    { value: "BL", label: "BL구역" },
    { value: "B", label: "B구역" },
    { value: "BR", label: "BR구역" },
  ],
);

assertDeepEqual(
  sortSeatOptions([
    { value: "10", label: "10열" },
    { value: "2", label: "2열" },
    { value: "1", label: "1열" },
  ]),
  [
    { value: "1", label: "1열" },
    { value: "2", label: "2열" },
    { value: "10", label: "10열" },
  ],
);

console.log("seat-layout-options tests passed.");
