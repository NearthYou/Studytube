import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoSummaryDetails,
  buildVideoSummaryDetailsFromAsset,
  clipText,
  formatTime,
  formatVideoSummarySections,
  parseTimestampedSummaryText,
} from "../src/videoSummaryDetails.ts";
import type { VideoAsset } from "../src/types.ts";
import type { QueueVideo } from "../src/watchQueue.ts";

function video(input: Partial<QueueVideo> = {}): QueueVideo {
  return {
    id: "post-1",
    title: "React Hooks",
    videoId: "abc123",
    videoUrl: "https://www.youtube.com/watch?v=abc123",
    thumbnailUrl: "thumb.jpg",
    channelName: "React Channel",
    summary: "A concise summary.",
    translatedNotes: "0:05 First idea. 1:10 Second idea.",
    source: "board",
    ...input,
  };
}

function videoAsset(input: Partial<VideoAsset> = {}): VideoAsset {
  return {
    id: 7,
    postId: 11,
    videoId: "abc123",
    videoUrl: "https://www.youtube.com/watch?v=abc123",
    language: "ko",
    sourceLanguage: "en",
    status: "ready",
    sourceCaptionStatus: "ready",
    translationStatus: "ready",
    summaryStatus: "ready",
    sourceSegments: [],
    translatedSegments: [],
    summarySections: [{ label: "핵심 요약", body: "React 훅의 역할을 정리합니다." }],
    transcriptBody: "00:00 리액트 훅을 소개합니다.\n00:12 상태 관리 예시를 살펴봅니다.",
    errorMessage: "",
    updatedAt: "2026-06-17T00:00:00.000Z",
    ...input,
  };
}

test("formats summary sections from API responses", () => {
  assert.equal(
    formatVideoSummarySections([
      { label: "Intro", body: "Start here" },
      { label: " ", body: "Ignored" },
      { label: "Next", body: "Continue" },
    ]),
    "Intro\nStart here\n\nNext\nContinue",
  );
});

test("builds readable summary details with timed blocks", () => {
  const details = buildVideoSummaryDetails(video());

  assert.deepEqual(
    details.map((item) => [item.label, item.body]),
    [
      ["핵심 요약", "A concise summary."],
      ["0:05", "First idea."],
      ["1:10", "Second idea."],
    ],
  );
});

test("groups dense transcript timestamps into readable summary intervals", () => {
  const details = buildVideoSummaryDetails(
    video({
      summary: "",
      translatedNotes:
        "0:00 Intro. 0:04 Detail. 0:09 Example. 1:04 Next topic.",
    }),
  );

  assert.deepEqual(
    details.map((item) => [item.label, item.body]),
    [
      ["0:00", "Intro. Detail. Example."],
      ["1:04", "Next topic."],
    ],
  );
});

test("falls back when summary text is unreadable", () => {
  const details = buildVideoSummaryDetails(
    video({ summary: "??", translatedNotes: "AI 분석 요약:\n??" }),
  );

  assert.equal(details[0].label, "요약 준비 중");
});

test("formats timestamped full transcript as a multiline section", () => {
  assert.equal(
    formatVideoSummarySections([
      {
        label: "전체 스크립트 전사문",
        body: "00:00 첫 문장입니다.\n00:04 두 번째 문장입니다.",
      },
    ]),
    "전체 스크립트 전사문\n00:00 첫 문장입니다.\n00:04 두 번째 문장입니다.",
  );
});

test("builds asset summary details and appends the full transcript section", () => {
  const details = buildVideoSummaryDetailsFromAsset(videoAsset());

  assert.deepEqual(details, [
    { label: "핵심 요약", body: "React 훅의 역할을 정리합니다." },
    {
      label: "전체 스크립트 전사문",
      body: "00:00 리액트 훅을 소개합니다.\n00:12 상태 관리 예시를 살펴봅니다.",
    },
  ]);
});

test("does not duplicate an asset transcript section already returned by the API", () => {
  const details = buildVideoSummaryDetailsFromAsset(
    videoAsset({
      summarySections: [
        { label: "전체 스크립트 전사문", body: "00:00 이미 포함된 전사문입니다." },
      ],
      transcriptBody: "00:00 이미 포함된 전사문입니다.",
    }),
  );

  assert.deepEqual(details, [
    { label: "전체 스크립트 전사문", body: "00:00 이미 포함된 전사문입니다." },
  ]);
});

test("parses transcript timestamps into seekable summary parts", () => {
  const parts = parseTimestampedSummaryText(
    "00:00 첫 문장입니다.\n01:04 두 번째 문장입니다.\n1:02:03 긴 강의 위치입니다.",
  );

  assert.deepEqual(parts, [
    { type: "timestamp", text: "00:00", seconds: 0 },
    { type: "text", text: " 첫 문장입니다.\n" },
    { type: "timestamp", text: "01:04", seconds: 64 },
    { type: "text", text: " 두 번째 문장입니다.\n" },
    { type: "timestamp", text: "1:02:03", seconds: 3723 },
    { type: "text", text: " 긴 강의 위치입니다." },
  ]);
});

test("formats player time and clips dense copy consistently", () => {
  assert.equal(formatTime(75.8), "1:15");
  assert.equal(formatTime(3723), "1:02:03");
  assert.equal(clipText("  one   two   three  ", 7), "one two...");
  assert.equal(clipText("short", 20), "short");
});
