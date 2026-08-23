import assert from "node:assert/strict";
import test from "node:test";
import {
  learningSessionStorageKey,
  patchLearningSession,
  readLearningSession,
} from "../src/features/learning/useLearningSession.ts";

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

test("keeps the note position fixed while playback continues", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } as Storage;
  const notePatch = { noteDraft: "중요한 내용", notePositionSeconds: 42 };

  const saved = patchLearningSession(7, "video123456", notePatch, storage);
  patchLearningSession(7, "video123456", { currentTime: 91 }, storage);
  const restored = readLearningSession(7, "video123456", storage) as ReturnType<
    typeof readLearningSession
  > & { notePositionSeconds?: number | null };

  assert.equal(
    (saved as typeof restored).notePositionSeconds,
    42,
  );
  assert.equal(restored.currentTime, 91);
  assert.equal(restored.notePositionSeconds, 42);
});
