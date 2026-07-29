import { CourseLifecycleError, CourseValidationError } from './course.errors';
import type {
  CourseAggregate,
  CourseCursor,
  CourseCursorKind,
  CreateCourseFeedbackInput,
  CourseStepInput,
  CourseStepSnapshot,
  CourseStatus,
  OwnerCourseProjection,
  OwnerLearningState,
  PublicCourseProjection,
} from './course.types';

export const COURSE_LIMITS = Object.freeze({
  title: 200,
  description: 4_000,
  snapshotTitle: 200,
  snapshotUrl: 2_048,
  channelName: 200,
  feedbackBody: 2_000,
  markId: 128,
  markText: 2_000,
  steps: 200,
  marks: 200,
  idempotencyKey: 200,
  pageSize: 100,
});

export function validateCourseTitle(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new CourseValidationError('title', 'title is required');
  }
  if (normalized.length > COURSE_LIMITS.title) {
    throw new CourseValidationError(
      'title',
      `title must be at most ${COURSE_LIMITS.title} characters`,
    );
  }
  return normalized;
}

export function validateCourseDescription(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CourseValidationError(
      'description',
      'description must be a string',
    );
  }
  const normalized = value.trim();
  if (normalized.length > COURSE_LIMITS.description) {
    throw new CourseValidationError(
      'description',
      `description must be at most ${COURSE_LIMITS.description} characters`,
    );
  }
  return normalized;
}

export function validateExpectedVersion(value: unknown): number {
  if (!isPositiveInteger(value)) {
    throw new CourseValidationError(
      'expectedVersion',
      'expectedVersion must be a positive integer',
    );
  }
  return value;
}

export function validateCourseIdempotencyKey(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > COURSE_LIMITS.idempotencyKey) {
    throw new CourseValidationError(
      'Idempotency-Key',
      `Idempotency-Key is required and must be at most ${COURSE_LIMITS.idempotencyKey} characters`,
    );
  }
  return normalized;
}

export function validateCourseFeedbackInput(
  value: unknown,
): CreateCourseFeedbackInput {
  if (!isRecord(value)) {
    throw new CourseValidationError('feedback', 'feedback must be an object');
  }
  if (
    !Number.isInteger(value.rating) ||
    Number(value.rating) < 1 ||
    Number(value.rating) > 5
  ) {
    throw new CourseValidationError(
      'rating',
      'rating must be an integer from 1 to 5',
    );
  }
  const body = typeof value.body === 'string' ? value.body.trim() : '';
  if (!body || body.length > COURSE_LIMITS.feedbackBody) {
    throw new CourseValidationError(
      'body',
      `body is required and must be at most ${COURSE_LIMITS.feedbackBody} characters`,
    );
  }
  return { rating: value.rating as number, body };
}

export function assertCourseLifecycleTransition(
  status: CourseStatus,
  transition: 'edit' | 'publish' | 'archive',
  stepCount?: number,
): void {
  if (status === 'archived') {
    throw new CourseLifecycleError('Archived Courses are read-only');
  }
  if (transition === 'publish' && (status !== 'draft' || !stepCount)) {
    throw new CourseLifecycleError(
      'Only a non-empty draft Course can be published',
    );
  }
}

export function validateCourseStepSnapshot(value: unknown): CourseStepSnapshot {
  return validateSnapshot(value, true);
}

function validatePersistedCourseStepSnapshot(
  value: unknown,
): CourseStepSnapshot {
  return validateSnapshot(value, false);
}

function validateSnapshot(
  value: unknown,
  enforceNativeLimits: boolean,
): CourseStepSnapshot {
  if (!isRecord(value)) {
    throw new CourseValidationError(
      'snapshot',
      'snapshot must be a complete object',
    );
  }

  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (
    !title ||
    (enforceNativeLimits && title.length > COURSE_LIMITS.snapshotTitle)
  ) {
    throw new CourseValidationError(
      'snapshot.title',
      `snapshot.title must contain at most ${COURSE_LIMITS.snapshotTitle} characters`,
    );
  }

  if (
    typeof value.videoUrl !== 'string' ||
    (enforceNativeLimits &&
      value.videoUrl.length > COURSE_LIMITS.snapshotUrl) ||
    !isHttpUrl(value.videoUrl)
  ) {
    throw new CourseValidationError(
      'snapshot.videoUrl',
      'snapshot.videoUrl must be an HTTP or HTTPS URL',
    );
  }

  if (
    typeof value.thumbnailUrl !== 'string' ||
    (enforceNativeLimits &&
      value.thumbnailUrl.length > COURSE_LIMITS.snapshotUrl) ||
    (value.thumbnailUrl !== '' && !isHttpUrl(value.thumbnailUrl))
  ) {
    throw new CourseValidationError(
      'snapshot.thumbnailUrl',
      'snapshot.thumbnailUrl must be empty or an HTTP or HTTPS URL',
    );
  }

  if (
    typeof value.channelName !== 'string' ||
    (enforceNativeLimits &&
      value.channelName.length > COURSE_LIMITS.channelName)
  ) {
    throw new CourseValidationError(
      'snapshot.channelName',
      `snapshot.channelName must contain at most ${COURSE_LIMITS.channelName} characters`,
    );
  }

  return {
    title,
    videoUrl: value.videoUrl,
    thumbnailUrl: value.thumbnailUrl,
    channelName: value.channelName.trim(),
  };
}

export function validateCourseStepInputs(
  value: unknown,
  mode: 'create' | 'replace',
): CourseStepInput[] {
  if (!Array.isArray(value) || value.length > COURSE_LIMITS.steps) {
    throw new CourseValidationError(
      'steps',
      `steps must be an array with at most ${COURSE_LIMITS.steps} items`,
    );
  }

  const stepIds = new Set<string>();
  const sourcePostIds = new Set<number>();

  return value.map((item, index): CourseStepInput => {
    const field = `steps[${index}]`;
    if (!isRecord(item)) {
      throw new CourseValidationError(field, `${field} must be an object`);
    }

    const hasStepId = item.stepId !== undefined;
    const hasSourcePostId = item.sourcePostId !== undefined;
    const hasSnapshot = item.snapshot !== undefined;
    if (
      Number(hasStepId) + Number(hasSourcePostId) + Number(hasSnapshot) !==
      1
    ) {
      throw new CourseValidationError(
        field,
        `${field} must reference exactly one existing step, source post, or snapshot`,
      );
    }

    if (hasStepId) {
      if (mode !== 'replace' || !isPositiveDecimalId(item.stepId)) {
        throw new CourseValidationError(
          `${field}.stepId`,
          `${field}.stepId is not valid for this request`,
        );
      }
      if (item.ownerLearningState !== undefined) {
        throw new CourseValidationError(
          `${field}.ownerLearningState`,
          'existing steps retain their stored owner learning state',
        );
      }
      if (stepIds.has(item.stepId)) {
        throw new CourseValidationError(
          `${field}.stepId`,
          `${field}.stepId is duplicated`,
        );
      }
      stepIds.add(item.stepId);
      return { stepId: item.stepId };
    }

    const ownerLearningState =
      item.ownerLearningState === undefined
        ? undefined
        : validateOwnerLearningState(item.ownerLearningState);

    if (hasSourcePostId) {
      if (!isPositiveInteger(item.sourcePostId)) {
        throw new CourseValidationError(
          `${field}.sourcePostId`,
          `${field}.sourcePostId must be a positive integer`,
        );
      }
      if (sourcePostIds.has(item.sourcePostId)) {
        throw new CourseValidationError(
          `${field}.sourcePostId`,
          `${field}.sourcePostId is duplicated`,
        );
      }
      sourcePostIds.add(item.sourcePostId);
      return ownerLearningState
        ? { sourcePostId: item.sourcePostId, ownerLearningState }
        : { sourcePostId: item.sourcePostId };
    }

    const snapshot = validateCourseStepSnapshot(item.snapshot);
    return ownerLearningState ? { snapshot, ownerLearningState } : { snapshot };
  });
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isPositiveDecimalId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

type EncodedCourseCursor = {
  v: 1;
  k: CourseCursorKind;
  t: string;
  i: number;
};

export function encodeCourseCursor(
  value: Omit<CourseCursor, 'version'>,
): string {
  if (
    (value.kind !== 'owner' && value.kind !== 'public') ||
    !isCanonicalTimestamp(value.timestamp) ||
    !isPositiveInteger(value.id)
  ) {
    throw new CourseValidationError('cursor', 'cursor values are malformed');
  }
  const payload: EncodedCourseCursor = {
    v: 1,
    k: value.kind,
    t: value.timestamp,
    i: value.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCourseCursor(
  encoded: string,
  expectedKind: CourseCursorKind,
): CourseCursor {
  try {
    if (
      typeof encoded !== 'string' ||
      encoded.length === 0 ||
      encoded.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(encoded)
    ) {
      throw new Error('non-canonical encoding');
    }

    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) {
      throw new Error('non-canonical encoding');
    }

    const json = decoded.toString('utf8');
    const candidate = JSON.parse(json) as unknown;
    if (!isRecord(candidate)) {
      throw new Error('payload is not an object');
    }
    const keys = Object.keys(candidate).sort();
    if (keys.join(',') !== 'i,k,t,v') {
      throw new Error('payload keys do not match v1');
    }

    const payload = candidate as Partial<EncodedCourseCursor>;
    if (
      payload.v !== 1 ||
      payload.k !== expectedKind ||
      (payload.k !== 'owner' && payload.k !== 'public') ||
      typeof payload.t !== 'string' ||
      !isCanonicalTimestamp(payload.t) ||
      !isPositiveInteger(payload.i) ||
      JSON.stringify({
        v: payload.v,
        k: payload.k,
        t: payload.t,
        i: payload.i,
      }) !== json
    ) {
      throw new Error('payload values do not match v1 route contract');
    }

    return {
      version: 1,
      kind: payload.k,
      timestamp: payload.t,
      id: payload.i,
    };
  } catch (error) {
    if (error instanceof CourseValidationError) {
      throw error;
    }
    throw new CourseValidationError(
      'cursor',
      'cursor is not valid for this route',
    );
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateOwnerLearningState(value: unknown): OwnerLearningState {
  if (!isRecord(value)) {
    throw new CourseValidationError(
      'ownerLearningState',
      'ownerLearningState must be an object',
    );
  }
  if (
    typeof value.playbackRate !== 'number' ||
    !PLAYBACK_RATES.includes(
      value.playbackRate as (typeof PLAYBACK_RATES)[number],
    )
  ) {
    throw new CourseValidationError(
      'ownerLearningState.playbackRate',
      'ownerLearningState.playbackRate is not supported',
    );
  }

  if (value.captionLanguage !== 'ko' && value.captionLanguage !== 'en') {
    throw new CourseValidationError(
      'ownerLearningState.captionLanguage',
      'ownerLearningState.captionLanguage must be ko or en',
    );
  }
  if (typeof value.captionsEnabled !== 'boolean') {
    throw new CourseValidationError(
      'ownerLearningState.captionsEnabled',
      'ownerLearningState.captionsEnabled must be a boolean',
    );
  }

  const loop = value.loop;
  if (
    !isRecord(loop) ||
    typeof loop.enabled !== 'boolean' ||
    typeof loop.manual !== 'boolean' ||
    typeof loop.start !== 'number' ||
    !Number.isFinite(loop.start) ||
    loop.start < 0 ||
    typeof loop.end !== 'number' ||
    !Number.isFinite(loop.end) ||
    loop.end < 0 ||
    loop.end <= loop.start
  ) {
    throw new CourseValidationError(
      'ownerLearningState.loop',
      'ownerLearningState.loop must contain a valid increasing range',
    );
  }

  if (!Array.isArray(value.marks) || value.marks.length > COURSE_LIMITS.marks) {
    throw new CourseValidationError(
      'ownerLearningState.marks',
      `ownerLearningState.marks must contain at most ${COURSE_LIMITS.marks} items`,
    );
  }

  const marks = value.marks.map((mark, index) => {
    const field = `ownerLearningState.marks[${index}]`;
    if (
      !isRecord(mark) ||
      typeof mark.id !== 'string' ||
      !mark.id.trim() ||
      mark.id.trim().length > COURSE_LIMITS.markId ||
      typeof mark.start !== 'number' ||
      !Number.isFinite(mark.start) ||
      mark.start < 0 ||
      typeof mark.end !== 'number' ||
      !Number.isFinite(mark.end) ||
      mark.end <= mark.start ||
      typeof mark.note !== 'string' ||
      !mark.note.trim() ||
      mark.note.trim().length > COURSE_LIMITS.markText ||
      typeof mark.caption !== 'string' ||
      mark.caption.length > COURSE_LIMITS.markText ||
      typeof mark.createdAt !== 'string' ||
      !isCanonicalTimestamp(mark.createdAt)
    ) {
      throw new CourseValidationError(field, `${field} is malformed`);
    }

    return {
      id: mark.id.trim(),
      start: mark.start,
      end: mark.end,
      note: mark.note.trim(),
      caption: mark.caption,
      createdAt: mark.createdAt,
    };
  });

  return {
    captionLanguage: value.captionLanguage,
    captionsEnabled: value.captionsEnabled,
    playbackRate: value.playbackRate,
    loop: {
      enabled: loop.enabled,
      manual: loop.manual,
      start: loop.start,
      end: loop.end,
    },
    marks,
  } as OwnerLearningState;
}

function isCanonicalTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function cloneLearningState(state: OwnerLearningState): OwnerLearningState {
  const validated = validateOwnerLearningState(state);
  return {
    captionLanguage: validated.captionLanguage,
    captionsEnabled: validated.captionsEnabled,
    playbackRate: validated.playbackRate,
    loop: { ...validated.loop },
    marks: validated.marks.map((mark) => ({ ...mark })),
  };
}

export function toOwnerCourseProjection(
  course: CourseAggregate,
): OwnerCourseProjection {
  return {
    id: course.id,
    ownerId: course.ownerId,
    title: course.title,
    description: course.description,
    visibility: course.visibility,
    status: course.status,
    version: course.version,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    publishedAt: course.publishedAt,
    archivedAt: course.archivedAt,
    steps: course.steps.map((step) => ({
      id: step.id,
      sourcePostId: step.sourcePostId,
      position: step.position,
      snapshot: validatePersistedCourseStepSnapshot(step.snapshot),
      ownerLearningState: cloneLearningState(step.ownerLearningState),
    })),
    feedback: course.feedback.map((feedback) => ({
      id: feedback.id,
      authorId: feedback.authorId,
      authorName: feedback.authorName,
      rating: feedback.rating,
      body: feedback.body,
      createdAt: feedback.createdAt,
    })),
  };
}

export function toPublicCourseProjection(
  course: CourseAggregate,
): PublicCourseProjection {
  if (
    course.status !== 'published' ||
    course.visibility !== 'public' ||
    !course.publishedAt
  ) {
    throw new CourseValidationError(
      'status',
      'only a published public Course has a public projection',
    );
  }

  return {
    id: course.id,
    title: course.title,
    description: course.description,
    visibility: 'public',
    status: 'published',
    version: course.version,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    publishedAt: course.publishedAt,
    steps: course.steps.map((step) => ({
      id: step.id,
      position: step.position,
      snapshot: validatePersistedCourseStepSnapshot(step.snapshot),
    })),
    feedback: course.feedback.map((feedback) => ({
      id: feedback.id,
      authorName: feedback.authorName,
      rating: feedback.rating,
      body: feedback.body,
      createdAt: feedback.createdAt,
    })),
  };
}
