import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CourseImportSupersededError,
  buildCourseImportEnvelope,
  completeImportedPlaylistDraft,
  importCourseDraft,
  readPendingCourseImport,
  savePendingCourseImport,
} from '../src/courseDraftImport.ts';
import { createPlaylistDraft, patchActivePlaylistDraft } from '../src/playlistDrafts.ts';
import type { Course, CourseLearningState } from '../src/types.ts';
import type { QueueVideo } from '../src/watchQueue.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => store.set(key, value),
  };
}

function video(input: Partial<QueueVideo> = {}): QueueVideo {
  return {
    id: 'post-42',
    title: 'Transaction Locks',
    videoId: 'locks42',
    videoUrl: 'https://www.youtube.com/watch?v=locks42',
    thumbnailUrl: 'https://img.example.test/locks.jpg',
    channelName: 'Database Lab',
    summary: 'Locking behavior',
    translatedNotes: 'Notes',
    source: 'board',
    ...input,
  };
}

function course(status: Course['status'] = 'draft', version = 1): Course {
  return {
    id: 91,
    ownerId: 7,
    title: 'Concurrency',
    description: 'Backend course',
    visibility: status === 'published' ? 'public' : 'private',
    status,
    version,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    publishedAt: status === 'published' ? '2026-07-29T00:01:00.000Z' : null,
    archivedAt: null,
    steps: [],
    feedback: [],
  };
}

test('converts draft videos in display order and keeps only valid learning state', () => {
  const validLearning: CourseLearningState = {
    captionLanguage: 'en',
    captionsEnabled: false,
    playbackRate: 1.25,
    loop: { enabled: true, manual: true, start: 12, end: 18 },
    marks: [
      {
        id: 'mark-1',
        start: 12,
        end: 14,
        note: 'Isolation level',
        caption: 'Serializable',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
    ],
  };
  const draft = createPlaylistDraft<QueueVideo>({
    id: 'draft-a',
    title: ' Concurrency ',
    description: ' Backend course ',
    videos: [
      video({ learning: validLearning }),
      video({
        id: 'agent-snapshot',
        title: 'Optimistic Versions',
        videoId: 'versions7',
        videoUrl: 'https://www.youtube.com/watch?v=versions7',
        learning: {
          ...validLearning,
          playbackRate: 3,
          marks: [{ ...validLearning.marks[0], id: '', note: '' }],
        },
      }),
    ],
  });

  const envelope = buildCourseImportEnvelope(7, draft);

  assert.equal(envelope.payload.title, 'Concurrency');
  assert.equal(envelope.payload.steps.length, 2);
  assert.equal(envelope.payload.steps[0].sourcePostId, 42);
  assert.deepEqual(envelope.payload.steps[0].ownerLearningState, validLearning);
  assert.deepEqual(envelope.payload.steps[1].snapshot, {
    title: 'Optimistic Versions',
    videoUrl: 'https://www.youtube.com/watch?v=versions7',
    thumbnailUrl: 'https://img.example.test/locks.jpg',
    channelName: 'Database Lab',
  });
  assert.equal(envelope.payload.steps[1].ownerLearningState?.playbackRate, 1);
  assert.deepEqual(envelope.payload.steps[1].ownerLearningState?.marks, []);
});

test('derives one immutable owner and revision scoped envelope', () => {
  const draft = createPlaylistDraft<QueueVideo>({
    id: 'draft-retry',
    videos: [video()],
  });
  const first = buildCourseImportEnvelope(7, draft);
  const retry = buildCourseImportEnvelope(7, draft);
  const edited = buildCourseImportEnvelope(7, {
    ...draft,
    revision: draft.revision + 1,
    title: 'Edited',
  });

  assert.deepEqual(retry, first);
  assert.notEqual(edited.idempotencyKey, first.idempotencyKey);
  assert.notEqual(edited.canonicalPayload, first.canonicalPayload);
});

test('resumes only the matching user draft and revision', () => {
  const storage = createMemoryStorage();
  const envelope = buildCourseImportEnvelope(
    7,
    createPlaylistDraft<QueueVideo>({ id: 'private-draft', videos: [video()] }),
  );
  savePendingCourseImport(envelope, storage);

  assert.deepEqual(readPendingCourseImport(7, 'private-draft', storage), envelope);
  assert.equal(readPendingCourseImport(8, 'private-draft', storage), null);
});

test('keeps an in-flight revision immutable when a later edit is queued', () => {
  const storage = createMemoryStorage();
  const draft = createPlaylistDraft<QueueVideo>({ id: 'draft-edits', videos: [video()] });
  const first = buildCourseImportEnvelope(7, draft);
  const edited = buildCourseImportEnvelope(7, {
    ...draft,
    revision: 2,
    title: 'Edited title',
  });

  savePendingCourseImport(first, storage);
  savePendingCourseImport(edited, storage);

  assert.deepEqual(readPendingCourseImport(7, draft.id, storage), edited);
  assert.deepEqual(readPendingCourseImport(7, draft.id, storage, 1), first);
});

test('persists a saved private course and retries publish without creating again', async () => {
  const storage = createMemoryStorage();
  const draft = createPlaylistDraft<QueueVideo>({
    id: 'draft-publish-retry',
    videos: [video()],
  });
  let creates = 0;
  let publishes = 0;
  const completed: string[] = [];

  await assert.rejects(
    importCourseDraft({
      userId: 7,
      draft,
      storage,
      activeUserId: () => 7,
      create: async () => {
        creates += 1;
        return course('draft', 1);
      },
      publish: async () => {
        publishes += 1;
        throw new Error('publish unavailable');
      },
      complete: (envelope) => completed.push(envelope.draftId),
    }),
    /publish unavailable/,
  );

  const pending = readPendingCourseImport(7, draft.id, storage);
  assert.equal(pending?.savedCourse?.id, 91);
  assert.equal(pending?.savedCourse?.version, 1);
  assert.equal(pending?.savedCourse?.status, 'draft');

  const published = await importCourseDraft({
    userId: 7,
    draft,
    storage,
    activeUserId: () => 7,
    create: async () => {
      creates += 1;
      return course('draft', 1);
    },
    publish: async (_id, expectedVersion) => {
      publishes += 1;
      assert.equal(expectedVersion, 1);
      return course('published', 2);
    },
    complete: (envelope) => completed.push(envelope.draftId),
  });

  assert.equal(published.status, 'published');
  assert.equal(creates, 1);
  assert.equal(publishes, 2);
  assert.deepEqual(completed, ['draft-publish-retry']);
  assert.equal(readPendingCourseImport(7, draft.id, storage), null);
});

test('persists a published acknowledgement before completion and resumes locally', async () => {
  const storage = createMemoryStorage();
  const draft = createPlaylistDraft<QueueVideo>({
    id: 'draft-published-resume',
    videos: [video()],
  });
  let activeUserId = 7;

  await assert.rejects(
    importCourseDraft({
      userId: 7,
      draft,
      storage,
      activeUserId: () => activeUserId,
      create: async () => course('draft', 1),
      publish: async () => {
        activeUserId = 8;
        return course('published', 2);
      },
      complete: () => assert.fail('switched user must not complete the draft'),
    }),
    CourseImportSupersededError,
  );
  assert.equal(
    readPendingCourseImport(7, draft.id, storage)?.savedCourse?.status,
    'published',
  );

  activeUserId = 7;
  let completed = false;
  const resumed = await importCourseDraft({
    userId: 7,
    draft,
    storage,
    activeUserId: () => activeUserId,
    create: async () => assert.fail('published import must not create again'),
    publish: async () => assert.fail('published import must not publish again'),
    complete: () => {
      completed = true;
    },
  });

  assert.equal(resumed.status, 'published');
  assert.equal(completed, true);
  assert.equal(readPendingCourseImport(7, draft.id, storage), null);
});

test('a late acknowledgement cannot clear an edited draft or another user', () => {
  const originalDraft = createPlaylistDraft<QueueVideo>({
    id: 'draft-late',
    videos: [video()],
  });
  const envelope = buildCourseImportEnvelope(7, originalDraft);
  const originalState = { drafts: [originalDraft], activeDraftId: originalDraft.id };
  const editedState = patchActivePlaylistDraft(originalState, { title: 'Edited' });
  const replacement = createPlaylistDraft<QueueVideo>({ id: 'replacement' });

  assert.deepEqual(
    completeImportedPlaylistDraft(editedState, envelope, 7, replacement),
    editedState,
  );
  assert.deepEqual(
    completeImportedPlaylistDraft(originalState, envelope, 8, replacement),
    originalState,
  );
  assert.equal(
    completeImportedPlaylistDraft(originalState, envelope, 7, replacement)
      .drafts[0].id,
    'replacement',
  );
});

test('account switching blocks completion after the request returns', async () => {
  const storage = createMemoryStorage();
  const draft = createPlaylistDraft<QueueVideo>({
    id: 'draft-account-switch',
    videos: [video()],
  });

  await assert.rejects(
    importCourseDraft({
      userId: 7,
      draft,
      storage,
      activeUserId: () => 8,
      create: async () => course('published', 1),
      publish: async () => course('published', 2),
      complete: () => assert.fail('must not complete another user draft'),
    }),
    CourseImportSupersededError,
  );
  assert.ok(readPendingCourseImport(7, draft.id, storage));
});
