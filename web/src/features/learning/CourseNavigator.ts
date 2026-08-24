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
  const next = orderedVideos[currentIndex + 1];

  return createElement(
    "nav",
    { className: "course-navigator", "aria-label": "현재 코스 순서" },
    createElement(
      "header",
      null,
      createElement(
        "div",
        null,
        createElement("small", null, "학습 코스"),
        createElement("strong", null, current.course?.title ?? "이어 보는 영상"),
      ),
      createElement("span", null, `${currentIndex + 1} / ${orderedVideos.length}`),
    ),
    createElement(
      "ol",
      null,
      ...orderedVideos.map((video, index) => {
        const active = video.videoId === currentVideoId;
        return createElement(
          "li",
          { key: `${video.course?.id ?? "course"}-${video.videoId}` },
          createElement(
            "button",
            {
              "aria-current": active ? "step" : undefined,
              className: active ? "active" : "",
              onClick: () => onSelect(video),
              type: "button",
            },
            createElement("span", null, String(index + 1)),
            createElement("strong", null, video.title),
            createElement("small", null, active ? "지금 학습 중" : "이동"),
          ),
        );
      }),
    ),
    next
      ? createElement(
          "button",
          {
            className: "course-next-action",
            onClick: () => onSelect(next),
            type: "button",
          },
          createElement("span", null, "다음으로"),
          createElement("strong", null, next.title),
        )
      : null,
  );
}
