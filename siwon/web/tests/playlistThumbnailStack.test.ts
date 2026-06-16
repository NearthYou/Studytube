import assert from 'node:assert/strict';
import test from 'node:test';
import { playlistThumbnailStackFromPosts } from '../src/playlistThumbnailStack.ts';

test('keeps the first three playlist thumbnails and reports overflow', () => {
  const stack = playlistThumbnailStackFromPosts([
    { id: 1, title: 'Video one', thumbnailUrl: 'one.jpg' },
    { id: 2, title: 'Video two', thumbnailUrl: 'two.jpg' },
    { id: 3, title: 'Video three', thumbnailUrl: 'three.jpg' },
    { id: 4, title: 'Video four', thumbnailUrl: 'four.jpg' },
  ]);

  assert.deepEqual(
    stack.items.map((item) => item.src),
    ['one.jpg', 'two.jpg', 'three.jpg'],
  );
  assert.equal(stack.overflowCount, 1);
  assert.equal(stack.totalCount, 4);
});

test('does not show overflow when all playlist thumbnails are visible', () => {
  const stack = playlistThumbnailStackFromPosts([
    { id: 1, title: 'Video one', thumbnailUrl: 'one.jpg' },
    { id: 2, title: 'Video two', thumbnailUrl: 'two.jpg' },
  ]);

  assert.equal(stack.items.length, 2);
  assert.equal(stack.overflowCount, 0);
});
