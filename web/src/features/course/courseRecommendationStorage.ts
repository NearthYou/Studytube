import { scopedStudyStorageKeyFromStorage } from "../../localStudyStorage.ts";
import {
  isQueueVideoLike,
  normalizeQueueVideo,
  uniqueVideos,
  type QueueVideo,
} from "../../watchQueue.ts";
import type { Course } from "../../types.ts";
import { extractYouTubeId } from "../../videoMetadata.ts";

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

export function clearCourseRecommendation(
  storage: Storage = window.localStorage,
) {
  storage.removeItem(
    scopedStudyStorageKeyFromStorage(RECOMMENDATION_STORAGE_KEY, storage),
  );
}

export function isCourseRecommendationSaved(
  recommendation: CourseRecommendationDraft,
  courses: Course[],
) {
  const recommendationVideoIds = recommendation.videos.map(
    (video) => video.videoId,
  );

  return courses.some((course) => {
    if (
      course.status === "archived" ||
      course.title.trim() !== recommendation.title.trim() ||
      course.steps.length !== recommendationVideoIds.length
    ) {
      return false;
    }

    return course.steps.every(
      (step, index) =>
        extractYouTubeId(step.snapshot.videoUrl) ===
        recommendationVideoIds[index],
    );
  });
}
