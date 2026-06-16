export type PlaylistThumbnailSource = {
  id: number | string;
  title: string;
  thumbnailUrl?: string;
};

export type PlaylistThumbnailStackItem = {
  id: string;
  title: string;
  src: string;
};

export function playlistThumbnailStackFromPosts(
  posts: PlaylistThumbnailSource[],
  visibleLimit = 3,
) {
  const visiblePosts = posts.slice(0, visibleLimit);
  const items: PlaylistThumbnailStackItem[] = visiblePosts
    .filter((post) => Boolean(post.thumbnailUrl))
    .map((post) => ({
      id: String(post.id),
      title: post.title,
      src: post.thumbnailUrl ?? '',
    }));

  return {
    items,
    overflowCount: Math.max(0, posts.length - visiblePosts.length),
    totalCount: posts.length,
  };
}
