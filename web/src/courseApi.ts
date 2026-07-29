import { requestJson } from './api.ts';
import type {
  Course,
  CourseFeedback,
  CoursePage,
  CourseStepMutation,
  CreateCourseInput,
} from './types.ts';

export class CourseCursorLoopError extends Error {
  constructor(cursor: string) {
    super(`Course pagination repeated cursor: ${cursor}`);
    this.name = 'CourseCursorLoopError';
  }
}

export type CourseCollectionState<T> = {
  items: T[];
  status: 'ready' | 'retry';
  error?: string;
};

export async function drainCursorPages<T extends Course>(
  fetchPage: (cursor?: string) => Promise<CoursePage<T>>,
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    const nextCursor = page.nextCursor ?? undefined;

    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new CourseCursorLoopError(nextCursor);
    }
    if (nextCursor) {
      seenCursors.add(nextCursor);
    }
    cursor = nextCursor;
  } while (cursor);

  return items;
}

export async function refreshCourseCollection<T extends Course>(
  previousItems: T[],
  fetchPage: (cursor?: string) => Promise<CoursePage<T>>,
): Promise<CourseCollectionState<T>> {
  try {
    return {
      items: await drainCursorPages(fetchPage),
      status: 'ready',
    };
  } catch (error) {
    return {
      items: previousItems,
      status: 'retry',
      error: error instanceof Error ? error.message : 'Course refresh failed',
    };
  }
}

export function createCourse(input: CreateCourseInput, idempotencyKey: string) {
  return requestJson<Course>('/courses', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  });
}

export function fetchOwnerCoursePage(cursor?: string, limit = 50) {
  return requestJson<CoursePage<Course>>(
    `/courses?${coursePageSearch(cursor, limit)}`,
  );
}

export function fetchPublicCoursePage(cursor?: string, limit = 50) {
  return requestJson<CoursePage<Course>>(
    `/explore/courses?${coursePageSearch(cursor, limit)}`,
  );
}

export function fetchOwnerCourses() {
  return drainCursorPages(fetchOwnerCoursePage);
}

export function fetchPublicCourses() {
  return drainCursorPages(fetchPublicCoursePage);
}

export function fetchOwnerCourse(courseId: number) {
  return requestJson<Course>(`/courses/${courseId}`);
}

export function updateCourse(
  courseId: number,
  input: { title?: string; description?: string; expectedVersion: number },
) {
  return requestJson<Course>(`/courses/${courseId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function replaceCourseSteps(
  courseId: number,
  expectedVersion: number,
  steps: CourseStepMutation[],
) {
  return requestJson<Course>(`/courses/${courseId}/steps`, {
    method: 'PUT',
    body: JSON.stringify({ expectedVersion, steps }),
  });
}

export function publishCourse(courseId: number, expectedVersion: number) {
  return requestJson<Course>(`/courses/${courseId}/publish`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersion }),
  });
}

export function archiveCourse(courseId: number, expectedVersion: number) {
  return requestJson<Course>(`/courses/${courseId}/archive`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersion }),
  });
}

export function addCourseFeedback(
  courseId: number,
  input: { rating: number; body: string },
) {
  return requestJson<CourseFeedback>(`/courses/${courseId}/feedback`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

function coursePageSearch(cursor: string | undefined, limit: number) {
  const search = new URLSearchParams({ limit: String(limit) });
  if (cursor) {
    search.set('cursor', cursor);
  }
  return search.toString();
}
