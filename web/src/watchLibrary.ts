import type { PlaylistDraft } from './playlistDrafts';
import type { Playlist, StudyPost } from './types';

export type WatchPlaylistKind = 'saved' | 'draft';

export type WatchPlaylistChoice<TVideo> = {
  id: string;
  kind: WatchPlaylistKind;
  title: string;
  description: string;
  videos: TVideo[];
  metaLabel: string;
};

export function buildWatchPlaylistChoices<TVideo>({
  savedPlaylists,
  posts,
  drafts,
  videoFromPost,
}: {
  savedPlaylists: Playlist[];
  posts: StudyPost[];
  drafts: PlaylistDraft<TVideo>[];
  videoFromPost: (post: StudyPost) => TVideo;
}): WatchPlaylistChoice<TVideo>[] {
  const postById = new Map(posts.map((post) => [post.id, post]));
  const savedChoices = savedPlaylists
    .map((playlist) => {
      const videos = playlist.postIds
        .map((postId) => postById.get(postId))
        .filter((post): post is StudyPost => Boolean(post))
        .map(videoFromPost);

      return {
        id: `saved-${playlist.id}`,
        kind: 'saved' as const,
        title: playlist.title,
        description: playlist.description || '저장한 학습 플레이리스트입니다.',
        videos,
        metaLabel: `${videos.length}개 영상 · 저장됨`,
      };
    })
    .filter((choice) => choice.videos.length > 0);
  const draftChoices = drafts
    .map((draft, index) => ({
      id: `draft-${draft.id}`,
      kind: 'draft' as const,
      title: draft.title.trim() || `작업 초안 ${index + 1}`,
      description: draft.description || '아직 보드에 올리지 않은 작업 초안입니다.',
      videos: draft.videos,
      metaLabel: `${draft.videos.length}개 영상 · 초안`,
    }))
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
