import type { QueueVideo } from "../../watchQueue.ts";

export function courseNavigatorModel(
  videos: QueueVideo[],
  currentVideoId: string,
) {
  const orderedVideos = [...videos].sort(
    (left, right) =>
      (left.course?.position ?? 0) - (right.course?.position ?? 0),
  );
  const foundIndex = orderedVideos.findIndex(
    (video) => video.videoId === currentVideoId,
  );
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  return {
    orderedVideos,
    currentIndex,
    current: orderedVideos[currentIndex],
    previous: orderedVideos[currentIndex - 1],
    next: orderedVideos[currentIndex + 1],
  };
}
