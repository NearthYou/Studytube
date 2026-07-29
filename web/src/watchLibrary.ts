import type { PlaylistDraft } from './playlistDrafts';
import type { Course, CourseStep } from './types';

export type WatchPlaylistKind = 'saved' | 'draft';

export type WatchPlaylistChoice<TVideo> = {
  id: string;
  kind: WatchPlaylistKind;
  title: string;
  description: string;
  videos: TVideo[];
  metaLabel: string;
  course?: Pick<Course, 'id' | 'version' | 'status'>;
};

export function buildWatchPlaylistChoices<TVideo>({
  savedCourses,
  drafts,
  videoFromCourseStep,
}: {
  savedCourses: Course[];
  drafts: PlaylistDraft<TVideo>[];
  videoFromCourseStep: (step: CourseStep) => TVideo;
}): WatchPlaylistChoice<TVideo>[] {
  const savedChoices = savedCourses
    .filter((course) => course.status !== 'archived')
    .map((course) => {
      const steps = Array.isArray(course.steps) ? course.steps : [];
      const videos = steps.map(videoFromCourseStep);
      return {
        id: `saved-${course.id}`,
        kind: 'saved' as const,
        title: course.title,
        description: course.description || '저장된 학습 코스입니다.',
        videos,
        metaLabel: `${videos.length}개 영상 / 저장됨`,
        course: {
          id: course.id,
          version: course.version,
          status: course.status,
        },
      };
    })
    .filter((choice) => choice.videos.length > 0);
  const draftChoices = drafts
    .map((draft, index) => {
      const videos = Array.isArray(draft.videos) ? draft.videos : [];
      return {
        id: `draft-${draft.id}`,
        kind: 'draft' as const,
        title: draft.title.trim() || `작성 중인 플레이리스트 ${index + 1}`,
        description: draft.description || '아직 공개하지 않은 작성 중인 플레이리스트입니다.',
        videos,
        metaLabel: `${videos.length}개 영상 / 작성 중`,
      };
    })
    .filter((choice) => choice.videos.length > 0);

  return [...savedChoices, ...draftChoices];
}

export function findMatchingWatchPlaylistChoice<TVideo>(
  choices: WatchPlaylistChoice<TVideo>[],
  queue: TVideo[],
  videoKey: (video: TVideo) => string,
) {
  const queueKey = watchPlaylistKey(queue, videoKey);
  return (
    choices.find(
      (choice) =>
        choice.videos.length === queue.length &&
        watchPlaylistKey(choice.videos, videoKey) === queueKey,
    ) ?? null
  );
}

function watchPlaylistKey<TVideo>(
  videos: TVideo[],
  videoKey: (video: TVideo) => string,
) {
  return videos.map(videoKey).join('|');
}
