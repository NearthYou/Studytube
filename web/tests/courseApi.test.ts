import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CourseCursorLoopError,
  archiveCourse,
  createCourse,
  drainCursorPages,
  publishCourse,
  refreshCourseCollection,
} from '../src/courseApi.ts';
import type { Course, CoursePage } from '../src/types.ts';

function course(id: number): Course {
  return {
    id,
    ownerId: 7,
    title: `Course ${id}`,
    description: '',
    visibility: 'private',
    status: 'draft',
    version: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    steps: [],
    feedback: [],
  };
}

test('drains cursor pages in server order without omitting items', async () => {
  const requested: Array<string | undefined> = [];
  const pages = new Map<string | undefined, CoursePage<Course>>([
    [undefined, { items: [course(3), course(2)], nextCursor: 'cursor-2' }],
    ['cursor-2', { items: [course(1)], nextCursor: null }],
  ]);

  const items = await drainCursorPages(async (cursor) => {
    requested.push(cursor);
    return pages.get(cursor)!;
  });

  assert.deepEqual(requested, [undefined, 'cursor-2']);
  assert.deepEqual(items.map(({ id }) => id), [3, 2, 1]);
});

test('rejects a repeated next cursor instead of looping forever', async () => {
  await assert.rejects(
    drainCursorPages(async () => ({ items: [course(1)], nextCursor: 'same' })),
    CourseCursorLoopError,
  );
});

test('keeps the prior complete list when a later page fails', async () => {
  const previous = [course(9)];
  const state = await refreshCourseCollection(previous, async (cursor) => {
    if (!cursor) {
      return { items: [course(2)], nextCursor: 'next' };
    }
    throw new Error('page two unavailable');
  });

  assert.equal(state.status, 'retry');
  assert.deepEqual(state.items, previous);
  assert.match(state.error ?? '', /page two unavailable/);
});

test('sends course idempotency and optimistic version contracts', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ path: String(input), init });
    return new Response(JSON.stringify(course(11)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await createCourse(
      {
        title: 'Transactions',
        description: 'Concurrency course',
        steps: [],
      },
      'user-7:draft-a:revision-3',
    );
    await publishCourse(11, 4);
    await archiveCourse(11, 5);

    const createHeaders = new Headers(calls[0].init?.headers);
    assert.equal(
      createHeaders.get('Idempotency-Key'),
      'user-7:draft-a:revision-3',
    );
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
      expectedVersion: 4,
    });
    assert.match(calls[1].path, /\/courses\/11\/publish$/);
    assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
      expectedVersion: 5,
    });
    assert.match(calls[2].path, /\/courses\/11\/archive$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
