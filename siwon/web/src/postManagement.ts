import type { StudyPost } from './types';

export type PostManagementEditor = {
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
  summary: string;
  translatedNotes: string;
  tags: string;
};

export function clampPostManagementPage(
  total: number,
  pageSize: number,
  requestedPage: number,
) {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / safePageSize));

  return Math.min(totalPages, Math.max(1, requestedPage));
}

export function nextPostManagementPageAfterDelete(
  currentPage: number,
  pageSize: number,
  totalBeforeDelete: number,
  itemsOnCurrentPage: number,
) {
  if (currentPage <= 1 || itemsOnCurrentPage > 1) {
    return clampPostManagementPage(totalBeforeDelete - 1, pageSize, currentPage);
  }

  return clampPostManagementPage(totalBeforeDelete - 1, pageSize, currentPage - 1);
}

export function editingPostEditorFromPost(
  post: StudyPost,
): PostManagementEditor {
  return {
    title: post.title,
    videoUrl: post.videoUrl,
    thumbnailUrl: post.thumbnailUrl,
    channelName: post.channelName,
    summary: post.summary,
    translatedNotes: post.translatedNotes,
    tags: post.tags.join(', '),
  };
}

export function recentPostComments(post: StudyPost, limit = 3) {
  return [...post.comments]
    .sort(
      (first, second) =>
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime(),
    )
    .slice(0, Math.max(0, limit));
}
