import assert from "node:assert/strict";
import test from "node:test";
import {
  blobToBase64,
  mergeLiveCaptionChunk,
  selectRecordingMimeType,
  type LiveCaptionChunk,
} from "../src/features/learning/liveCaptions.ts";

const first: LiveCaptionChunk = {
  ordinal: 0,
  start: 12,
  end: 20,
  sourceLanguage: "en",
  source: "Containers share the host kernel.",
  korean: "컨테이너는 호스트 커널을 공유합니다.",
};

test("live caption chunks stay ordered and idempotent", () => {
  const later: LiveCaptionChunk = {
    ...first,
    ordinal: 1,
    start: 20,
    end: 28,
    source: "Images are immutable.",
    korean: "이미지는 변경되지 않습니다.",
  };

  const merged = mergeLiveCaptionChunk([later], first);
  const replayed = mergeLiveCaptionChunk(merged, first);

  assert.deepEqual(replayed, [first, later]);
});

test("a corrected chunk replaces only the matching ordinal", () => {
  const corrected = { ...first, source: "Containers use the host kernel." };

  assert.deepEqual(mergeLiveCaptionChunk([first], corrected), [corrected]);
});

test("prefers a compact Opus recording supported by the browser", () => {
  assert.equal(
    selectRecordingMimeType((type) => type === "audio/webm;codecs=opus"),
    "audio/webm;codecs=opus",
  );
  assert.equal(selectRecordingMimeType(() => false), "");
});

test("encodes only the audio bytes sent to the server", async () => {
  assert.equal(await blobToBase64(new Blob(["test"])), "dGVzdA==");
});
