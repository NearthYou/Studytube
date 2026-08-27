import assert from "node:assert/strict";
import test from "node:test";
import { youtubePlayerVars } from "../src/features/learning/youtubePlayerOptions.ts";

test("a saved playback position is cued without imperative autoplay", () => {
  assert.deepEqual(youtubePlayerVars(346.8), {
    rel: 0,
    playsinline: 1,
    enablejsapi: 1,
    cc_load_policy: 0,
    start: 346,
  });
});

test("an invalid saved position starts from the beginning", () => {
  assert.equal(youtubePlayerVars(-12).start, 0);
  assert.equal(youtubePlayerVars(Number.NaN).start, 0);
});
