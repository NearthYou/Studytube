import { groupBlocksByBand } from "./seat-map-position.ts";
import { getTheaterSeatMapConfig } from "./theater-seat-map-configs.ts";

function assertOk<T>(value: T, message: string): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

const config = getTheaterSeatMapConfig("광림아트센터 BBCH홀");

assertOk(config, "광림아트센터 BBCH홀 seat map config should exist");

const firstFloor = config.floors.find((floor) => floor.floor === "1층");
const secondFloor = config.floors.find((floor) => floor.floor === "2층");

assertOk(firstFloor, "광림아트센터 1층 config should exist");
assertOk(secondFloor, "광림아트센터 2층 config should exist");

const firstFloorGroups = groupBlocksByBand(firstFloor.blocks).map((blocks) =>
  blocks.map((block) => block.sourceClass),
);
const secondFloorGroups = groupBlocksByBand(secondFloor.blocks).map((blocks) =>
  blocks.map((block) => block.sourceClass),
);

assertOk(
  firstFloorGroups.some(
    (group) =>
      group.includes("AA1F") && group.includes("B11F") && group.includes("C11F"),
  ),
  "광림아트센터 1층 A/B/C rear blocks should render in the same horizontal band",
);

assertOk(
  secondFloorGroups.some(
    (group) => group.includes("AA2") && group.includes("B12") && group.includes("C12"),
  ),
  "광림아트센터 2층 A/B/C blocks should render in the same horizontal band",
);

console.log("seat-map-position tests passed.");
