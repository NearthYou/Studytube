import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoSummaryDetails,
  clipText,
  formatTime,
  formatVideoSummarySections,
} from "../src/videoSummaryDetails.ts";
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

test("formats player time and clips dense copy consistently", () => {
  assert.equal(formatTime(75.8), "1:15");
  assert.equal(clipText("  one   two   three  ", 7), "one two...");
  assert.equal(clipText("short", 20), "short");
});
