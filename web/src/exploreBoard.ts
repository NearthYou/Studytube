export type ExploreCommentPost = {
  id: number;
};

export const EXPLORE_BOARD_PAGE_SIZE = 9;

export function paginateExplorePlaylists<TPlaylist>(
  playlists: TPlaylist[],
  page: number,
) {
  const boundedPage = Math.max(1, page);
  const start = (boundedPage - 1) * EXPLORE_BOARD_PAGE_SIZE;

  return playlists.slice(start, start + EXPLORE_BOARD_PAGE_SIZE);
}

export function selectExplorePlaylist<TPlaylist extends { id: number }>(
  playlists: TPlaylist[],
  requestedPlaylistId: number | null,
) {
  if (requestedPlaylistId === null) {
    return null;
  }

  return playlists.find((playlist) => playlist.id === requestedPlaylistId) ?? null;
}

export function selectExploreCommentPost<TPost extends ExploreCommentPost>(
  posts: TPost[],
  requestedPostId: number | null,
) {
  return (
    posts.find((post) => post.id === requestedPostId) ??
    posts[0] ??
    null
  );
}
