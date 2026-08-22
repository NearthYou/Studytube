import assert from "node:assert/strict";
import test from "node:test";
import { learningSessionStorageKey } from "../src/features/learning/useLearningSession.ts";

test("scopes restored tab, playback position and note draft to one user", () => {
  assert.equal(
    learningSessionStorageKey(7, "video123456"),
    "studytube.learningSession:user-7:video123456",
  );
  assert.notEqual(
    learningSessionStorageKey(7, "video123456"),
    learningSessionStorageKey(8, "video123456"),
  );
});
