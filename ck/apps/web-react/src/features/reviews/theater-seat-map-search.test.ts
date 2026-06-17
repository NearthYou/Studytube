import { buildTheaterSeatMapSearchParams } from "./theater-seat-map-search.ts"

function assertDeepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

assertDeepEqual(buildTheaterSeatMapSearchParams("blue-square"), {
  page: 1,
  limit: 50,
  theaterId: "blue-square",
  sort: "latest",
})

console.log("theater-seat-map-search tests passed.")
