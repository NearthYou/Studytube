import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudyPost } from '../src/types.ts';
import {
  clampPostManagementPage,
  editingPostEditorFromPost,
  nextPostManagementPageAfterDelete,
  recentPostComments,
} from '../src/postManagement.ts';

function post(overrides: Partial<StudyPost> = {}): StudyPost {
  return {
    id: 1,
    authorId: 7,
    authorName: 'Ada',
    title: 'React Hooks',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    thumbnailUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
    channelName: 'StudyTube',
    summary: 'Hooks overview',
    translatedNotes: 'Korean notes',
    tags: ['react', 'hooks'],
    comments: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    ...overrides,
  };
}

test('clamps post management pages from total and page size', () => {
  assert.equal(clampPostManagementPage(0, 5, 9), 1);
  assert.equal(clampPostManagementPage(24, 5, 9), 5);
  assert.equal(clampPostManagementPage(24, 5, 0), 1);
  assert.equal(clampPostManagementPage(24, 5, 99), 5);
});

test('moves to the previous page after deleting the last item on a page', () => {
  assert.equal(nextPostManagementPageAfterDelete(3, 5, 11, 1), 2);
  assert.equal(nextPostManagementPageAfterDelete(3, 5, 12, 2), 3);
  assert.equal(nextPostManagementPageAfterDelete(1, 5, 1, 1), 1);
});

test('builds an editing form from a saved post', () => {
  assert.deepEqual(
    editingPostEditorFromPost(
      post({
        title: 'TypeScript Basics',
        channelName: 'Frontend Lab',
        tags: ['typescript', 'beginner'],
      }),
    ),
    {
      title: 'TypeScript Basics',
      videoUrl: 'https://www.youtube.com/watch?v=abc123',
      thumbnailUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
      channelName: 'Frontend Lab',
      summary: 'Hooks overview',
      translatedNotes: 'Korean notes',
      tags: 'typescript, beginner',
    },
  );
});

test('shows the most recent comments in post management', () => {
  const comments = recentPostComments(
    post({
      comments: [
        {
          id: 1,
          postId: 1,
          authorId: 2,
          authorName: 'Linus',
          body: 'Older note',
          createdAt: '2026-06-14T00:00:00.000Z',
        },
        {
          id: 2,
          postId: 1,
          authorId: 3,
          authorName: 'Grace',
          body: 'Latest note',
          createdAt: '2026-06-14T00:03:00.000Z',
        },
      ],
    }),
  );

  assert.deepEqual(
    comments.map((comment) => comment.body),
    ['Latest note', 'Older note'],
  );
});
