import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlaylistDraft } from '../src/playlistDrafts.ts';
import type { Course, CourseStep } from '../src/types.ts';
import {
  buildWatchPlaylistChoices,
  findMatchingWatchPlaylistChoice,
} from '../src/watchLibrary.ts';

type TestVideo = { id: string; title: string };

function step(id: string, title: string): CourseStep {
  return {
    id,
    position: Number(id),
    sourcePostId: null,
    snapshot: {
      title,
      videoUrl: `https://youtube.com/watch?v=video${id}`,
      thumbnailUrl: `thumb-${id}.jpg`,
      channelName: 'Channel',
    },
  };
}

function course(id: number, title: string, steps: CourseStep[]): Course {
  return {
    id,
    ownerId: 1,
    title,
    description: '',
    steps,
    feedback: [],
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    publishedAt: '2026-06-11T00:00:00.000Z',
    archivedAt: null,
    status: 'published',
    visibility: 'public',
    version: 3,
  };
}

test('builds watch choices from Course snapshots and local drafts', () => {
  const draft: PlaylistDraft<TestVideo> = {
    id: 'draft-a',
    revision: 1,
    title: 'Draft Course',
    description: '',
    videos: [{ id: 'draft-video', title: 'Draft Video' }],
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
  };
  const choices = buildWatchPlaylistChoices({
    savedCourses: [
      course(1, 'Saved Course', [step('1', 'React'), step('2', 'FastAPI')]),
    ],
    drafts: [draft],
    videoFromCourseStep: (item) => ({
      id: `step-${item.id}`,
      title: item.snapshot.title,
    }),
  });

  assert.deepEqual(
    choices.map(({ id, kind, videos }) => [id, kind, videos.length]),
    [
      ['saved-1', 'saved', 2],
      ['draft-draft-a', 'draft', 1],
    ],
  );
});

test('skips saved courses that have no playable snapshots', () => {
  const choices = buildWatchPlaylistChoices<TestVideo>({
    savedCourses: [course(1, 'Missing Course', [])],
    drafts: [],
    videoFromCourseStep: (item) => ({
      id: `step-${item.id}`,
      title: item.snapshot.title,
    }),
  });

  assert.deepEqual(choices, []);
});

test('treats malformed course step and draft video lists as empty', () => {
  const choices = buildWatchPlaylistChoices<TestVideo>({
    savedCourses: [
      { ...course(1, 'Broken Course', [step('1', 'React')]), steps: null as never },
    ],
    drafts: [
      {
        id: 'broken-draft',
        revision: 1,
        title: 'Broken Draft',
        description: '',
        videos: null as never,
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:00.000Z',
      },
    ],
    videoFromCourseStep: (item) => ({
      id: `step-${item.id}`,
      title: item.snapshot.title,
    }),
  });

  assert.deepEqual(choices, []);
});

test('finds the watch choice that matches the current queue order', () => {
  const choices = [
    {
      id: 'saved-1',
      kind: 'saved' as const,
      title: 'React',
      description: '',
      metaLabel: '2 videos',
      videos: [
        { id: 'step-1', title: 'Hooks' },
        { id: 'step-2', title: 'Query' },
      ],
    },
  ];
  const match = findMatchingWatchPlaylistChoice(
    choices,
    [
      { id: 'step-1', title: 'Hooks' },
      { id: 'step-2', title: 'Query' },
    ],
    (video) => video.id,
  );

  assert.equal(match?.id, 'saved-1');
});
