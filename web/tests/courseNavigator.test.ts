import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { QueueVideo } from "../src/watchQueue.ts";

function video(position: number): QueueVideo {
  return {
    id: `course-video-${position}`,
    title: position === 1 ? "첫 영상" : "다음 영상",
    videoId: position === 1 ? "SqcY0GlETPk" : "sHS1z9Pr4v8",
    videoUrl: `https://www.youtube.com/watch?v=${position === 1 ? "SqcY0GlETPk" : "sHS1z9Pr4v8"}`,
    thumbnailUrl: "",
    channelName: "Study Channel",
    summary: "",
    translatedNotes: "",
    source: "course",
    course: {
      id: "course-7",
      title: "여행 회화 코스",
      position,
      total: 2,
    },
  };
}

test("keeps course navigation compact around the current video", async () => {
  let CourseNavigator:
    | ((props: {
        currentVideoId: string;
        onSelect: (video: QueueVideo) => void;
        videos: QueueVideo[];
      }) => ReturnType<typeof createElement>)
    | undefined;

  try {
    ({ CourseNavigator } = await import(
      "../src/features/learning/CourseNavigator.ts"
    ));
  } catch {
    assert.fail("학습 화면에 코스 순서를 보여주는 구성 요소가 없습니다.");
  }

  const html = renderToStaticMarkup(
    createElement(CourseNavigator, {
      currentVideoId: "SqcY0GlETPk",
      onSelect: () => undefined,
      videos: [video(1), video(2)],
    }),
  );

  assert.match(html, /여행 회화 코스/);
  assert.match(html, /1 \/ 2/);
  assert.match(html, /다음 영상/);
  assert.match(html, />다음</);
  assert.match(html, /코스 목록/);
  assert.doesNotMatch(html, /<ol/);

  const finalHtml = renderToStaticMarkup(
    createElement(CourseNavigator, {
      currentVideoId: "sHS1z9Pr4v8",
      onSelect: () => undefined,
      videos: [video(1), video(2)],
    }),
  );
  assert.match(finalHtml, />이전</);
  assert.doesNotMatch(finalHtml, />다음</);
});
