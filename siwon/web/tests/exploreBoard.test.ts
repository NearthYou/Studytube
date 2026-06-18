import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPLORE_BOARD_PAGE_SIZE,
  EXPLORE_COURSE_SUMMARY_THRESHOLD,
  paginateExplorePlaylists,
  selectExplorePlaylist,
  selectExploreCommentPost,
  selectExploreCoursePost,
} from '../src/exploreBoard.ts';

test('keeps the requested comment target when it belongs to the selected course', () => {
  const posts = [
    { id: 10, title: 'First video' },
    { id: 20, title: 'Second video' },
  ];

  assert.equal(selectExploreCommentPost(posts, 20)?.id, 20);
});

test('falls back to the first course video when the requested comment target is missing', () => {
  const posts = [
    { id: 10, title: 'First video' },
    { id: 20, title: 'Second video' },
  ];

  assert.equal(selectExploreCommentPost(posts, 99)?.id, 10);
  assert.equal(selectExploreCommentPost(posts, null)?.id, 10);
});

test('returns null when the selected course has no videos', () => {
  assert.equal(selectExploreCommentPost([], 10), null);
});

test('keeps the selected course video for the course summary panel', () => {
  const posts = [
    { id: 10, title: 'First video' },
    { id: 20, title: 'Second video' },
    { id: 30, title: 'Third video' },
  ];

  assert.equal(selectExploreCoursePost(posts, 30)?.id, 30);
  assert.equal(selectExploreCoursePost(posts, 99)?.id, 10);
  assert.equal(selectExploreCoursePost(posts, null)?.id, 10);
  assert.equal(selectExploreCoursePost([], 30), null);
});

test('shows nine board posts per explore page', () => {
  const playlists = Array.from({ length: 12 }, (_, index) => ({ id: index + 1 }));

  assert.equal(EXPLORE_BOARD_PAGE_SIZE, 9);
  assert.deepEqual(
    paginateExplorePlaylists(playlists, 1).map((playlist) => playlist.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    paginateExplorePlaylists(playlists, 2).map((playlist) => playlist.id),
    [10, 11, 12],
  );
});

test('condenses course video summaries from four videos', () => {
  assert.equal(EXPLORE_COURSE_SUMMARY_THRESHOLD, 4);
});

test('does not auto-select a board post before the user clicks one', () => {
  const playlists = [
    { id: 1, title: 'React course' },
    { id: 2, title: 'SQL course' },
  ];

  assert.equal(selectExplorePlaylist(playlists, null), null);
  assert.equal(selectExplorePlaylist(playlists, 2)?.id, 2);
  assert.equal(selectExplorePlaylist(playlists, 99), null);
});
