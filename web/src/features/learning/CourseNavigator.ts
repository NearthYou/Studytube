import { createElement } from "react";
import type { QueueVideo } from "../../watchQueue.ts";

export function CourseNavigator({
  currentVideoId,
  onSelect,
  videos,
}: {
  currentVideoId: string;
  onSelect: (video: QueueVideo) => void;
  videos: QueueVideo[];
}) {
  if (videos.length < 2) return null;

  const orderedVideos = [...videos].sort(
    (left, right) =>
      (left.course?.position ?? 0) - (right.course?.position ?? 0),
  );
  const foundIndex = orderedVideos.findIndex(
    (video) => video.videoId === currentVideoId,
  );
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  const current = orderedVideos[currentIndex];
  const previous = orderedVideos[currentIndex - 1];
  const next = orderedVideos[currentIndex + 1];

  return createElement(
    "nav",
    { className: "course-navigator", "aria-label": "현재 코스 순서" },
    createElement(
      "div",
      { className: "course-navigator-summary" },
      createElement(
        "div",
        null,
        createElement("strong", null, current.course?.title ?? "이어 보는 영상"),
        createElement(
          "span",
          null,
          `${currentIndex + 1} / ${orderedVideos.length}`,
        ),
      ),
    ),
    createElement(
      "div",
      { className: "course-navigator-actions" },
      previous
        ? createElement(
          "button",
          {
            "aria-label": `이전 영상: ${previous.title}`,
            className: "secondary-action",
            onClick: () => onSelect(previous),
            type: "button",
          },
          "이전",
        )
        : null,
      next
        ? createElement(
          "button",
          {
            "aria-label": `다음 영상: ${next.title}`,
            onClick: () => onSelect(next),
            type: "button",
          },
          "다음",
        )
        : null,
      createElement("a", { href: "/courses" }, "코스 목록"),
    ),
  );
}
