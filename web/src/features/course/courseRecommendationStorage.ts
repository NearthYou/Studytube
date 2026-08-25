import { scopedStudyStorageKeyFromStorage } from "../../localStudyStorage.ts";
import {
  isQueueVideoLike,
  normalizeQueueVideo,
  uniqueVideos,
  type QueueVideo,
} from "../../watchQueue.ts";

const RECOMMENDATION_STORAGE_KEY = "studytube.courseRecommendation";

export type CourseRecommendationDraft = {
  goal: string;
  title: string;
  videos: QueueVideo[];
  updatedAt: string;
};

export function readCourseRecommendation(
  storage: Storage = window.localStorage,
): CourseRecommendationDraft | null {
  try {
    const raw = storage.getItem(
      scopedStudyStorageKeyFromStorage(RECOMMENDATION_STORAGE_KEY, storage),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CourseRecommendationDraft>;
    const videos = Array.isArray(parsed.videos)
      ? uniqueVideos(
          parsed.videos
            .filter(isQueueVideoLike)
            .map((video) => normalizeQueueVideo(video)),
        ).slice(0, 4)
      : [];
    if (!parsed.goal || !parsed.title || videos.length === 0) return null;
    return {
      goal: parsed.goal,
      title: parsed.title,
      videos,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveCourseRecommendation(
  input: Omit<CourseRecommendationDraft, "updatedAt">,
  storage: Storage = window.localStorage,
) {
  const recommendation: CourseRecommendationDraft = {
    goal: input.goal.trim(),
    title: input.title.trim(),
    videos: uniqueVideos(input.videos).slice(0, 4),
    updatedAt: new Date().toISOString(),
  };
  storage.setItem(
    scopedStudyStorageKeyFromStorage(RECOMMENDATION_STORAGE_KEY, storage),
    JSON.stringify(recommendation),
  );
  return recommendation;
}
