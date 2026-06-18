import type { PlaylistDraft } from './playlistDrafts.ts';
import type { Playlist, StudyPost } from './types';

export type PlaylistManagementEditor = {
  title: string;
  description: string;
};

export type PlaylistAddTarget = {
  id: string;
  kind: 'draft';
  title: string;
  description: string;
  draftId: string;
};

export function buildPlaylistAddTargets({
  activeDraftId,
  drafts,
}: {
  activeDraftId: string;
  drafts: PlaylistDraft<unknown>[];
}): PlaylistAddTarget[] {
  return [...drafts]
    .sort((first, second) =>
      first.id === activeDraftId ? -1 : second.id === activeDraftId ? 1 : 0,
    )
    .map((draft) => ({
      id: playlistDraftTargetId(draft.id),
      kind: 'draft' as const,
      title: draft.title.trim() || '이름 없는 내 플레이리스트',
      description: `${draft.videos.length}개 영상 · 비공개 · 공개 안 함`,
      draftId: draft.id,
    }));
}

export function playlistDraftTargetId(draftId: string) {
  return `draft-${draftId}`;
}

export function clampPlaylistManagementPage(
  total: number,
  pageSize: number,
  requestedPage: number,
) {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / safePageSize));

  return Math.min(totalPages, Math.max(1, requestedPage));
}

export function nextPlaylistManagementPageAfterDelete(
  currentPage: number,
  pageSize: number,
  totalBeforeDelete: number,
  itemsOnCurrentPage: number,
) {
  if (currentPage <= 1 || itemsOnCurrentPage > 1) {
    return clampPlaylistManagementPage(
      totalBeforeDelete - 1,
      pageSize,
      currentPage,
    );
  }

  return clampPlaylistManagementPage(
    totalBeforeDelete - 1,
    pageSize,
    currentPage - 1,
  );
}

export function editingPlaylistEditorFromPlaylist(
  playlist: Playlist,
): PlaylistManagementEditor {
  return {
    title: playlist.title,
    description: playlist.description,
  };
}

export function filterManagedPlaylists(
  playlists: Playlist[],
  posts: StudyPost[],
  search: string,
) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return playlists;
  }

  return playlists.filter((playlist) => {
    const playlistPosts = playlist.postIds
      .map((postId) => posts.find((post) => post.id === postId))
      .filter((post): post is StudyPost => Boolean(post));
    const haystack = [
      playlist.title,
      playlist.description,
      ...playlistPosts.flatMap((post) => [
        post.title,
        post.channelName,
        post.summary,
        post.translatedNotes,
        ...post.tags,
      ]),
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });
}

export function paginateManagedPlaylists(
  playlists: Playlist[],
  page: number,
  pageSize: number,
) {
  const boundedPage = clampPlaylistManagementPage(
    playlists.length,
    pageSize,
    page,
  );
  const start = (boundedPage - 1) * pageSize;

  return playlists.slice(start, start + pageSize);
}
